class HostEngine {
    constructor(gameId, minPlayers = 1) {
        this.gameId = gameId;
        this.minPlayers = minPlayers;
        this.connMgr = new ConnectionManager(true);
        this.players = [];
        this.onStartGame = null;
        this.onPlayerAction = null;
        this.gameStarted = false;
    }

    async initLobby(qrCanvasId, urlBadgeId, playersListId, startBtnId) {
        try {
            if (window.LocalizationManager) {
                this.i18n = new LocalizationManager(this.gameId);
                await this.i18n.init();
            }
            const hostId = await this.connMgr.init();
            const joinUrl = Utils.generateJoinUrl(hostId);
            const joinUrlEl = document.getElementById(urlBadgeId);
            if (joinUrlEl) joinUrlEl.textContent = joinUrl;
            const qrCanvas = document.getElementById(qrCanvasId);
            if (qrCanvas) {
                QRCode.toCanvas(qrCanvas, joinUrl, { width: 220, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } }, (err) => {
                    if (err) console.error('QR Generate Error:', err);
                });
            }
            this.setupEventHandlers(playersListId, startBtnId);
        } catch (e) {
            console.error('Failed to init HostEngine:', e);
            alert('Host Initialization failed.');
        }
    }

    setupEventHandlers(playersListId, startBtnId) {
        this.connMgr.on('player_connected', (data, peerId) => {
            setTimeout(() => {
                this.connMgr.sendTo(peerId, 'WELCOME_REQUIRE_NAME', {
                    gameId: this.gameId,
                    lang: this.i18n ? this.i18n.lang : 'en'
                });
            }, 500);
        });

        this.connMgr.on('player_disconnected', (data, peerId) => {
            this.handlePlayerDisconnect(peerId, playersListId, startBtnId);
        });

        this.connMgr.on('SET_NAME', (data, peerId) => {
            const reqName = data.name.trim() || (this.i18n ? this.i18n.t('anonymous') : 'Anonymous');
            const existingPlayer = this.players.find(p => p.name.toLowerCase() === reqName.toLowerCase());
            if (this.gameStarted) {
                if (existingPlayer && existingPlayer.disconnected) {
                    existingPlayer.id = peerId;
                    existingPlayer.disconnected = false;
                    this.connMgr.sendTo(peerId, 'NAME_ACCEPTED', { player: existingPlayer });
                    this.updatePlayersUI(playersListId, startBtnId);
                    this.broadcastLobbySync();
                    this.connMgr.sendTo(peerId, 'GAME_START', { isResume: true });
                    if (this.onPlayerReconnect) this.onPlayerReconnect(existingPlayer);
                    return;
                } else {
                    this.connMgr.sendTo(peerId, 'NAME_REJECTED', { reason: this.i18n ? this.i18n.t('game_in_progress') : 'Game already in progress. New joins disabled.' });
                    return;
                }
            }
            if (existingPlayer && existingPlayer.id !== peerId) {
                this.connMgr.sendTo(peerId, 'NAME_REJECTED', { reason: this.i18n ? this.i18n.t('nickname_taken') : 'Nickname is already taken!' });
                return;
            }
            let player = this.players.find(p => p.id === peerId);
            if (!player) {
                const isFirst = this.players.length === 0;
                player = { id: peerId, name: reqName, isLeader: isFirst, disconnected: false };
                this.players.push(player);
            } else {
                player.name = reqName;
            }
            this.connMgr.sendTo(peerId, 'NAME_ACCEPTED', { player: player });
            this.updatePlayersUI(playersListId, startBtnId);
            this.broadcastLobbySync();
        });

        this.connMgr.on('VIP_START_GAME', () => {
            const activePlayers = this.players.filter(p => !p.disconnected);
            if (activePlayers.length < this.minPlayers) return;
            this.gameStarted = true;
            this.connMgr.broadcast('GAME_START', {});
            if (this.onStartGame) this.onStartGame();
            this.broadcastLobbySync();
        });

        this.connMgr.on('ADMIN_KICK', (data, peerId) => {
            if (this.gameStarted) return;
            const sender = this.players.find(p => p.id === peerId);
            if (sender && sender.isLeader) {
                const targetId = data.targetId;
                const targetConn = this.connMgr.connections[targetId];
                if (targetConn) {
                    this.connMgr.sendTo(targetId, 'KICKED', {});
                    this.players = this.players.filter(p => p.id !== targetId);
                    setTimeout(() => targetConn.close(), 500);
                    this.updatePlayersUI(playersListId, startBtnId);
                    this.broadcastLobbySync();
                }
            }
        });

        this.connMgr.on('ADMIN_END_GAME', (data, peerId) => {
            const sender = this.players.find(p => p.id === peerId);
            if (sender && sender.isLeader) {
                window.location.href = '/';
            }
        });
    }

    broadcastLobbySync() {
        this.connMgr.broadcast('LOBBY_SYNC', {
            players: this.players.map(p => ({ id: p.id, name: p.name, isLeader: p.isLeader, disconnected: p.disconnected })),
            gameStarted: !!this.gameStarted,
            minPlayers: this.minPlayers
        });
    }

    handlePlayerDisconnect(peerId, playersListId, startBtnId) {
        const player = this.players.find(p => p.id === peerId);
        if (!player) return;
        if (this.gameStarted) {
            player.disconnected = true;
        } else {
            this.players = this.players.filter(p => p.id !== peerId);
            if (this.players.length > 0 && !this.players.some(p => p.isLeader)) {
                this.players[0].isLeader = true;
                this.connMgr.sendTo(this.players[0].id, 'PROMOTED_TO_VIP', {});
            }
        }
        this.updatePlayersUI(playersListId, startBtnId);
        this.broadcastLobbySync();
    }

    updatePlayersUI(playersListId, startBtnId) {
        const listEl = document.getElementById(playersListId);
        if (listEl) {
            listEl.innerHTML = '';
            this.players.forEach(p => {
                const el = document.createElement('div');
                el.className = `player-tag ${p.isLeader ? 'leader' : ''} ${p.disconnected ? 'disconnected' : ''}`;
                const offText = this.i18n ? this.i18n.t('off') : 'OFF';
                el.innerHTML = `${p.name} ${p.isLeader ? '<span>👑</span>' : ''} ${p.disconnected ? `(${offText})` : ''}`;
                listEl.appendChild(el);
            });
        }
        const activePlayers = this.players.filter(p => !p.disconnected);
        const countEl = document.getElementById('player-count');
        if (countEl) countEl.textContent = activePlayers.length;
        const startBtn = document.getElementById(startBtnId);
        if (startBtn) {
            if (activePlayers.length > 0) {
                startBtn.style.display = 'block';
                if (activePlayers.length < this.minPlayers) {
                    startBtn.disabled = true;
                    startBtn.textContent = this.i18n ? this.i18n.t('need_players', { count: this.minPlayers }) : `Need ${this.minPlayers} players...`;
                } else {
                    startBtn.disabled = true;
                    startBtn.textContent = this.i18n ? this.i18n.t('waiting_vip') : "Waiting for VIP to start...";
                }
            } else {
                startBtn.style.display = 'none';
            }
        }
    }

    setPlayerStyle(styleObj) {
        this.connMgr.broadcast('SET_STYLE', styleObj);
    }

    sendTemplate(peerId, htmlString, injections = {}) {
        let finalHtml = htmlString;
        for (const [key, value] of Object.entries(injections)) {
            finalHtml = finalHtml.split(`{{${key}}}`).join(value);
        }
        this.connMgr.sendTo(peerId, 'RENDER_TEMPLATE', { html: finalHtml });
    }

    broadcastTemplate(htmlString, dynamicInjector = null) {
        this.players.forEach(p => {
            if (p.disconnected) return;
            let html = htmlString;
            if (dynamicInjector) {
                html = dynamicInjector(p, html);
            }
            this.connMgr.sendTo(p.id, 'RENDER_TEMPLATE', { html });
        });
    }
}
window.HostEngine = HostEngine;