window.initPlayerGame = (connMgr, me) => {
    const container = document.getElementById('player-container');

    const observer = new MutationObserver(() => {
        const btn = container.querySelector('#click-btn');
        if (btn && !btn.dataset.bound) {
            btn.dataset.bound = "true";
            btn.onclick = () => {
                connMgr.sendToHost('CLICK_ACTION', {});
                btn.style.transform = 'scale(0.95)';
                setTimeout(() => btn.style.transform = 'scale(1)', 100);
            };
        }
    });

    observer.observe(container, { childList: true, subtree: true });
};