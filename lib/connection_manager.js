class ConnectionManager {
    constructor(isHost) {
        this.isHost = isHost;
        this.connections = {};
        this.dataChannels = {};
        this.events = {};
        this.pendingCandidates = {};
        this.hostId = null;
        this.myId = this.generateId();
        this._disconnectedPeers = new Set();

        this.mqttBrokerUrl = 'wss://broker.hivemq.com:8884/mqtt';
        this.topicPrefix = 'jackbox_p2p_party_analogue';
        this.mqttClient = null;

        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
            ],
            iceCandidatePoolSize: 10,
        };
    }

    async init() {
        return new Promise((resolve, reject) => {
            if (this.isHost) {
                this.hostId = this.myId;
            }

            try {
                this.mqttClient = mqtt.connect(this.mqttBrokerUrl, {
                    clientId: 'jbx_' + this.myId + '_' + Date.now(),
                    clean: true,
                    connectTimeout: 10000,
                    reconnectPeriod: 2000,
                });
            } catch (e) {
                reject(e);
                return;
            }

            this.mqttClient.on('connect', () => {
                if (this.isHost) {
                    this.mqttClient.subscribe(
                        `${this.topicPrefix}/${this.hostId}/host`,
                        { qos: 1 }
                    );
                    resolve(this.myId);
                } else {
                    resolve(this.myId);
                }
            });

            this.mqttClient.on('error', (err) => reject(err));

            this.mqttClient.on('message', async (topic, message) => {
                try {
                    const data = JSON.parse(message.toString());
                    if (data.sender === this.myId) return;
                    await this.handleSignalingMessage(data);
                } catch (e) {
                    console.error("Signaling msg parse error", e);
                }
            });
        });
    }

    async connectToHost(hostId, retries = 3) {
        this.hostId = hostId;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                await this._attemptConnect(attempt);
                return this.hostId;
            } catch (e) {
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                    this._cleanupConnection(this.hostId);
                } else {
                    throw e;
                }
            }
        }
    }

    _attemptConnect(attempt) {
        return new Promise((resolve, reject) => {
            const timeout = 10000 + attempt * 5000;
            let settled = false;

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error(`Timeout connecting to host (attempt ${attempt})`));
                }
            }, timeout);

            const onOpen = (peerId) => {
                if (peerId === this.hostId && !settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve();
                }
            };

            this.onSystem('channel_open', onOpen);

            const sub = `${this.topicPrefix}/${this.hostId}/client/${this.myId}`;
            this.mqttClient.subscribe(sub, { qos: 1 }, () => {
                const joinMsg = JSON.stringify({
                    type: 'join',
                    target: this.hostId,
                    sender: this.myId
                });
                this.mqttClient.publish(
                    `${this.topicPrefix}/${this.hostId}/host`,
                    joinMsg,
                    { qos: 1 }
                );

                setTimeout(() => {
                    if (!settled) {
                        this.mqttClient.publish(
                            `${this.topicPrefix}/${this.hostId}/host`,
                            joinMsg,
                            { qos: 1 }
                        );
                    }
                }, 2000);
            });
        });
    }

    async handleSignalingMessage(data) {
        const { type, sender, payload } = data;

        if (type === 'join' && this.isHost) {
            if (this.dataChannels[sender] && this.dataChannels[sender].readyState === 'open') {
                return;
            }

            this._cleanupConnection(sender);

            const pc = this.createPeerConnection(sender);
            const dc = pc.createDataChannel('gameData', {
                ordered: true,
            });
            this.setupDataChannel(dc, sender);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            await this._waitForIceGathering(pc);

            this.signalingSend(sender, {
                type: 'offer',
                target: sender,
                sender: this.myId,
                payload: pc.localDescription,
            });
        }
        else if (type === 'offer' && !this.isHost) {
            this._cleanupConnection(sender);

            const pc = this.createPeerConnection(sender);
            pc.ondatachannel = (event) => {
                this.setupDataChannel(event.channel, sender);
            };

            await pc.setRemoteDescription(new RTCSessionDescription(payload));
            await this._flushCandidates(sender);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await this._waitForIceGathering(pc);

            this.signalingSend(sender, {
                type: 'answer',
                target: sender,
                sender: this.myId,
                payload: pc.localDescription,
            });
        }
        else if (type === 'answer' && this.isHost) {
            const pc = this.connections[sender];
            if (pc && pc.signalingState !== 'closed' && pc.signalingState !== 'stable') {
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                await this._flushCandidates(sender);
            }
        }
        else if (type === 'ice-candidate') {
            const pc = this.connections[sender];
            if (!pc) {
                if (!this.pendingCandidates[sender]) this.pendingCandidates[sender] = [];
                this.pendingCandidates[sender].push(payload);
                return;
            }
            if (pc.remoteDescription && pc.remoteDescription.type) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(payload));
                } catch (e) { }
            } else {
                if (!this.pendingCandidates[sender]) this.pendingCandidates[sender] = [];
                this.pendingCandidates[sender].push(payload);
            }
        }
    }

    _waitForIceGathering(pc) {
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') {
                resolve();
                return;
            }

            const timeout = setTimeout(resolve, 3000);

            pc.addEventListener('icegatheringstatechange', function handler() {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timeout);
                    pc.removeEventListener('icegatheringstatechange', handler);
                    resolve();
                }
            });
        });
    }

    async _flushCandidates(peerId) {
        const candidates = this.pendingCandidates[peerId];
        if (!candidates || candidates.length === 0) return;
        delete this.pendingCandidates[peerId];

        const pc = this.connections[peerId];
        if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) return;

        for (const c of candidates) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
            } catch (e) { }
        }
    }

    createPeerConnection(peerId) {
        const pc = new RTCPeerConnection(this.rtcConfig);
        this.connections[peerId] = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.signalingSend(peerId, {
                    type: 'ice-candidate',
                    target: peerId,
                    sender: this.myId,
                    payload: event.candidate
                });
            }
        };

        pc.oniceconnectionstatechange = () => {
            const s = pc.iceConnectionState;
            if (s === 'failed') {
                try { pc.restartIce(); } catch (e) { }
            }
            if (s === 'disconnected') {
                this._scheduleDisconnectCheck(peerId, pc);
            }
            if (s === 'closed') {
                this.handlePeerDisconnect(peerId);
            }
        };

        return pc;
    }

    _scheduleDisconnectCheck(peerId, pc) {
        setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                this.handlePeerDisconnect(peerId);
            }
        }, 5000);
    }

    setupDataChannel(dc, peerId) {
        this.dataChannels[peerId] = dc;

        dc.onopen = () => {
            this._disconnectedPeers.delete(peerId);
            this.emitSystem('channel_open', peerId);
            if (this.isHost) {
                this.emit('player_connected', { playerId: peerId }, peerId);
            }
        };

        dc.onclose = () => {
            this.handlePeerDisconnect(peerId);
        };

        dc.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data && data.type) {
                    this.emit(data.type, data.payload, peerId);
                }
            } catch (e) {
                console.error("Failed to parse data channel message:", e);
            }
        };
    }

    signalingSend(targetPeer, data) {
        const topic = (targetPeer === this.hostId)
            ? `${this.topicPrefix}/${this.hostId}/host`
            : `${this.topicPrefix}/${this.hostId}/client/${targetPeer}`;

        if (this.mqttClient && this.mqttClient.connected) {
            this.mqttClient.publish(topic, JSON.stringify(data), { qos: 1 });
        }
    }

    _cleanupConnection(peerId) {
        const oldPc = this.connections[peerId];
        if (oldPc) {
            try { oldPc.close(); } catch (e) { }
            delete this.connections[peerId];
        }
        const oldDc = this.dataChannels[peerId];
        if (oldDc) {
            try { oldDc.close(); } catch (e) { }
            delete this.dataChannels[peerId];
        }
        delete this.pendingCandidates[peerId];
    }

    handlePeerDisconnect(peerId) {
        if (this._disconnectedPeers.has(peerId)) return;
        this._disconnectedPeers.add(peerId);

        this._cleanupConnection(peerId);
        this.emit('player_disconnected', { playerId: peerId }, peerId);
    }

    sendTo(peerId, type, payload) {
        const dc = this.dataChannels[peerId];
        if (dc && dc.readyState === 'open') {
            dc.send(JSON.stringify({ type, payload }));
        }
    }

    broadcast(type, payload) {
        if (!this.isHost) return;
        const msg = JSON.stringify({ type, payload });
        Object.values(this.dataChannels).forEach(dc => {
            if (dc.readyState === 'open') {
                dc.send(msg);
            }
        });
    }

    sendToHost(type, payload) {
        if (this.isHost) return;
        if (this.hostId) {
            this.sendTo(this.hostId, type, payload);
        }
    }

    on(event, handler) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(handler);
    }

    emit(event, payload, senderId) {
        if (this.events[event]) {
            this.events[event].forEach(handler => handler(payload, senderId));
        }
    }

    onSystem(event, handler) {
        const sysEvent = `__sys_${event}`;
        this.on(sysEvent, handler);
    }

    emitSystem(event, payload) {
        const sysEvent = `__sys_${event}`;
        this.emit(sysEvent, payload, null);
    }

    generateId() {
        return Math.random().toString(36).substring(2, 9);
    }
}
window.ConnectionManager = ConnectionManager;