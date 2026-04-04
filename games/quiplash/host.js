window.bindGameToEngine = (engine) => {
    const EMOJIS = ['😎', '🤡', '🧠', '🥵', '🌚', '🥴', '🤯', '👹', '🥸', '🤪', '👽', '🤠', '🧐', '😱', '🤥', '🤤', '🥶', '🤬'];
    const WRITE_TIME = 60;
    const WRITE_TIME_FINAL = 90;
    const VOTE_TIME = 15;
    const PROMPTS_PER_PLAYER = 2;

    const state = {
        phase: 'lobby',
        round: 0,
        questions: { round1: [], round2: [], final: [] },
        templates: {},
        matchups: [],
        currentMatchup: 0,
        votes: {},
        timerInterval: null,
        timeLeft: 0,
        answersReceived: {},
        videoBg: null,
    };

    const ui = {
        container: document.getElementById('game-container'),
    };

    function assignEmojis() {
        const pool = shuffle(EMOJIS);
        engine.players.forEach((p, i) => {
            p.emoji = pool[i % pool.length];
            p.score = 0;
            p.prevScore = 0;
        });
    }

    async function loadAssets() {
        const [r1, r2, fin, tplWrite, tplWriteFinal, tplVote, tplWait] = await Promise.all([
            fetch('questions/round1.json').then(r => r.json()),
            fetch('questions/round2.json').then(r => r.json()),
            fetch('questions/final.json').then(r => r.json()),
            fetch('templates/write.html').then(r => r.text()),
            fetch('templates/write_final.html').then(r => r.text()),
            fetch('templates/vote.html').then(r => r.text()),
            fetch('templates/waiting.html').then(r => r.text()),
        ]);
        state.questions.round1 = shuffle(r1);
        state.questions.round2 = shuffle(r2);
        state.questions.final = shuffle(fin);
        state.templates.write = tplWrite;
        state.templates.writeFinal = tplWriteFinal;
        state.templates.vote = tplVote;
        state.templates.wait = tplWait;
    }

    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function setVideoBg(filename, loop = true, pingPong = false) {
        if (state.videoBg) {
            state.videoBg.remove();
        }
        const video = document.createElement('video');
        video.className = 'ql-video-bg';
        video.src = `videos/${filename}`;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;

        if (pingPong) {
            video.loop = false;
            let forward = true;
            let lastTime = Date.now();
            let animFrame;

            function animate() {
                if (!document.body.contains(video)) return;
                const now = Date.now();
                const dt = (now - lastTime) / 1000;
                lastTime = now;

                if (!forward) {
                    video.currentTime = Math.max(0, video.currentTime - dt);
                    if (video.currentTime <= 0.05) {
                        forward = true;
                        video.play().catch(() => { });
                    }
                }
                animFrame = requestAnimationFrame(animate);
            }

            video.addEventListener('ended', () => {
                forward = false;
                video.pause();
                lastTime = Date.now();
                if (animFrame) cancelAnimationFrame(animFrame);
                animFrame = requestAnimationFrame(animate);
            });
        } else {
            video.loop = loop;
        }

        video.play().catch(() => { });
        document.body.prepend(video);
        state.videoBg = video;
    }

    async function playTransition(filename) {
        SoundManager.play('whoosh', false, 0.6);
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.className = 'ql-transition-video';
            video.src = `videos/${filename}`;
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.onended = () => {
                video.remove();
                resolve();
            };
            video.onerror = () => {
                video.remove();
                resolve();
            };
            document.body.appendChild(video);
            video.play().catch(() => { video.remove(); resolve(); });
        });
    }

    function delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function startTimer(seconds, onTick, onEnd) {
        clearInterval(state.timerInterval);
        state.timeLeft = seconds;
        if (onTick) onTick(state.timeLeft);
        state.timerInterval = setInterval(() => {
            state.timeLeft--;
            if (onTick) onTick(state.timeLeft);
            if (state.timeLeft <= 0) {
                clearInterval(state.timerInterval);
                if (onEnd) onEnd();
            }
        }, 1000);
    }

    function clearTimer() {
        clearInterval(state.timerInterval);
    }

    function getActivePlayers() {
        return engine.players.filter(p => !p.disconnected);
    }

    function buildMatchups(questions, round) {
        const players = getActivePlayers();
        const n = players.length;
        const needed = n;
        const pool = questions.splice(0, needed);
        const matchups = [];

        for (let i = 0; i < n; i++) {
            const p1 = players[i];
            const p2 = players[(i + 1) % n];
            const q = pool[i] || pool[0];
            let prompt = q.prompt;
            if (q.hasPlayerName) {
                const randomPlayer = players[Math.floor(Math.random() * players.length)];
                prompt = prompt.replace(/<ANYPLAYER>/gi, randomPlayer.name);
            }
            matchups.push({
                prompt: prompt,
                safetyQuips: q.safetyQuips || [],
                players: [p1.id, p2.id],
                answers: [null, null],
                playerNames: [p1.name, p2.name],
                playerEmojis: [p1.emoji, p2.emoji],
                round: round,
            });
        }
        return matchups;
    }

    function getPlayerPrompts(playerId) {
        return state.matchups
            .map((m, idx) => ({ matchup: m, index: idx, slot: m.players.indexOf(playerId) }))
            .filter(x => x.slot !== -1);
    }

    function sendWriteTemplate(playerId) {
        const prompts = getPlayerPrompts(playerId);
        const unanswered = prompts.filter(p => p.matchup.answers[p.slot] === null);
        if (unanswered.length === 0) {
            engine.sendTemplate(playerId, state.templates.wait, { message: 'Все ответы отправлены! Ожидайте...' });
            return;
        }
        const current = unanswered[0];
        const total = prompts.length;
        const currentNum = total - unanswered.length + 1;

        if (state.round === 3) {
            engine.sendTemplate(playerId, state.templates.writeFinal, {
                prompt: current.matchup.prompt,
                current: currentNum,
                total: total,
            });
        } else {
            engine.sendTemplate(playerId, state.templates.write, {
                prompt: current.matchup.prompt,
                current: currentNum,
                total: total,
            });
        }
    }

    function allAnswersIn() {
        return state.matchups.every(m =>
            m.answers[0] !== null && m.answers[1] !== null
        );
    }

    function applySafetyQuips() {
        state.matchups.forEach(m => {
            for (let i = 0; i < 2; i++) {
                if (m.answers[i] === null || m.answers[i] === '') {
                    const quips = m.safetyQuips;
                    m.answers[i] = quips.length > 0
                        ? quips[Math.floor(Math.random() * quips.length)]
                        : '...';
                    m.isSafety = m.isSafety || [];
                    m.isSafety[i] = true;
                }
            }
        });
    }

    function getScoreMultiplier() {
        if (state.round === 1) return 1;
        if (state.round === 2) return 2;
        return 3;
    }

    function spawnConfetti() {
        const container = document.createElement('div');
        container.className = 'ql-confetti';
        const colors = ['#fbbf24', '#ec4899', '#06b6d4', '#10b981', '#7c3aed', '#ef4444'];
        for (let i = 0; i < 60; i++) {
            const piece = document.createElement('div');
            piece.className = 'ql-confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = (2 + Math.random() * 3) + 's';
            piece.style.animationDelay = Math.random() * 2 + 's';
            piece.style.width = (6 + Math.random() * 8) + 'px';
            piece.style.height = (6 + Math.random() * 8) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            container.appendChild(piece);
        }
        document.body.appendChild(container);
        setTimeout(() => container.remove(), 6000);
    }

    engine.onStartGame = async () => {
        document.getElementById('lobby-ui').style.display = 'none';
        SoundManager.stopAll();
        assignEmojis();
        await loadAssets();
        engine.connMgr.broadcast('QUIPLASH_RESET_PROMPT_INDEX', {});
        await showIntro();
        await runRound(1);
        await runRound(2);
        await runFinal();
        await showWinner();
    };

    async function showIntro() {
        setVideoBg('quiplash3_bg_intro.mp4', true);
        SoundManager.playMusic('bg_round1', 0.15);
        ui.container.innerHTML = `
            <div class="ql-host ql-title-screen">
                <div class="ql-logo">КВИПЛЭШ</div>
                <div class="ql-subtitle">Игра в остроумие</div>
            </div>
        `;
        engine.broadcastTemplate(state.templates.wait, () => { }, { message: 'Игра начинается!' });
        getActivePlayers().forEach(p => {
            engine.sendTemplate(p.id, state.templates.wait, { message: 'Игра начинается!' });
        });
        await Narrator.speakCategory('intro');
        await delay(2000);
        SoundManager.stopMusic();
    }

    async function runRound(roundNum) {
        state.round = roundNum;
        state.currentMatchup = 0;

        const questionPool = roundNum === 1 ? state.questions.round1 : state.questions.round2;
        state.matchups = buildMatchups(questionPool, roundNum);

        const bgFile = roundNum === 1 ? 'quiplash3_bg_writing_1.mp4' : 'quiplash3_bg_writing_2.mp4';
        const transFile = roundNum === 1 ? 'quiplash3_transition_writingReveal_1.mp4' : 'quiplash3_transition_writingReveal_2.mp4';
        const revealBg = roundNum === 1 ? 'quiplash3_bg_reveal_1.mp4' : 'quiplash3_bg_reveal_2.mp4';
        const writeTrack = roundNum === 1 ? 'write_round1' : 'write_round2';
        const voteTrack = roundNum === 1 ? 'vote_round1' : 'vote_round2';

        await showRoundBanner(roundNum);
        setVideoBg(bgFile, true, false);
        SoundManager.playMusic(writeTrack, 0.15);
        await writePhase();
        SoundManager.stopMusic();
        await playTransition(transFile);
        setVideoBg(revealBg);
        SoundManager.playMusic(voteTrack, 0.15);
        await votePhase();
        SoundManager.stopMusic();
        setVideoBg('quiplash3_bg_scoreboard.mp4');
        SoundManager.playMusic('scoreboard', 0.15);
        await showScoreboard();
        SoundManager.stopMusic();
    }

    async function runFinal() {
        state.round = 3;
        state.currentMatchup = 0;

        // Take from final pool, ring-pair like Round 1/2
        state.matchups = buildMatchups(state.questions.final, 3);
        state.matchups.forEach(m => {
            m.isFinal = true;
            m.answersRaw = [null, null];
        });

        await showRoundBanner(3);
        setVideoBg('quiplash3_bg_writing_3.mp4', true, false);
        SoundManager.playMusic('write_final', 0.15);
        await writePhaseFinal();
        SoundManager.stopMusic();
        await playTransition('quiplash3_transition_writingReveal_3.mp4');
        setVideoBg('quiplash3_bg_reveal_3.mp4');
        SoundManager.playMusic('vote_final', 0.15);
        await votePhaseFinal();
        SoundManager.stopMusic();
        setVideoBg('quiplash3_bg_scoreboard.mp4');
        SoundManager.playMusic('scoreboard', 0.15);
        await showScoreboard();
        SoundManager.stopMusic();
    }

    async function showRoundBanner(roundNum) {
        const titles = { 1: 'РАУНД 1', 2: 'РАУНД 2', 3: 'ТРИПЛЭШ' };
        const subtitles = {
            1: 'Придумайте самые смешные ответы!',
            2: 'Очки удваиваются!',
            3: 'Один вопрос — три ответа! Очки утраиваются!'
        };

        ui.container.innerHTML = `
            <div class="ql-host">
                <div class="ql-round-banner">
                    <div class="ql-round-title">${titles[roundNum]}</div>
                    <div class="ql-round-subtitle">${subtitles[roundNum]}</div>
                </div>
            </div>
        `;

        const cats = { 1: 'round1Start', 2: 'round2Start', 3: 'finalStart' };
        await Narrator.speakCategory(cats[roundNum]);
        await delay(1500);
    }

    async function writePhase() {
        state.phase = 'writing';

        getActivePlayers().forEach(p => {
            engine.connMgr.sendTo(p.id, 'QUIPLASH_RESET_PROMPT_INDEX', {});
            engine.connMgr.sendTo(p.id, 'QUIPLASH_SET_TOTAL_PROMPTS', { total: PROMPTS_PER_PLAYER });
            sendWriteTemplate(p.id);
        });

        renderWritePhaseUI();

        return new Promise((resolve) => {
            let warningSpoken = false;
            startTimer(WRITE_TIME,
                (t) => {
                    updateTimerUI(t);
                    if (t === 10 && !warningSpoken) {
                        warningSpoken = true;
                        Narrator.speakCategory('writeTimeWarning');
                    }
                },
                () => {
                    applySafetyQuips();
                    Narrator.speakCategory('writeTimeUp').then(() => {
                        getActivePlayers().forEach(p => {
                            engine.sendTemplate(p.id, state.templates.wait, { message: 'Время вышло!' });
                        });
                        setTimeout(resolve, 2000);
                    });
                }
            );

            state._writeResolve = () => {
                clearTimer();
                getActivePlayers().forEach(p => {
                    engine.sendTemplate(p.id, state.templates.wait, { message: 'Все ответили! Ожидайте...' });
                });
                setTimeout(resolve, 1500);
            };
        });
    }

    async function writePhaseFinal() {
        state.phase = 'writing_final';

        getActivePlayers().forEach(p => {
            engine.connMgr.sendTo(p.id, 'QUIPLASH_RESET_PROMPT_INDEX', {});
            engine.connMgr.sendTo(p.id, 'QUIPLASH_SET_TOTAL_PROMPTS', { total: PROMPTS_PER_PLAYER });
            sendWriteTemplate(p.id);
        });

        renderWritePhaseUI();

        return new Promise((resolve) => {
            let warningSpoken = false;
            startTimer(WRITE_TIME_FINAL,
                (t) => {
                    updateTimerUI(t);
                    if (t === 10 && !warningSpoken) {
                        warningSpoken = true;
                        Narrator.speakCategory('writeTimeWarning');
                    }
                },
                () => {
                    applyFinalSafetyQuips();
                    Narrator.speakCategory('writeTimeUp').then(() => {
                        getActivePlayers().forEach(p => {
                            engine.sendTemplate(p.id, state.templates.wait, { message: 'Время вышло!' });
                        });
                        setTimeout(resolve, 2000);
                    });
                }
            );

            state._finalWriteResolve = () => {
                clearTimer();
                getActivePlayers().forEach(p => {
                    engine.sendTemplate(p.id, state.templates.wait, { message: 'Все ответили! Ожидайте...' });
                });
                setTimeout(resolve, 1500);
            };
        });
    }

    function applyFinalSafetyQuips() {
        state.matchups.forEach(m => {
            if (!m.isFinal) return;
            for (let i = 0; i < 2; i++) {
                if (m.answers[i] === null || m.answers[i] === '') {
                    const quips = m.safetyQuips;
                    let safetySet = ['...', '...', '...'];
                    if (quips.length > 0) {
                        const picked = quips[Math.floor(Math.random() * quips.length)];
                        safetySet = picked.split('|').map(s => s.trim());
                        while (safetySet.length < 3) safetySet.push('...');
                    }
                    m.answers[i] = safetySet.join(' | ');
                    m.answersRaw = m.answersRaw || [null, null];
                    m.answersRaw[i] = safetySet;
                    m.isSafety = m.isSafety || [];
                    m.isSafety[i] = true;
                }
            }
        });
    }

    function renderWritePhaseUI() {
        const players = getActivePlayers();
        const roundLabel = state.round === 3 ? 'ТРИПЛЭШ' : `РАУНД ${state.round}`;
        const timeVal = state.round === 3 ? WRITE_TIME_FINAL : WRITE_TIME;
        ui.container.innerHTML = `
            <div class="ql-host ql-write-phase-centered">
                <div class="ql-write-header-large">${roundLabel}</div>
                <div class="ql-timer-ring-large">
                    <div class="ql-timer-text-large" id="ql-timer">${timeVal}</div>
                </div>
                <div class="ql-write-hint">Проверьте свои телефоны!</div>
                <div class="ql-players-progress" id="ql-progress">
                    ${players.map(p => `
                        <div class="ql-player-chip" id="chip-${p.id}">
                            <span class="emoji">${p.emoji}</span>
                            <span>${p.name}</span>
                            <span class="status-icon">✏️</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function updateTimerUI(t) {
        const el = document.getElementById('ql-timer');
        if (!el) return;
        el.textContent = t;
        if (t <= 10) el.classList.add('warning');
        else el.classList.remove('warning');
    }

    function markPlayerDone(playerId) {
        const chip = document.getElementById(`chip-${playerId}`);
        if (chip) {
            chip.classList.add('done');
            const icon = chip.querySelector('.status-icon');
            if (icon) icon.textContent = '✅';
        }
    }

    async function votePhase() {
        state.phase = 'voting';

        for (let i = 0; i < state.matchups.length; i++) {
            state.currentMatchup = i;
            await runSingleDuel(state.matchups[i], i, state.matchups.length);
        }
    }

    async function votePhaseFinal() {
        state.phase = 'voting_final';

        for (let i = 0; i < state.matchups.length; i++) {
            state.currentMatchup = i;
            await runSingleDuel(state.matchups[i], i, state.matchups.length);
        }
    }

    async function runSingleDuel(matchup, duelIndex, totalDuels) {
        state.votes = {};
        const voters = getActivePlayers().filter(
            p => !matchup.players.includes(p.id)
        );

        const isFinal = matchup.isFinal;

        ui.container.innerHTML = `
            <div class="ql-host ql-duel-phase">
                <div class="ql-duel-counter">Дуэль ${duelIndex + 1} из ${totalDuels}</div>
                <div class="ql-prompt-fullscreen" id="ql-prompt-big">${matchup.prompt}</div>
                <div class="ql-duel-body" id="ql-duel-body" style="display:none;">
                    <div class="ql-duel-prompt" id="ql-prompt-small">${matchup.prompt}</div>
                    <div class="ql-duel-answers" id="ql-answers-area">
                        <div class="ql-answer-card yellow" id="ql-card-0">
                            <div class="ql-answer-text" id="ql-text-0">???</div>
                            <div class="ql-vote-fill" id="ql-fill-0"></div>
                            <div class="ql-vote-percent" id="ql-pct-0"></div>
                            <div class="ql-author-reveal" id="ql-author-0"></div>
                        </div>
                        <div class="ql-answer-card cyan" id="ql-card-1">
                            <div class="ql-answer-text" id="ql-text-1">???</div>
                            <div class="ql-vote-fill" id="ql-fill-1"></div>
                            <div class="ql-vote-percent" id="ql-pct-1"></div>
                            <div class="ql-author-reveal" id="ql-author-1"></div>
                        </div>
                    </div>
                    <div class="ql-vote-timer" id="ql-vote-timer"></div>
                </div>
            </div>
        `;

        await Narrator.speakPrompt(matchup.prompt);
        await delay(300);

        const bigPrompt = document.getElementById('ql-prompt-big');
        const duelBody = document.getElementById('ql-duel-body');
        if (bigPrompt) bigPrompt.classList.add('shrink-to-top');
        await delay(600);
        if (bigPrompt) bigPrompt.style.display = 'none';
        if (duelBody) duelBody.style.display = 'flex';

        await delay(400);

        if (isFinal && matchup.answersRaw) {
            await revealFinalAnswers(matchup, 0);
            await delay(600);
            await revealFinalAnswers(matchup, 1);
        } else {
            const text0 = document.getElementById('ql-text-0');
            if (text0) { text0.textContent = matchup.answers[0]; text0.classList.add('answer-pop'); }
            await delay(800);
            const text1 = document.getElementById('ql-text-1');
            if (text1) { text1.textContent = matchup.answers[1]; text1.classList.add('answer-pop'); }
        }

        await delay(500);

        voters.forEach(p => {
            engine.sendTemplate(p.id, state.templates.vote, {
                prompt: matchup.prompt,
                answer0: matchup.answers[0],
                answer1: matchup.answers[1],
            });
        });

        matchup.players.forEach(pid => {
            engine.sendTemplate(pid, state.templates.wait, { message: 'Зрители голосуют...' });
        });

        await new Promise((resolve) => {
            state._voteResolve = resolve;
            state._voterCount = voters.length;

            if (voters.length === 0) {
                resolve();
                return;
            }

            startTimer(VOTE_TIME,
                (t) => {
                    const el = document.getElementById('ql-vote-timer');
                    if (el) el.textContent = t;
                },
                resolve
            );
        });

        clearTimer();
        await showDuelResult(matchup);
        await delay(2000);
    }

    async function revealFinalAnswers(matchup, cardIndex) {
        const words = matchup.answersRaw[cardIndex] || ['...', '...', '...'];
        const container = document.getElementById(`ql-text-${cardIndex}`);
        if (!container) return;
        container.innerHTML = '';
        container.classList.add('ql-final-words-container');

        for (let i = 0; i < words.length; i++) {
            const wordEl = document.createElement('div');
            wordEl.className = 'ql-final-word';
            wordEl.textContent = words[i];
            wordEl.style.animationDelay = `${i * 0.4}s`;
            container.appendChild(wordEl);
            await delay(500);
        }
    }

    async function showDuelResult(matchup) {
        const voteEntries = Object.values(state.votes);
        let count0 = voteEntries.filter(v => v === 0).length;
        let count1 = voteEntries.filter(v => v === 1).length;
        const totalVotes = count0 + count1;

        let pct0 = totalVotes > 0 ? Math.round((count0 / totalVotes) * 100) : 50;
        let pct1 = totalVotes > 0 ? Math.round((count1 / totalVotes) * 100) : 50;

        if (totalVotes === 0) {
            pct0 = 50;
            pct1 = 50;
        }

        const multiplier = getScoreMultiplier();
        const basePerVote = 100;

        const fill0 = document.getElementById('ql-fill-0');
        const fill1 = document.getElementById('ql-fill-1');
        const pctEl0 = document.getElementById('ql-pct-0');
        const pctEl1 = document.getElementById('ql-pct-1');
        const author0 = document.getElementById('ql-author-0');
        const author1 = document.getElementById('ql-author-1');

        if (fill0) fill0.style.height = pct0 + '%';
        if (fill1) fill1.style.height = pct1 + '%';

        await delay(600);

        if (pctEl0) { pctEl0.textContent = pct0 + '%'; pctEl0.classList.add('visible'); }
        if (pctEl1) { pctEl1.textContent = pct1 + '%'; pctEl1.classList.add('visible'); }

        await delay(500);

        if (author0) {
            author0.textContent = `${matchup.playerEmojis[0]} ${matchup.playerNames[0]}`;
            author0.classList.add('visible');
        }
        if (author1) {
            author1.textContent = `${matchup.playerEmojis[1]} ${matchup.playerNames[1]}`;
            author1.classList.add('visible');
        }

        const p0 = engine.players.find(p => p.id === matchup.players[0]);
        const p1 = engine.players.find(p => p.id === matchup.players[1]);

        let points0 = count0 * basePerVote * multiplier;
        let points1 = count1 * basePerVote * multiplier;
        let isQuiplash = false;

        if (totalVotes > 0 && (pct0 === 100 || pct1 === 100) && totalVotes >= 2) {
            isQuiplash = true;
            if (pct0 === 100) points0 += 500 * multiplier;
            if (pct1 === 100) points1 += 500 * multiplier;
        }

        if (p0) p0.score += points0;
        if (p1) p1.score += points1;

        await delay(400);

        if (points0 > 0) showPointsPopup('ql-card-0', points0);
        if (points1 > 0) showPointsPopup('ql-card-1', points1);

        if (isQuiplash) {
            await delay(500);
            await showQuiplashEffect();
            await Narrator.speakCategory('resultQuiplash');
        } else if (pct0 === pct1) {
            await Narrator.speakCategory('resultTie');
        } else {
            await Narrator.speakCategory('resultNormal');
        }

        getActivePlayers().forEach(p => {
            engine.sendTemplate(p.id, state.templates.wait, { message: 'Следующая дуэль скоро...' });
        });
    }

    function showPointsPopup(cardId, points) {
        const card = document.getElementById(cardId);
        if (!card) return;
        const popup = document.createElement('div');
        popup.className = 'ql-points-popup';
        popup.textContent = `+${points}`;
        card.appendChild(popup);
    }

    async function showQuiplashEffect() {
        const overlay = document.createElement('div');
        overlay.className = 'ql-quiplash-overlay';
        overlay.innerHTML = `<div class="ql-quiplash-text">КВИПЛЭШ!</div>`;
        document.body.appendChild(overlay);
        spawnConfetti();
        await delay(2500);
        overlay.remove();
    }

    async function showScoreboard() {
        state.phase = 'scoreboard';

        const sorted = [...engine.players]
            .filter(p => !p.disconnected)
            .sort((a, b) => b.score - a.score);

        ui.container.innerHTML = `
            <div class="ql-host">
                <div class="ql-scoreboard">
                    <div class="ql-scoreboard-title">ТАБЛИЦА ЛИДЕРОВ</div>
                    ${sorted.map((p, i) => {
            const delta = p.score - (p.prevScore || 0);
            return `
                            <div class="ql-score-row" style="animation-delay: ${i * 0.15}s">
                                <div class="rank">${i + 1}</div>
                                <div class="player-emoji">${p.emoji}</div>
                                <div class="player-name">${p.name}</div>
                                <div class="player-score">${p.score}</div>
                                ${delta > 0 ? `<div class="score-delta">+${delta}</div>` : ''}
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;

        engine.players.forEach(p => p.prevScore = p.score);

        await Narrator.speakCategory('scoreboard');
        await delay(4000);
    }

    async function showWinner() {
        state.phase = 'winner';
        setVideoBg('quiplash3_bg_scoreboard.mp4');
        SoundManager.playMusic('credits', 0.2);

        const sorted = [...engine.players]
            .filter(p => !p.disconnected)
            .sort((a, b) => b.score - a.score);
        const winner = sorted[0];

        spawnConfetti();
        ui.container.innerHTML = `
            <div class="ql-host">
                <div class="ql-winner-screen">
                    <div class="ql-winner-crown">👑</div>
                    <div class="ql-winner-emoji">${winner.emoji}</div>
                    <div class="ql-winner-name">${winner.name}</div>
                    <div class="ql-winner-score">${winner.score} очков</div>
                </div>
            </div>
        `;

        getActivePlayers().forEach(p => {
            const isWinner = p.id === winner.id;
            engine.sendTemplate(p.id, state.templates.wait, {
                message: isWinner ? '🏆 ВЫ ПОБЕДИЛИ! 🏆' : `Победитель: ${winner.name}!`
            });
        });

        await Narrator.speakCategory('winner');
        await Narrator.speak(`Победитель — ${winner.name}! С результатом ${winner.score} очков!`);
        await delay(5000);

        SoundManager.stopMusic();
        engine.connMgr.broadcast('GAME_OVER_REDIRECT', {});
        setTimeout(() => {
            window.location.href = '../../index.html';
        }, 3000);
    }

    engine.connMgr.on('QUIPLASH_ANSWER', (data, peerId) => {
        if (state.phase !== 'writing') return;

        const prompts = getPlayerPrompts(peerId);
        const unanswered = prompts.filter(p => p.matchup.answers[p.slot] === null);
        if (unanswered.length === 0) return;

        const current = unanswered[0];
        current.matchup.answers[current.slot] = data.answer || '';

        const remaining = getPlayerPrompts(peerId).filter(p => p.matchup.answers[p.slot] === null);
        if (remaining.length > 0) {
            sendWriteTemplate(peerId);
        } else {
            markPlayerDone(peerId);
            engine.sendTemplate(peerId, state.templates.wait, { message: 'Все ответы отправлены! Ожидайте...' });
        }

        if (allAnswersIn() && state._writeResolve) {
            applySafetyQuips();
            state._writeResolve();
            state._writeResolve = null;
        }
    });

    engine.connMgr.on('QUIPLASH_FINAL_ANSWER', (data, peerId) => {
        if (state.phase !== 'writing_final' && state.phase !== 'writing') return;

        const prompts = getPlayerPrompts(peerId);
        const unanswered = prompts.filter(p => p.matchup.answers[p.slot] === null);
        if (unanswered.length === 0) return;

        const current = unanswered[0];
        const answers = data.answers || ['', '', ''];
        const joined = answers.map(a => (a || '').trim()).join(' | ');

        current.matchup.answers[current.slot] = joined;
        current.matchup.answersRaw = current.matchup.answersRaw || [null, null];
        current.matchup.answersRaw[current.slot] = answers.map(a => (a || '').trim());
        current.matchup.isFinal = true;

        const remaining = getPlayerPrompts(peerId).filter(p => p.matchup.answers[p.slot] === null);
        if (remaining.length > 0) {
            sendWriteTemplate(peerId);
        } else {
            markPlayerDone(peerId);
            engine.sendTemplate(peerId, state.templates.wait, { message: 'Все ответы отправлены! Ожидайте...' });
        }

        if (allAnswersIn()) {
            if (state.phase === 'writing' && state._writeResolve) {
                applySafetyQuips();
                state._writeResolve();
                state._writeResolve = null;
            } else if (state.phase === 'writing_final' && state._finalWriteResolve) {
                applyFinalSafetyQuips();
                state._finalWriteResolve();
                state._finalWriteResolve = null;
            }
        }
    });

    engine.connMgr.on('QUIPLASH_VOTE', (data, peerId) => {
        if (state.phase !== 'voting' && state.phase !== 'voting_final') return;

        const matchup = state.matchups[state.currentMatchup];
        if (!matchup) return;
        if (matchup.players.includes(peerId)) return;
        if (state.votes[peerId] !== undefined) return;

        state.votes[peerId] = data.vote;

        const votersDone = Object.keys(state.votes).length;
        if (votersDone >= (state._voterCount || 0) && state._voteResolve) {
            state._voteResolve();
            state._voteResolve = null;
        }
    });

    engine.onPlayerReconnect = (player) => {
        if (state.phase === 'writing') {
            sendWriteTemplate(player.id);
        } else if (state.phase === 'writing_final') {
            engine.sendTemplate(player.id, state.templates.writeFinal, {
                prompt: state.finalPrompt,
            });
        } else {
            engine.sendTemplate(player.id, state.templates.wait, {
                message: 'Переподключение... Ожидайте следующей фазы.'
            });
        }
    };
};