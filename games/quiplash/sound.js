const SoundManager = {
    sounds: {},
    currentMusic: null,

    TRACKS: {
        lobby: 'audio/01. QUIP3 Lobby.mp3',
        bg_round1: 'audio/02. QUIP3 Background 1.mp3',
        write_round1: 'audio/03. QUIP3 Write 1.mp3',
        vote_round1: 'audio/04. QUIP3 Round 1 Vote.mp3',
        scoreboard: 'audio/05. QUIP3 Scoreboard.mp3',
        bg_round2: 'audio/06. QUIP3 Background 2.mp3',
        write_round2: 'audio/07. QUIP3 Write 2.mp3',
        vote_round2: 'audio/08. QUIP3 Round 2 Vote.mp3',
        write_final: 'audio/09. QUIP3 Write Final.mp3',
        vote_final: 'audio/10. QUIP3 Final Round Vote.mp3',
        credits: 'audio/11. QUIP3 Credits.mp3',
        credits_instrumental: 'audio/12. QUIP3 Credits (Instrumental).mp3',
        whoosh: 'audio/sudden-whoosh_zybrybe_.mp3',
    },

    init() {
        Object.entries(this.TRACKS).forEach(([name, url]) => {
            const audio = new Audio(url);
            audio.preload = 'auto';
            this.sounds[name] = audio;
        });
    },

    play(name, loop = false, volume = 0.5) {
        const s = this.sounds[name];
        if (!s) return;
        s.loop = loop;
        s.volume = volume;
        s.currentTime = 0;
        s.play().catch(() => {});
    },

    stop(name) {
        const s = this.sounds[name];
        if (!s) return;
        s.pause();
        s.currentTime = 0;
    },

    fadeOut(name, duration = 1000) {
        const s = this.sounds[name];
        if (!s || s.paused) return;
        const startVol = s.volume;
        const steps = 20;
        const interval = duration / steps;
        const decrement = startVol / steps;
        let step = 0;
        const timer = setInterval(() => {
            step++;
            s.volume = Math.max(0, startVol - decrement * step);
            if (step >= steps) {
                clearInterval(timer);
                s.pause();
                s.currentTime = 0;
                s.volume = startVol;
            }
        }, interval);
    },

    stopAll() {
        Object.keys(this.sounds).forEach(name => this.stop(name));
        this.currentMusic = null;
    },

    playMusic(name, volume = 0.35) {
        if (this.currentMusic && this.currentMusic !== name) {
            this.fadeOut(this.currentMusic, 800);
        }
        this.currentMusic = name;
        const s = this.sounds[name];
        if (!s) return;
        s.loop = true;
        s.volume = volume;
        if (s.paused) {
            s.currentTime = 0;
            s.play().catch(() => {});
        }
    },

    stopMusic(fade = true) {
        if (!this.currentMusic) return;
        if (fade) {
            this.fadeOut(this.currentMusic, 800);
        } else {
            this.stop(this.currentMusic);
        }
        this.currentMusic = null;
    }
};

SoundManager.init();
window.SoundManager = SoundManager;