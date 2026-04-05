class ConnectionManager {
    constructor(isHost) {
        this.isHost = isHost;
        this.connections = {};
        this.events = {};
        this.hostId = null;
        this.myId = this.generateId();
        this._disconnectedPeers = new Set();

        this.mqttBrokerUrl = 'wss://broker.hivemq.com:8884/mqtt';
        this.topicPrefix = 'jackbox_p2p_party_analogue';
        this.mqttClient = null;
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
                    this.mqttClient.subscribe(`${this.topicPrefix}/${this.hostId}/host`, { qos: 1 });
                }
                resolve(this.myId);
            });

            this.mqttClient.on('error', (err) => reject(err));

            this.mqttClient.on('message', (topic, message) => {
                try {
                    const data = JSON.parse(message.toString());
                    if (data.sender === this.myId) return;
                    this.handleSignalingMessage(data);
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
                    this.handlePeerDisconnect(this.hostId);
                } else {
                    throw e;
                }
            }
        }
    }

    _attemptConnect(attempt) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout connecting to host (attempt ${attempt})`));
            }, 10000 + attempt * 5000);

            const sub = `${this.topicPrefix}/${this.hostId}/client/${this.myId}`;

            this.mqttClient.subscribe(sub, { qos: 1 }, () => {
                const peer = new SimplePeer({ initiator: true, trickle: true });
                this._setupPeer(peer, this.hostId);

                peer.on('connect', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                peer.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });
        });
    }

    handleSignalingMessage(data) {
        const { type, sender, payload } = data;

        if (type === 'signal') {
            if (this.isHost && !this.connections[sender]) {
                const peer = new SimplePeer({ initiator: false, trickle: true });
                this._setupPeer(peer, sender);
            }

            if (this.connections[sender]) {
                this.connections[sender].signal(payload);
            }
        }
    }

    _setupPeer(peer, peerId) {
        this.connections[peerId] = peer;
        this._disconnectedPeers.delete(peerId);

        peer.on('signal', (signalData) => {
            const topic = (peerId === this.hostId)
                ? `${this.topicPrefix}/${this.hostId}/host`
                : `${this.topicPrefix}/${this.hostId}/client/${peerId}`;

            const msg = JSON.stringify({ type: 'signal', sender: this.myId, payload: signalData });
            this.mqttClient.publish(topic, msg, { qos: 1 });
        });

        peer.on('connect', () => {
            this.emitSystem('channel_open', peerId);
            if (this.isHost) {
                this.emit('player_connected', { playerId: peerId }, peerId);
            }
        });

        peer.on('data', (raw) => {
            try {
                const data = JSON.parse(raw.toString());
                if (data && data.type) {
                    this.emit(data.type, data.payload, peerId);
                }
            } catch (e) {
                console.error("Failed to parse data channel message:", e);
            }
        });

        peer.on('close', () => this.handlePeerDisconnect(peerId));
        peer.on('error', () => this.handlePeerDisconnect(peerId));
    }

    handlePeerDisconnect(peerId) {
        if (this._disconnectedPeers.has(peerId)) return;
        this._disconnectedPeers.add(peerId);

        const peer = this.connections[peerId];
        if (peer) {
            try { peer.destroy(); } catch (e) { }
            delete this.connections[peerId];
        }

        this.emit('player_disconnected', { playerId: peerId }, peerId);
    }

    sendTo(peerId, type, payload) {
        const peer = this.connections[peerId];
        if (peer && peer.connected) {
            peer.send(JSON.stringify({ type, payload }));
        }
    }

    broadcast(type, payload) {
        if (!this.isHost) return;
        const msg = JSON.stringify({ type, payload });
        Object.values(this.connections).forEach(peer => {
            if (peer.connected) peer.send(msg);
        });
    }

    sendToHost(type, payload) {
        if (this.isHost) return;
        if (this.hostId) {
            this.sendTo(this.hostId, type, payload);
        }
    }

    on(event, handler) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(handler);
    }

    emit(event, payload, senderId) {
        if (this.events[event]) {
            this.events[event].forEach(handler => handler(payload, senderId));
        }
    }

    onSystem(event, handler) {
        this.on(`__sys_${event}`, handler);
    }

    emitSystem(event, payload) {
        this.emit(`__sys_${event}`, payload, null);
    }

    generateId() {
        return Math.random().toString(36).substring(2, 9);
    }
}
window.ConnectionManager = ConnectionManager;