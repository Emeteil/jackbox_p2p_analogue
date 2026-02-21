class LocalizationManager {
    constructor(gameId = null) {
        this.gameId = gameId;
        this.lang = localStorage.getItem('app_lang') || navigator.language.split('-')[0] || 'en';
        this.commonData = {};
        this.gameData = {};
        this.isReady = false;
    }

    async init() {
        const path = window.location.pathname;
        let rootPath = '';
        if (path.includes('/games/')) {
            rootPath = path.substring(0, path.indexOf('/games/')) + '/';
        } else {
            rootPath = path.substring(0, path.lastIndexOf('/')) + '/';
        }

        rootPath = rootPath.replace(/\/+$/, '/');

        await this.loadLang(`${rootPath}lang/common/${this.lang}.json`, this.commonData);
        if (this.gameId) {
            await this.loadLang(`${rootPath}games/${this.gameId}/lang/${this.lang}.json`, this.gameData);
        }
        this.isReady = true;
    }

    async loadLang(url, target) {
        try {
            const resp = await fetch(url);
            if (resp.ok) {
                const data = await resp.json();
                Object.assign(target, data);
            } else {
                console.warn(`Localization file not found: ${url}`);
                if (this.lang !== 'en') {
                    const fallbackUrl = url.replace(`${this.lang}.json`, 'en.json');
                    const fallbackResp = await fetch(fallbackUrl);
                    if (fallbackResp.ok) {
                        const fallbackData = await fallbackResp.json();
                        Object.assign(target, fallbackData);
                    }
                }
            }
        } catch (e) {
            console.warn(`Localization load error for ${url}:`, e);
        }
    }

    t(key, params = {}) {
        let text = this.gameData[key] || this.commonData[key] || key;
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
        }
        return text;
    }

    setLanguage(newLang) {
        localStorage.setItem('app_lang', newLang);
        window.location.reload();
    }
}

window.LocalizationManager = LocalizationManager;
