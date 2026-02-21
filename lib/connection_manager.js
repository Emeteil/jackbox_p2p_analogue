class ConnectionManager {
    constructor(isHost) {
        this.isHost = isHost;
        this.peer = null;
        this.connections = {};
        this.events = {};
        this.hostId = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const id = this.generateId();
            this.peer = new Peer(id, {
                debug: 2
            });
            this.peer.on('open', (id) => {
                if (this.isHost) {
                    this.hostId = id;
                }
                resolve(id);
            });
            this.peer.on('error', (err) => {
                reject(err);
            });
            if (this.isHost) {
                this.peer.on('connection', (conn) => {
                    this._setupConnection(conn);
                });
            }
        });
    }

    connectToHost(hostId) {
        return new Promise((resolve, reject) => {
            const conn = this.peer.connect(hostId, {
                reliable: true
            });
            conn.on('open', () => {
                this._setupConnection(conn);
                resolve(conn);
            });
            conn.on('error', (err) => {
                reject(err);
            });
        });
    }

    _setupConnection(conn) {
        this.connections[conn.peer] = conn;
        conn.on('data', (data) => {
            if (data && data.type) {
                this.emit(data.type, data.payload, conn.peer);
            }
        });
        conn.on('close', () => {
            delete this.connections[conn.peer];
            this.emit('player_disconnected', { playerId: conn.peer }, conn.peer);
        });
        if (this.isHost) {
            this.emit('player_connected', { playerId: conn.peer }, conn.peer);
        }
    }

    sendTo(peerId, type, payload) {
        const conn = this.connections[peerId];
        if (conn && conn.open) {
            conn.send({ type, payload });
        }
    }

    broadcast(type, payload) {
        if (!this.isHost) return;
        Object.values(this.connections).forEach(conn => {
            if (conn.open) {
                conn.send({ type, payload });
            }
        });
    }

    sendToHost(type, payload) {
        if (this.isHost) return;
        const hostPeerId = Object.keys(this.connections)[0];
        if (hostPeerId) {
            this.sendTo(hostPeerId, type, payload);
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

    generateId() {
        return Math.random().toString(36).substring(2, 9);
    }
}
window.ConnectionManager = ConnectionManager;