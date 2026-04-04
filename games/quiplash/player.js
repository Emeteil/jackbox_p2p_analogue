window.initPlayerGame = (connMgr, me) => {
    const container = document.getElementById('player-container');
    let promptIndex = 0;
    let totalPrompts = 2;

    const observer = new MutationObserver(() => {
        bindWriteForm();
        bindWriteFinalForm();
        bindVoteButtons();
    });

    observer.observe(container, { childList: true, subtree: true });

    function bindWriteForm() {
        const btn = container.querySelector('#ql-submit-btn');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = "true";

        const input = container.querySelector('#ql-answer-input');
        const charCount = container.querySelector('#ql-char-current');

        if (input && charCount) {
            input.addEventListener('input', () => {
                charCount.textContent = input.value.length;
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') btn.click();
            });
        }

        btn.onclick = () => {
            const answer = input ? input.value.trim() : '';
            connMgr.sendToHost('QUIPLASH_ANSWER', {
                answer: answer,
                promptIndex: promptIndex
            });
            promptIndex++;
            btn.disabled = true;
            btn.textContent = 'ОТПРАВЛЕНО ✓';
        };
    }

    function bindWriteFinalForm() {
        const btn = container.querySelector('#ql-submit-final-btn');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = "true";

        btn.onclick = () => {
            const a1 = (container.querySelector('#ql-answer-1')?.value || '').trim();
            const a2 = (container.querySelector('#ql-answer-2')?.value || '').trim();
            const a3 = (container.querySelector('#ql-answer-3')?.value || '').trim();
            connMgr.sendToHost('QUIPLASH_FINAL_ANSWER', {
                answers: [a1, a2, a3]
            });
            btn.disabled = true;
            btn.textContent = 'ОТПРАВЛЕНО ✓';
        };
    }

    function bindVoteButtons() {
        const cards = container.querySelectorAll('.ql-vote-card');
        if (cards.length === 0 || cards[0].dataset.bound) return;

        cards.forEach(card => {
            card.dataset.bound = "true";
            card.onclick = () => {
                const vote = parseInt(card.getAttribute('data-vote'));
                cards.forEach(c => {
                    c.disabled = true;
                    c.classList.remove('selected');
                });
                card.classList.add('selected');
                connMgr.sendToHost('QUIPLASH_VOTE', { vote });
                setTimeout(() => {
                    container.innerHTML = `
                        <div class="ql-player-wait">
                            <div class="ql-vote-confirmed">Голос принят ✅</div>
                        </div>
                    `;
                }, 300);
            };
        });
    }

    connMgr.on('QUIPLASH_RESET_PROMPT_INDEX', () => {
        promptIndex = 0;
    });

    connMgr.on('QUIPLASH_SET_TOTAL_PROMPTS', (data) => {
        totalPrompts = data.total || 2;
    });
};