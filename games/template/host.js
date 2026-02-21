window.bindGameToEngine = (engine) => {
    const state = {
        scores: {},
        timeLeft: 10,
        timerInterval: null
    };

    const ui = {
        container: document.getElementById('game-container')
    };

    engine.onStartGame = async () => {
        const template = await (await fetch('templates/game.html')).text();
        const playerTemplate = await (await fetch('templates/player.html')).text();

        document.getElementById('lobby-ui').style.display = 'none';
        ui.container.innerHTML = template;

        engine.broadcastTemplate(playerTemplate);

        state.timerInterval = setInterval(() => {
            state.timeLeft--;
            const timerEl = document.getElementById('timer');
            if (timerEl) timerEl.textContent = state.timeLeft;

            if (state.timeLeft <= 0) {
                clearInterval(state.timerInterval);
                endGame();
            }
        }, 1000);
    };

    engine.onPlayerReconnect = async (player) => {
        const playerTemplate = await (await fetch('templates/player.html')).text();
        engine.sendTemplate(player.id, playerTemplate);
    };

    engine.connMgr.on('CLICK_ACTION', (data, peerId) => {
        if (state.timeLeft <= 0) return;

        const player = engine.players.find(p => p.id === peerId);
        if (player) {
            player.score = (player.score || 0) + 1;
            updateUI();
        }
    });

    function updateUI() {
        const list = document.getElementById('score-list');
        if (!list) return;

        list.innerHTML = engine.players
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map(p => `<div>${p.name}: ${p.score || 0}</div>`)
            .join('');
    }

    const i18n = engine.i18n;

    function endGame() {
        const winner = engine.players.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        const winnerName = winner ? winner.name : (i18n ? i18n.t('nobody') : 'Nobody');
        ui.container.innerHTML = `
            <div class="glass-panel" style="text-align:center;">
                <h1>${i18n ? i18n.t('game_over') : 'Game Over!'}</h1>
                <h2>${i18n ? i18n.t('winner', { name: winnerName }) : `Winner: ${winnerName}`}</h2>
            </div>
        `;
    }
};