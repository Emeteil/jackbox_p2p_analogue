const Utils = {
    getQueryParams: function () {
        const params = new URLSearchParams(window.location.search);
        return Object.fromEntries(params.entries());
    },
    getHashParams: function () {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        return Object.fromEntries(params.entries());
    },
    generateJoinUrl: function (hostId) {
        const path = window.location.pathname;
        const rootPath = path.substring(0, path.indexOf('/games/'));
        const baseUrl = window.location.origin + rootPath + '/player.html';
        const cleanBaseUrl = baseUrl.replace('//player.html', '/player.html');
        return `${cleanBaseUrl}#host=${hostId}`;
    },
    loadScript: function (src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },
    loadCSS: function (href) {
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    },
    loadHTML: async function (url, containerId) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to load ${url}`);
            const html = await response.text();
            document.getElementById(containerId).innerHTML = html;
        } catch (e) {
            console.error('HTML Load Error:', e);
        }
    },
    sanitizeHTML: function (str) {
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }
};
window.Utils = Utils;