window.bindGameToEngine = (engine) => {
    const state = {
        phase: 'lobby',
        currentQuestionIndex: 0,
        timeLeft: 0,
        timerInterval: null,
        questions: [],
        templates: {}
    };

    const SoundManager = {
        sounds: {},
        loadSound(name, url) {
            const audio = new Audio(url);
            this.sounds[name] = audio;
        },

        play(name, loop = false, volume = 0.5) {
            if (this.sounds[name]) {
                const s = this.sounds[name];
                s.loop = loop;
                s.volume = volume;
                s.currentTime = 0;
                s.play().catch(e => console.warn("Audio play blocked", e));
            }
        },

        stop(name) {
            if (this.sounds[name]) {
                this.sounds[name].pause();
                this.sounds[name].currentTime = 0;
            }
        }
    };

    SoundManager.loadSound('lobby', 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f694b.mp3');
    SoundManager.loadSound('timer', 'https://cdn.pixabay.com/audio/2021/08/09/audio_82c8907b22.mp3');
    SoundManager.loadSound('correct', 'https://cdn.pixabay.com/audio/2021/08/04/audio_bb630aa077.mp3');
    SoundManager.loadSound('wrong', 'https://cdn.pixabay.com/audio/2022/03/10/audio_c35278d65a.mp3');
    SoundManager.loadSound('start', 'https://cdn.pixabay.com/audio/2021/11/25/audio_91b32e0179.mp3');

    async function loadQuestions() {
        const lang = i18n ? i18n.lang : 'en';
        let response;
        try {
            response = await fetch(`questions_${lang}.json`);
            if (!response.ok) throw new Error();
        } catch (e) {
            response = await fetch('questions.json');
        }
        const allQuestions = await response.json();
        state.questions = allQuestions.sort(() => Math.random() - 0.5).slice(0, 5);
    }

    async function loadTemplates() {
        state.templates.waiting = await (await fetch('templates/waiting.html')).text();
        state.templates.answers = await (await fetch('templates/answers.html')).text();
        state.templates.result = await (await fetch('templates/result.html')).text();
        await loadQuestions();
    }

    const ui = {
        container: document.getElementById('game-container')
    };

    const startAudio = () => {
        SoundManager.play('lobby', true, 0.2);
        document.removeEventListener('click', startAudio);
        document.removeEventListener('keydown', startAudio);
    };

    document.addEventListener('click', startAudio);
    document.addEventListener('keydown', startAudio);
    const i18n = engine.i18n;

    engine.onStartGame = async () => {
        SoundManager.stop('lobby');
        SoundManager.play('start');
        await loadTemplates();
        document.getElementById('lobby-ui').style.display = 'none';
        ui.container.innerHTML = `
            <div class="quiz-host">
                <div id="quiz-question-container" class="glass-panel" style="margin-bottom: 2rem; position: relative;">
                    <h2 id="quiz-question">${i18n ? i18n.t('ready') : 'Ready?'}</h2>
                </div>
                <div class="quiz-timer" id="quiz-timer"></div>
                <div class="quiz-leaderboard" id="quiz-leaderboard"></div>
            </div>
        `;
        ui.question = document.getElementById('quiz-question');
        ui.timer = document.getElementById('quiz-timer');
        ui.leaderboard = document.getElementById('quiz-leaderboard');
        startRound();
    };

    async function startRound() {
        if (state.currentQuestionIndex >= state.questions.length) {
            endGame();
            return;
        }
        const q = state.questions[state.currentQuestionIndex];
        state.phase = 'question';
        engine.players.forEach(p => p.roundAnswer = null);
        ui.question.textContent = q.text;
        updateLeaderboard();
        engine.broadcastTemplate(state.templates.answers, (player, html) => {
            return html.replace('{{question}}', q.text)
                .replace('{{ans0}}', q.answers[0])
                .replace('{{ans1}}', q.answers[1])
                .replace('{{ans2}}', q.answers[2])
                .replace('{{ans3}}', q.answers[3]);
        });
        state.timeLeft = 15;
        ui.timer.textContent = state.timeLeft;
        clearInterval(state.timerInterval);
        state.timerInterval = setInterval(() => {
            state.timeLeft--;
            ui.timer.textContent = state.timeLeft;
            if (state.timeLeft <= 5 && state.timeLeft > 0) {
                SoundManager.play('timer', false, 0.4);
            }
            if (state.timeLeft <= 0) endRound();
        }, 1000);
    }

    function endRound() {
        clearInterval(state.timerInterval);
        state.phase = 'result';
        const q = state.questions[state.currentQuestionIndex];
        ui.timer.textContent = i18n ? i18n.t('done') : "DONE!";
        let anyoneCorrect = false;
        engine.players.forEach(p => {
            const isCorrect = parseInt(p.roundAnswer) === q.correct;
            if (isCorrect) {
                p.score = (p.score || 0) + 100;
                anyoneCorrect = true;
            }
            const statusText = isCorrect ? (i18n ? i18n.t('correct') : "CORRECT!") : (p.roundAnswer === null ? (i18n ? i18n.t('too_slow') : "TOO SLOW!") : (i18n ? i18n.t('wrong') : "WRONG!"));
            const bgColor = isCorrect ? "#059669" : "#dc2626";
            engine.sendTemplate(p.id, state.templates.result, {
                statusText: statusText,
                bgColor: bgColor,
                score: p.score || 0
            });
        });
        if (anyoneCorrect) SoundManager.play('correct');
        else SoundManager.play('wrong');
        updateLeaderboard();
        setTimeout(() => {
            state.currentQuestionIndex++;
            startRound();
        }, 4000);
    }

    function endGame() {
        ui.question.textContent = i18n ? i18n.t('game_over') : "Game Over!";
        ui.timer.textContent = "";
        updateLeaderboard();
        engine.players.forEach(p => {
            engine.sendTemplate(p.id, state.templates.result, {
                statusText: i18n ? i18n.t('finished') : "Finished!",
                bgColor: "#3b82f6",
                score: p.score || 0
            });
        });

        setTimeout(() => {
            engine.connMgr.broadcast('GAME_OVER_REDIRECT', {});
            window.location.href = "../../index.html";
        }, 10000);
    }

    function updateLeaderboard() {
        if (!ui.leaderboard) return;
        ui.leaderboard.innerHTML = '';
        [...engine.players].sort((a, b) => (b.score || 0) - (a.score || 0)).forEach(p => {
            const el = document.createElement('div');
            el.className = `quiz-player-score ${p.roundAnswer !== null ? 'answered' : ''}`;
            el.innerHTML = `<div>${p.name} ${p.isLeader ? '👑' : ''}</div><div class="score">${p.score || 0}</div>`;
            ui.leaderboard.appendChild(el);
        });
    }

    engine.onPlayerReconnect = (player) => {
        if (state.phase === 'question') {
            const q = state.questions[state.currentQuestionIndex];
            engine.sendTemplate(player.id, state.templates.answers, {
                question: q.text,
                ans0: q.answers[0],
                ans1: q.answers[1],
                ans2: q.answers[2],
                ans3: q.answers[3]
            });
        } else if (state.phase === 'result') {
            engine.sendTemplate(player.id, state.templates.result, {
                statusText: i18n ? i18n.t('reconnected') : "Reconnected!",
                bgColor: "#3b82f6",
                score: player.score || 0
            });
        }
    };

    engine.connMgr.on('QUIZ_ANSWER', (data, peerId) => {
        if (state.phase !== 'question') return;
        const p = engine.players.find(player => player.id === peerId);
        if (p && p.roundAnswer === null) {
            p.roundAnswer = data.answer;
            updateLeaderboard();
            if (engine.players.every(player => player.roundAnswer !== null)) {
                endRound();
            }
        }
    });
};
