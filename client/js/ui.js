/**
 * UI management for Slay game - Ionic Integration
 */

class GameUI {
    constructor() {
        // Player colors - Modern pastel palette (matching CSS variables)
        this.colors = {
            0: '#F0A8A8',  // Soft rose
            1: '#A8C8F0',  // Sky blue
            2: '#B8E0B0',  // Mint green
            3: '#F0E8A8',  // Pale yellow
            4: '#D8B8E8',  // Lavender
            5: '#F0C8A8'   // Peach
        };

        this.colorNames = ['Rose', 'Sky', 'Mint', 'Sunny', 'Lavender', 'Peach'];

        // Elements
        this.logContent = document.getElementById('log-content');
        this.turnInfo = document.getElementById('turn-info');
        this.currentPlayer = document.getElementById('current-player');
        this.connectionStatus = document.getElementById('connection-status');

        // New game controls
        this.gameControls = document.getElementById('game-controls');
        this.turnNumber = document.getElementById('turn-number');
        this.playerIndicator = document.getElementById('player-indicator');
        this.playerName = document.getElementById('player-name');
        this.playerDot = this.playerIndicator?.querySelector('.player-dot');

        // Action buttons
        this.btnEndTurn = document.getElementById('btn-end-turn');
        this.aiPlaying = document.getElementById('ai-playing');
        this.btnRunGame = document.getElementById('btn-run-game');
        this.btnPauseGame = document.getElementById('btn-pause-game');

        // History navigation
        this.btnFirst = document.getElementById('btn-first');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnStep = document.getElementById('btn-step');
        this.btnLast = document.getElementById('btn-last');
        this.historyPosition = document.getElementById('history-position');

        // Human player controls
        this.turnIndicator = document.getElementById('turn-indicator');

        // Ionic modals
        this.setupModal = document.getElementById('setup-modal');
        this.loadModal = document.getElementById('load-modal');
        this.statsModal = document.getElementById('stats-modal');

        this.state = null;
        this.currentPlayerId = null;
        this.humanPlayer = null;

        // Initialize after Ionic is ready
        this.initWhenReady();
    }

    async initWhenReady() {
        // Wait for Ionic components to be defined
        await customElements.whenDefined('ion-modal');
        await customElements.whenDefined('ion-menu');

        this.initMenuActions();
        this.initTabSwitching();
        this.initThemeToggle();
        this.initRegionPanelDrag();
        this.initStatsModalTabs();
    }

