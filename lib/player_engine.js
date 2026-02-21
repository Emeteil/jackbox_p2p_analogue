class PlayerEngine {
    constructor() {
        this.connMgr = new ConnectionManager(false);
        this.me = null;
        this.otherPlayers = [];
        this.gameId = null;
        this.gameStarted = false;
        this.overlay = document.getElementById('status-overlay');
        this.container = document.getElementById('player-container');
    }

    async connect() {
        const hostId = Utils.getHashParams().host;
        if (!hostId) {
            if (window.LocalizationManager && !this.i18n) {
                this.i18n = new LocalizationManager();
                await this.i18n.init();
            }
            this.showStatus(this.i18n ? this.i18n.t('invalid_link') : "Invalid Join Link. No host ID found.");
            return;
        }
        try {
            if (window.LocalizationManager && !this.i18n) {
                this.i18n = new LocalizationManager();
                await this.i18n.init();
            }
            await this.connMgr.init();
            await this.connMgr.connectToHost(hostId);
            this.showStatus(this.i18n ? this.i18n.t('connected_waiting') : "Connected! Waiting for host initialization...");
            this.setupEventHandlers(hostId);
        } catch (e) {
            this.showStatus(this.i18n ? this.i18n.t('failed_connect') : "Failed to connect to host.");
            console.error(e);
        }
    }

    showStatus(msgText, spinner = false) {
        this.overlay.style.display = 'flex';
        this.overlay.innerHTML = `
            <div class="status-box glass-panel">
                ${spinner ? '<div class="spinner"></div>' : ''}
                <h2>${msgText}</h2>
            </div>
        `;
    }

    setupEventHandlers(hostId) {
        this.connMgr.on('WELCOME_REQUIRE_NAME', async (data) => {
            this.gameId = data.gameId;
            if (window.LocalizationManager) {
                this.i18n = new LocalizationManager(this.gameId);
                await this.i18n.init();
            }
            try {
                await Promise.all([
                    Utils.loadCSS(`games/${this.gameId}/style.css`).catch(() => { }),
                    Utils.loadScript(`games/${this.gameId}/player.js`).catch(() => { })
                ]);
            } catch (e) { }
            const saved = localStorage.getItem(`session_${hostId}`);
            if (saved) {
                const session = JSON.parse(saved);
                if (Date.now() - session.ts < 24 * 60 * 60 * 1000) {
                    this.connMgr.sendToHost('SET_NAME', { name: session.name });
                    this.showStatus(this.i18n ? this.i18n.t('reconnecting_as', { name: session.name }) : `Reconnecting as ${session.name}...`, true);
                    return;
                }
            }
            this.showNamePrompt();
        });

        this.connMgr.on('NAME_REJECTED', (data) => {
            this.showNamePrompt(data.reason);
        });

        this.connMgr.on('NAME_ACCEPTED', (data) => {
            this.me = data.player;
            localStorage.setItem(`session_${hostId}`, JSON.stringify({
                name: this.me.name,
                ts: Date.now()
            }));
            this.updateSidebar();
            if (this.me.isLeader && !this.gameStarted) {
                this.showVipLobby();
            } else if (!this.gameStarted) {
                this.showStatus(this.i18n ? this.i18n.t('waiting_vip_start') : "Waiting for VIP to start game...", true);
            } else {
                this.overlay.style.display = 'none';
            }
        });

        this.connMgr.on('PROMOTED_TO_VIP', () => {
            if (this.me) {
                this.me.isLeader = true;
                this.updateSidebar();
                if (!this.gameStarted) {
                    this.showVipLobby();
                }
            }
        });

        this.connMgr.on('GAME_START', () => {
            this.overlay.style.display = 'none';
            this.gameStarted = true;
            this.updateSidebar();
            if (typeof window.initPlayerGame === 'function') {
                window.initPlayerGame(this.connMgr, this.me, this.i18n);
                window._playerInitialized = true;
            }
        });

        this.connMgr.on('RENDER_TEMPLATE', (data) => {
            this.container.innerHTML = data.html;
            if (!window._playerInitialized && typeof window.initPlayerGame === 'function') {
                window.initPlayerGame(this.connMgr, this.me, this.i18n);
                window._playerInitialized = true;
            }
        });

        this.connMgr.on('LOBBY_SYNC', (data) => {
            this.otherPlayers = data.players.filter(p => p.id !== this.me.id);
            this.gameStarted = data.gameStarted;
            this.minPlayers = data.minPlayers || 1;
            if (this.me) {
                this.updateSidebar();
                if (this.me.isLeader && !this.gameStarted && document.getElementById('vip-start-btn')) {
                    this.showVipLobby();
                }
            }
        });

        this.connMgr.on('SET_STYLE', (data) => {
            if (data.backgroundColor) document.body.style.backgroundColor = data.backgroundColor;
            if (data.textColor) document.body.style.color = data.textColor;
        });

        this.connMgr.on('KICKED', () => {
            this.showStatus(this.i18n ? this.i18n.t('kicked') : "You have been kicked from the game.");
        });

        this.connMgr.on('player_disconnected', () => {
            if (!this._redirecting) {
                this.showStatus(this.i18n ? this.i18n.t('host_disconnected') : "Host disconnected. Please refresh or return to lobby.");
            }
        });

        this.connMgr.on('GAME_OVER_REDIRECT', () => {
            this._redirecting = true;
            this.showStatus(this.i18n ? this.i18n.t('game_over_returning') : "Game Over! Returning to lobby...", true);
            setTimeout(() => {
                const path = window.location.pathname;
                const rootPath = path.substring(0, path.lastIndexOf('/'));
                window.location.href = rootPath + '/index.html';
            }, 3000);
        });
    }

    showNamePrompt(errorMsg = '') {
        this.overlay.style.display = 'flex';
        const title = this.i18n ? this.i18n.t('enter_name') : 'Enter your name';
        const placeholder = this.i18n ? this.i18n.t('your_name') : 'Your Name';
        const joinBtnText = this.i18n ? this.i18n.t('join') : 'Join';

        this.overlay.innerHTML = `
            <div class="status-box glass-panel">
                <h2>${title}</h2>
                ${errorMsg ? `<p style="color: #ef4444; font-weight:bold; margin-bottom: 0.5rem;">${errorMsg}</p>` : ''}
                <input type="text" id="nickname-input" placeholder="${placeholder}" style="width: 100%; padding: 1rem; border-radius: 8px; margin: 1rem 0; font-family: var(--font-body); font-size: 1.2rem;">
                <button id="join-btn" class="primary-btn">${joinBtnText}</button>
            </div>
        `;
        document.getElementById('join-btn').onclick = () => {
            const nick = document.getElementById('nickname-input').value;
            this.connMgr.sendToHost('SET_NAME', { name: nick });
            this.showStatus("...", true);
        };
    }

    showVipLobby() {
        const activeCount = this.otherPlayers.length + 1;
        const canStart = activeCount >= this.minPlayers;
        this.overlay.style.display = 'flex';

        const title = this.i18n ? this.i18n.t('you_are_vip') : 'You are the VIP 👑';
        const playersText = this.i18n ? this.i18n.t('players_count', { current: activeCount, min: this.minPlayers }) : `Players: ${activeCount} / ${this.minPlayers} (min)`;
        const startBtnText = canStart ?
            (this.i18n ? this.i18n.t('start_game') : 'Start Game') :
            (this.i18n ? this.i18n.t('need_more', { count: this.minPlayers - activeCount }) : `Need ${this.minPlayers - activeCount} more...`);

        this.overlay.innerHTML = `
            <div class="status-box glass-panel">
                <h2>${title}</h2>
                <p>${playersText}</p>
                <button id="vip-start-btn" class="primary-btn" ${canStart ? '' : 'disabled'} style="margin-top:20px; background-color: ${canStart ? '#fbbf24' : '#64748b'}; color: black;">
                    ${startBtnText}
                </button>
            </div>
        `;
        const btn = document.getElementById('vip-start-btn');
        if (canStart) {
            btn.onclick = () => {
                this.connMgr.sendToHost('VIP_START_GAME', {});
                btn.disabled = true;
                btn.textContent = this.i18n ? this.i18n.t('starting') : "Starting...";
            };
        }
    }

    updateSidebar() {
        if (!this.me) return;
        const sidebar = document.getElementById('player-sidebar');
        if (!sidebar) return;

        const vipBadge = this.i18n ? this.i18n.t('vip') : 'VIP 👑';
        const playerBadge = this.i18n ? this.i18n.t('player') : 'PLAYER';
        const changeNick = this.i18n ? this.i18n.t('change_nickname') : 'Change Nickname';
        const adminTools = this.i18n ? this.i18n.t('admin_tools') : 'Admin Tools';
        const kickPlayerLabel = this.i18n ? this.i18n.t('kick_player') : 'Kick player:';
        const forceEndGame = this.i18n ? this.i18n.t('force_end_game') : 'Force End Game';
        const confirmEndText = this.i18n ? this.i18n.t('confirm_end_game') : 'End game for everyone?';

        let html = `
            <div class="sidebar-header">
                <h3 style="margin-bottom:0.4rem;">${this.me.name}</h3>
                ${this.me.isLeader ? `<div class="vip-badge">${vipBadge}</div>` : `<div class="vip-badge" style="background:#475569; color:white;">${playerBadge}</div>`}
            </div>
            <button class="sidebar-btn" onclick="appEngine.showNamePrompt()">${changeNick}</button>
        `;
        if (this.me.isLeader) {
            html += `
                <hr style="border-color: rgba(255,255,255,0.1); margin: 1rem 0;">
                <h4 style="color:var(--text-secondary); margin-bottom: 0.5rem; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 1px;">${adminTools}</h4>
                <div id="kick-list" style="margin-bottom: 1rem; margin-top: 1rem; display: ${this.gameStarted ? 'none' : 'block'};">
                    <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.5rem;">${kickPlayerLabel}</p>
                    <div id="sidebar-player-list"></div>
                </div>
                <button class="sidebar-btn danger" onclick="if(confirm('${confirmEndText}')) appEngine.connMgr.sendToHost('ADMIN_END_GAME', {})" style="margin-top: 1rem;">${forceEndGame}</button>
            `;
        }
        document.getElementById('sidebar-content').innerHTML = html;
        if (this.me.isLeader) this.refreshKickList();
    }

    refreshKickList() {
        const listEl = document.getElementById('sidebar-player-list');
        if (!listEl || !this.otherPlayers) return;
        listEl.innerHTML = '';
        this.otherPlayers.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'sidebar-btn warning';
            btn.style.padding = '0.4rem 0.8rem';
            btn.style.fontSize = '0.9rem';

            const kickText = this.i18n ? this.i18n.t('kick') : 'Kick';
            const confirmKickText = this.i18n ? this.i18n.t('confirm_kick', { name: p.name }) : `Kick ${p.name}?`;

            btn.textContent = `${kickText} ${p.name}`;
            btn.onclick = () => {
                if (confirm(confirmKickText)) {
                    this.connMgr.sendToHost('ADMIN_KICK', { targetId: p.id });
                }
            };
            listEl.appendChild(btn);
        });
    }
}
window.PlayerEngine = PlayerEngine;