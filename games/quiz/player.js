window.initPlayerGame = (connMgr, me) => {
    const container = document.getElementById('player-container');

    const observer = new MutationObserver(() => {
        const btns = container.querySelectorAll('.quiz-btn');
        if (btns.length > 0 && !btns[0].dataset.bound) {
            btns.forEach(btn => {
                btn.dataset.bound = "true";
                btn.onclick = () => {
                    const ans = btn.getAttribute('data-answer');
                    btns.forEach(b => {
                        b.disabled = true;
                        b.style.opacity = '0.5';
                    });
                    btn.style.opacity = '1';
                    btn.style.borderColor = '#fbbf24';
                    connMgr.sendToHost('QUIZ_ANSWER', {
                        answer: ans
                    });
                };
            });
        }
    });

    observer.observe(container, {
        childList: true,
        subtree: true
    });
};