    initMenuActions() {
        const menu = document.querySelector('ion-menu');
        if (!menu) return;

        // Close menu helper
        const closeMenu = async () => {
            await menu.close();
        };

        // Game actions
        document.getElementById('menu-new-custom')?.addEventListener('click', async () => {
            await closeMenu();
            document.getElementById('btn-new-custom')?.click();
        });

        document.getElementById('menu-quick-ai')?.addEventListener('click', async () => {
            await closeMenu();
            document.getElementById('btn-quick-ai')?.click();
        });

        document.getElementById('menu-load')?.addEventListener('click', async () => {
            await closeMenu();
            document.getElementById('btn-load')?.click();
        });

        // Navigation actions - sync with footer buttons
        document.getElementById('menu-first')?.addEventListener('click', async () => {
            await closeMenu();
            this.btnFirst?.click();
        });

        document.getElementById('menu-prev')?.addEventListener('click', async () => {
            await closeMenu();
            this.btnPrev?.click();
        });

        document.getElementById('menu-step')?.addEventListener('click', async () => {
            await closeMenu();
            this.btnStep?.click();
        });

        document.getElementById('menu-last')?.addEventListener('click', async () => {
            await closeMenu();
            this.btnLast?.click();
        });

        // Speed control
        const menuSpeed = document.getElementById('menu-speed');
        if (menuSpeed) {
            menuSpeed.addEventListener('ionChange', (e) => {
                const speed = e.detail.value;
                // Sync with desktop speed buttons if they exist
                const desktopSpeedBtns = document.querySelectorAll('.speed-btn');
                desktopSpeedBtns.forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.speed === speed);
                    if (btn.dataset.speed === speed) {
                        btn.click();
                    }
                });
            });
        }

        // Theme toggle in menu
        document.getElementById('menu-theme')?.addEventListener('click', async () => {
            await closeMenu();
            document.getElementById('btn-theme')?.click();
        });
    }

    initTabSwitching() {
        const panelTabs = document.getElementById('panel-tabs');
        if (!panelTabs) return;

        panelTabs.addEventListener('ionChange', (e) => {
            const tabId = e.detail.value;
            this.switchTab(tabId);
            localStorage.setItem('activeTab', tabId);
        });

        // Restore active tab
        const savedTab = localStorage.getItem('activeTab');
        if (savedTab) {
            panelTabs.value = savedTab;
            this.switchTab(savedTab);
        }
    }

    switchTab(tabId) {
        const contents = document.querySelectorAll('.tab-content');
        contents.forEach(c => c.classList.remove('active'));

        const targetContent = document.getElementById(`tab-${tabId}`);
        if (targetContent) {
            targetContent.classList.add('active');
        }
    }

    initStatsModalTabs() {
        // Metric toggle in stats tab
        const metricSegment = document.getElementById('metric-segment');
        if (metricSegment) {
            metricSegment.addEventListener('ionChange', (e) => {
                const metric = e.detail.value;
                // Trigger the graph update - this will be handled by graph.js
                const event = new CustomEvent('metricChange', { detail: { metric } });
                document.dispatchEvent(event);
            });
        }

        // Trees toggle
        const treesToggle = document.getElementById('toggle-trees');
        if (treesToggle) {
            treesToggle.addEventListener('ionChange', (e) => {
                const showTrees = e.detail.checked;
                const event = new CustomEvent('treesToggle', { detail: { showTrees } });
                document.dispatchEvent(event);
            });
        }
    }

    initThemeToggle() {
        const btnTheme = document.getElementById('btn-theme');
        if (!btnTheme) return;

        // Restore theme from localStorage
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
            if (savedTheme === 'dark') {
                document.body.classList.add('dark');
            }
            setTimeout(() => {
                if (this.onThemeChange) this.onThemeChange();
            }, 0);
        }

        // Toggle handler
        btnTheme.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const newTheme = current === 'dark' ? 'light' : 'dark';

            if (newTheme === 'light') {
                document.documentElement.removeAttribute('data-theme');
                document.body.classList.remove('dark');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                document.body.classList.add('dark');
            }

            localStorage.setItem('theme', newTheme);

            // Update icon
            const icon = btnTheme.querySelector('ion-icon');
            if (icon) {
                icon.name = newTheme === 'dark' ? 'moon-outline' : 'sunny-outline';
            }

            // Notify board to reload colors
            if (this.onThemeChange) {
                this.onThemeChange();
            }
        });

        // Set initial icon
        const icon = btnTheme.querySelector('ion-icon');
        if (icon && savedTheme === 'dark') {
            icon.name = 'moon-outline';
        }
    }

    initRegionPanelDrag() {
        const panel = document.getElementById('region-panel');
        if (!panel) return;

        let isDragging = false;
        let startX, startY, startLeft, startTop;

        const getEventPosition = (e) => {
            if (e.touches && e.touches.length > 0) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        };

        const onDragStart = (e) => {
            if (!e.target.closest('.region-header')) return;
            if (e.target.closest('.close-btn')) return;

            isDragging = true;
            const pos = getEventPosition(e);
            startX = pos.x;
            startY = pos.y;
            startLeft = panel.offsetLeft;
            startTop = panel.offsetTop;

            if (e.cancelable) e.preventDefault();
        };

        const onDragMove = (e) => {
            if (!isDragging) return;
            const pos = getEventPosition(e);
            const dx = pos.x - startX;
            const dy = pos.y - startY;

            const maxLeft = window.innerWidth - panel.offsetWidth - 8;
            const maxTop = window.innerHeight - panel.offsetHeight - 8;
            const newLeft = Math.max(8, Math.min(maxLeft, startLeft + dx));
            const newTop = Math.max(8, Math.min(maxTop, startTop + dy));

            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        };

        const onDragEnd = () => {
            isDragging = false;
        };

        panel.addEventListener('mousedown', onDragStart);
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);

        panel.addEventListener('touchstart', onDragStart, { passive: false });
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
        document.addEventListener('touchcancel', onDragEnd);
    }

    setHumanPlayer(humanPlayer) {
        this.humanPlayer = humanPlayer;
    }

    showHumanControls(show, humanPlayer) {
        if (this.turnIndicator) {
            this.turnIndicator.style.display = show ? 'block' : 'none';
        }
        if (!show) {
            this.hideRegionPanel();
        }
    }

    // Set action area state: shows the appropriate button based on game state
    setPlayButtonState(state, isHumanTurn = false) {
        // Hide all action buttons first
        if (this.btnEndTurn) this.btnEndTurn.style.display = 'none';
        if (this.aiPlaying) this.aiPlaying.style.display = 'none';
        if (this.btnRunGame) this.btnRunGame.style.display = 'none';
        if (this.btnPauseGame) this.btnPauseGame.style.display = 'none';

        switch (state) {
            case 'end_turn':
                // Human player's turn - show "End Turn" button
                if (this.btnEndTurn) this.btnEndTurn.style.display = 'flex';
                break;
            case 'ai_playing':
                // AI is currently playing - show indicator
                if (this.aiPlaying) this.aiPlaying.style.display = 'flex';
                break;
            case 'pause':
                // Game is running (auto-play) - show pause button
                if (this.btnPauseGame) this.btnPauseGame.style.display = 'flex';
                break;
            case 'play':
            case 'disabled':
            default:
                // Game paused or no game - show run button
                if (this.btnRunGame) {
                    this.btnRunGame.style.display = 'flex';
                    this.btnRunGame.disabled = (state === 'disabled');
                }
                break;
        }
    }

    // Update turn bar display
    setTurnInfo(turn, playerName, playerId, isHumanTurn = false) {
        // Update turn number
        if (this.turnNumber) {
            this.turnNumber.textContent = turn > 0 ? turn : '-';
        }

        // Update player indicator
        if (this.playerName) {
            this.playerName.textContent = playerName || '-';
        }

        // Update player dot color
        if (this.playerDot && playerId !== null && this.colors[playerId]) {
            this.playerDot.style.background = this.colors[playerId];
        }

        // Mark if it's human's turn
        if (this.playerIndicator) {
            this.playerIndicator.classList.toggle('is-human', isHumanTurn);
        }
    }

    // Update history controls display
    setHistoryPosition(current, max, isAtEnd, playerName = null, playerId = null, gameExists = true) {
        // Update history position text
        if (this.historyPosition) {
            this.historyPosition.textContent = max > 0 ? `${current}/${max}` : '-/-';
        }

        // Enable/disable nav buttons
        const hasHistory = max > 0;
        const canGoBack = current > 1;

        if (this.btnFirst) this.btnFirst.disabled = !gameExists || !hasHistory || !canGoBack;
        if (this.btnPrev) this.btnPrev.disabled = !gameExists || !hasHistory || !canGoBack;
        if (this.btnStep) {
            this.btnStep.disabled = !gameExists;
        }
        if (this.btnLast) {
            this.btnLast.disabled = !gameExists;
        }

        // Toggle viewing-history class on game controls
        if (this.gameControls) {
            this.gameControls.classList.toggle('viewing-history', !isAtEnd && hasHistory);
        }

        // Update menu items state
        document.getElementById('menu-first')?.toggleAttribute('disabled', !gameExists || !hasHistory || !canGoBack);
        document.getElementById('menu-prev')?.toggleAttribute('disabled', !gameExists || !hasHistory || !canGoBack);
        document.getElementById('menu-step')?.toggleAttribute('disabled', !gameExists);
        document.getElementById('menu-last')?.toggleAttribute('disabled', !gameExists);
    }

    setHistoryLoading(loading) {
        const stepIcon = this.btnStep?.querySelector('ion-icon');
        if (stepIcon) {
            stepIcon.name = loading ? 'hourglass-outline' : 'play-forward';
        }
        if (this.btnFirst) this.btnFirst.disabled = loading;
        if (this.btnPrev) this.btnPrev.disabled = loading;
        if (this.btnLast) {
            this.btnLast.disabled = loading;
            this.btnLast.classList.toggle('running', loading);
        }
    }

    showRegionPanel(hex, regionInfo, humanPlayer) {
        const panel = document.getElementById('region-panel');
        if (!panel) return;

        const gold = regionInfo.gold || 0;
        const income = regionInfo.income || 0;
        const hasEmptyHex = regionInfo.hexes.some(h => !h.data.unit);

        panel.innerHTML = `
            <div class="region-header">
                <h3>Your Territory</h3>
                <div class="hex-coords">(${hex.q}, ${hex.r})</div>
                <button class="close-btn" onclick="document.getElementById('region-panel').style.display='none'">&times;</button>
            </div>
            <div class="region-stats">
                <div><span>Gold:</span> <strong>${gold}</strong></div>
                <div><span>Income:</span> +${income}/turn</div>
            </div>
            <div class="region-actions">
                <h4>Buy Unit</h4>
                <div class="buy-buttons">
                    <button class="buy-btn" data-unit="peasant" data-cost="10">
                        <span class="unit-icon">P</span>
                        <span class="unit-name">Peasant</span>
                        <span class="unit-cost">10g</span>
                    </button>
                    <button class="buy-btn" data-unit="spearman" data-cost="20">
                        <span class="unit-icon">S</span>
                        <span class="unit-name">Spearman</span>
                        <span class="unit-cost">20g</span>
                    </button>
                    <button class="buy-btn" data-unit="knight" data-cost="30">
                        <span class="unit-icon">K</span>
                        <span class="unit-name">Knight</span>
                        <span class="unit-cost">30g</span>
                    </button>
                    <button class="buy-btn" data-unit="baron" data-cost="40">
                        <span class="unit-icon">B</span>
                        <span class="unit-name">Baron</span>
                        <span class="unit-cost">40g</span>
                    </button>
                </div>
            </div>
        `;

        const buyButtons = panel.querySelectorAll('.buy-btn');
        buyButtons.forEach(btn => {
            const cost = parseInt(btn.dataset.cost);
            const disabled = !hasEmptyHex || gold < cost;
            btn.disabled = disabled;
            btn.onclick = () => {
                if (!disabled) {
                    humanPlayer.startPlacingUnit(btn.dataset.unit, regionInfo.hexes);
                }
            };
        });

        panel.style.display = 'block';
    }

    hideRegionPanel() {
        const panel = document.getElementById('region-panel');
        if (panel) panel.style.display = 'none';
    }

    showHexInfo(hex, hexData, regionInfo = null) {
        const panel = document.getElementById('region-panel');
        if (!panel) return;

        const ownerName = hexData.owner !== null
            ? this.colorNames[hexData.owner]
            : 'Neutral';
        const ownerColor = this.colors[hexData.owner] || '#888';

        let unitHtml = '';
        if (hexData.unit) {
            const unitIcons = {
                peasant: 'P',
                spearman: 'S',
                knight: 'K',
                baron: 'B',
                castle: 'C'
            };
            const icon = unitIcons[hexData.unit.type] || '?';
            const moved = hexData.unit.has_moved ? '<span class="hex-moved">(moved)</span>' : '';
            unitHtml = `
                <div class="hex-unit">
                    <span class="hex-unit-icon">${icon}</span>
                    <span class="hex-unit-type">${hexData.unit.type}</span>
                    ${moved}
                </div>
            `;
        }

        const terrainIcons = {
            land: 'L',
            sea: '~',
            tree: 'T',
            grave: 'X'
        };
        const terrainIcon = terrainIcons[hexData.terrain] || '';

        const capitalHtml = hexData.has_capital
            ? '<div class="hex-capital"><span>C</span> <span>Capital</span></div>'
            : '';

        let regionHtml = '';
        if (regionInfo && regionInfo.hexes.length > 0) {
            regionHtml = `
                <div class="hex-region">
                    <div><span>Region size:</span> <strong>${regionInfo.hexes.length}</strong> hexes</div>
                    <div><span>Gold:</span> <strong class="gold-value">${regionInfo.gold}</strong></div>
                    <div><span>Income:</span> <strong>+${regionInfo.income}</strong>/turn</div>
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="region-header" style="--header-color: ${ownerColor}">
                <h3>${ownerName}</h3>
                <button class="close-btn" onclick="document.getElementById('region-panel').style.display='none'">&times;</button>
            </div>
            <div class="hex-details">
                <div class="hex-terrain">
                    <span>${terrainIcon}</span>
                    <span>${hexData.terrain}</span>
                </div>
                <div class="hex-coords">(${hex.q}, ${hex.r})</div>
            </div>
            ${capitalHtml}
            ${unitHtml}
            ${regionHtml}
        `;

        panel.style.display = 'block';
    }

    showPlacementMode(unitType) {
        let banner = document.getElementById('placement-banner');
        if (banner) {
            banner.innerHTML = `Click a highlighted hex to place <strong>${unitType}</strong> <button onclick="humanPlayer.cancelPlacement()">Cancel</button>`;
            banner.style.display = 'block';
        }
    }

    hidePlacementMode() {
        const banner = document.getElementById('placement-banner');
        if (banner) banner.style.display = 'none';
    }

    updateState(state) {
        this.state = state;
        this.updateStatusBar();
    }

    updateStatusBar() {
        if (!this.state) {
            this.turnInfo.textContent = 'Turn: -';
            this.currentPlayer.textContent = 'Current: -';
            return;
        }

        this.turnInfo.textContent = `Turn: ${this.state.turn}`;

        if (this.state.players && this.state.current_player !== undefined) {
            const player = this.state.players[this.state.current_player];
            this.currentPlayer.textContent = `Current: ${player.color_name}`;
            this.currentPlayerId = player.id;
        }
    }

    setConnectionStatus(connected) {
        this.connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
        this.connectionStatus.className = connected ? 'connected' : 'disconnected';
    }

    setGameControls(gameExists, gameRunning) {
        // Legacy method - now handled by setPlayButtonState and setHistoryPosition
    }

    // Modal helpers using Ionic
    async showSetupModal() {
        if (this.setupModal) {
            await this.setupModal.present();
        }
    }

    async hideSetupModal() {
        if (this.setupModal) {
            await this.setupModal.dismiss();
        }
    }

    async showLoadModal() {
        if (this.loadModal) {
            await this.loadModal.present();
        }
    }

    async hideLoadModal() {
        if (this.loadModal) {
            await this.loadModal.dismiss();
        }
    }

    async showStatsModal() {
        if (this.statsModal) {
            await this.statsModal.present();
        }
    }

    // Toast notifications using Ionic
    async showToast(message, color = 'primary', duration = 2000) {
        const toast = document.createElement('ion-toast');
        toast.message = message;
        toast.duration = duration;
        toast.color = color;
        toast.position = 'bottom';
        document.body.appendChild(toast);
        await toast.present();
    }

    addLog(type, playerId, content) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.style.setProperty('--player-color', this.colors[playerId] || '#666');

        const playerName = this.colorNames[playerId] || `Player ${playerId}`;

        entry.innerHTML = `
            <div class="player-name">${playerName}</div>
            <div>${this.escapeHtml(content)}</div>
        `;

        this.logContent.appendChild(entry);
        this.logContent.scrollTop = this.logContent.scrollHeight;

        while (this.logContent.children.length > 100) {
            this.logContent.removeChild(this.logContent.firstChild);
        }
    }

    addSystemLog(content) {
        const entry = document.createElement('p');
        entry.className = 'log-info';
        entry.textContent = content;
        this.logContent.appendChild(entry);
        this.logContent.scrollTop = this.logContent.scrollHeight;
    }

    clearLog() {
        this.logContent.innerHTML = '';
    }

    showGameOver(winnerId, winnerName) {
        const entry = document.createElement('div');
        entry.className = 'log-entry summary';
        entry.style.setProperty('--player-color', this.colors[winnerId]);
        entry.innerHTML = `<strong>GAME OVER - ${winnerName} wins!</strong>`;
        this.logContent.appendChild(entry);

        // Show toast
        this.showToast(`Game Over! ${winnerName} wins!`, 'warning', 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
