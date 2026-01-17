/**
 * UI management for Slay game
 */

class GameUI {
    constructor() {
        // Player colors - Slay pastel palette (matching board.js)
        this.colors = {
            0: '#E08080',
            1: '#80A0E0',
            2: '#80C080',
            3: '#E0E080',
            4: '#C080C0',
            5: '#E0A060'
        };

        this.colorNames = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange'];

        // Elements
        this.logContent = document.getElementById('log-content');
        this.turnInfo = document.getElementById('turn-info');
        this.currentPlayer = document.getElementById('current-player');
        this.connectionStatus = document.getElementById('connection-status');
        this.rightPanel = document.getElementById('right-panel');
        this.panelToggle = document.getElementById('panel-toggle');

        // Buttons
        this.btnNew = document.getElementById('btn-new');
        this.btnPlayAction = document.getElementById('btn-play-action');
        this.playIcon = this.btnPlayAction?.querySelector('.play-icon');

        // Playback navigation
        this.btnFirst = document.getElementById('btn-first');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnStep = document.getElementById('btn-step');
        this.btnLast = document.getElementById('btn-last');
        this.turnNav = document.getElementById('turn-nav');

        // Human player controls
        this.turnIndicator = document.getElementById('turn-indicator');

        this.state = null;
        this.currentPlayerId = null;
        this.humanPlayer = null;

        // Mobile elements
        this.mobileMenu = document.getElementById('mobile-menu');
        this.btnMenuToggle = document.getElementById('btn-menu-toggle');
        this.btnPlayMobile = document.getElementById('btn-play-mobile');
        this.btnPanelToggleMobile = document.getElementById('btn-panel-toggle-mobile');
        this.turnNavMobile = document.querySelector('.turn-nav-mobile');

        // Initialize toggles
        this.initPanelToggle();
        this.initTabSwitching();
        this.initThemeToggle();
        this.initRegionPanelDrag();
        this.initMobileMenu();
    }

    initPanelToggle() {
        if (!this.panelToggle || !this.rightPanel) return;

        // Restore state from localStorage
        const collapsed = localStorage.getItem('rightPanelCollapsed') === 'true';
        if (collapsed) {
            this.rightPanel.classList.add('collapsed');
        }

        // Toggle handler
        this.panelToggle.addEventListener('click', () => {
            this.rightPanel.classList.toggle('collapsed');
            localStorage.setItem('rightPanelCollapsed', this.rightPanel.classList.contains('collapsed'));
        });
    }

    initTabSwitching() {
        const tabs = document.querySelectorAll('.panel-tab');
        const contents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;

                // Update tab buttons
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Update content
                contents.forEach(c => c.classList.remove('active'));
                const targetContent = document.getElementById(`tab-${tabId}`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }

                // Save active tab
                localStorage.setItem('activeTab', tabId);
            });
        });

        // Restore active tab
        const savedTab = localStorage.getItem('activeTab');
        if (savedTab) {
            const tab = document.querySelector(`.panel-tab[data-tab="${savedTab}"]`);
            if (tab) tab.click();
        }
    }

    initThemeToggle() {
        const btnTheme = document.getElementById('btn-theme');
        if (!btnTheme) return;

        // Restore theme from localStorage
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
            // Notify board after a tick (to let CSS apply)
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
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
            }

            localStorage.setItem('theme', newTheme);

            // Notify board to reload colors
            if (this.onThemeChange) {
                this.onThemeChange();
            }
        });
    }

    initRegionPanelDrag() {
        const panel = document.getElementById('region-panel');
        if (!panel) return;

        let isDragging = false;
        let startX, startY, startLeft, startTop;

        const onMouseDown = (e) => {
            if (!e.target.closest('.region-header')) return;
            if (e.target.closest('.close-btn')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = panel.offsetLeft;
            startTop = panel.offsetTop;
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = (startLeft + dx) + 'px';
            panel.style.top = (startTop + dy) + 'px';
        };

        const onMouseUp = () => {
            isDragging = false;
        };

        panel.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    initMobileMenu() {
        if (!this.mobileMenu || !this.btnMenuToggle) return;

        // Toggle menu
        this.btnMenuToggle.addEventListener('click', () => {
            this.mobileMenu.classList.toggle('active');
        });

        // Close menu on overlay click
        this.mobileMenu.addEventListener('click', (e) => {
            if (e.target === this.mobileMenu) {
                this.mobileMenu.classList.remove('active');
            }
        });

        // Mobile panel toggle (bottom sheet)
        if (this.btnPanelToggleMobile && this.rightPanel) {
            this.btnPanelToggleMobile.addEventListener('click', () => {
                this.rightPanel.classList.toggle('collapsed');
            });
        }

        // Sync mobile buttons with desktop buttons
        const syncButton = (mobileId, desktopId) => {
            const mobileBtn = document.getElementById(mobileId);
            const desktopBtn = document.getElementById(desktopId);
            if (mobileBtn && desktopBtn) {
                mobileBtn.addEventListener('click', () => {
                    desktopBtn.click();
                    this.mobileMenu.classList.remove('active');
                });
            }
        };

        // Game controls
        syncButton('btn-new-mobile', 'btn-new-custom');
        syncButton('btn-quick-ai-mobile', 'btn-quick-ai');
        syncButton('btn-load-mobile', 'btn-load');

        // Playback controls
        syncButton('btn-first-mobile', 'btn-first');
        syncButton('btn-prev-mobile', 'btn-prev');
        syncButton('btn-step-mobile', 'btn-step');
        syncButton('btn-last-mobile', 'btn-last');

        // Theme toggle
        const btnThemeMobile = document.getElementById('btn-theme-mobile');
        const btnTheme = document.getElementById('btn-theme');
        if (btnThemeMobile && btnTheme) {
            btnThemeMobile.addEventListener('click', () => {
                btnTheme.click();
                this.mobileMenu.classList.remove('active');
            });
        }

        // Mobile play button syncs with desktop
        if (this.btnPlayMobile && this.btnPlayAction) {
            this.btnPlayMobile.addEventListener('click', () => {
                this.btnPlayAction.click();
            });
        }

        // Sync speed buttons in mobile menu
        const mobileSpeedBtns = this.mobileMenu.querySelectorAll('.speed-btn');
        const desktopSpeedBtns = document.querySelectorAll('#controls .speed-btn');
        mobileSpeedBtns.forEach(mobileBtn => {
            mobileBtn.addEventListener('click', () => {
                const speed = mobileBtn.dataset.speed;
                // Find and click matching desktop button
                desktopSpeedBtns.forEach(desktopBtn => {
                    if (desktopBtn.dataset.speed === speed) {
                        desktopBtn.click();
                    }
                });
                // Update mobile active state
                mobileSpeedBtns.forEach(b => b.classList.remove('active'));
                mobileBtn.classList.add('active');
            });
        });
    }

    setHumanPlayer(humanPlayer) {
        this.humanPlayer = humanPlayer;
    }

    showHumanControls(show, humanPlayer) {
        // Show/hide turn indicator
        if (this.turnIndicator) {
            this.turnIndicator.style.display = show ? 'block' : 'none';
        }
        // Hide region panel when disabling
        if (!show) {
            this.hideRegionPanel();
        }
    }

    // Set Play button state: 'play', 'pause', or 'end_turn'
    setPlayButtonState(state) {
        const buttons = [this.btnPlayAction, this.btnPlayMobile].filter(Boolean);

        buttons.forEach(btn => {
            btn.classList.remove('end-turn', 'paused');
            btn.disabled = false;
            const icon = btn.querySelector('.play-icon');

            switch (state) {
                case 'play':
                    if (icon) icon.textContent = '▶';
                    break;
                case 'pause':
                    if (icon) icon.textContent = '⏸';
                    btn.classList.add('paused');
                    break;
                case 'end_turn':
                    if (icon) icon.textContent = '✓';
                    btn.classList.add('end-turn');
                    break;
                case 'disabled':
                    if (icon) icon.textContent = '▶';
                    btn.disabled = true;
                    break;
            }
        });
    }

    // Update playback controls display
    setHistoryPosition(current, max, isAtEnd, playerName = null, playerId = null, gameExists = true) {
        // Update turn nav text (desktop and mobile)
        let text = max > 0 ? `${current}/${max}` : '-/-';
        if (playerName && max > 0) {
            text = `${playerName} ${current}/${max}`;
        } else if (playerName) {
            text = playerName;
        }

        if (this.turnNav) this.turnNav.textContent = text;
        if (this.turnNavMobile) this.turnNavMobile.textContent = text;

        // Color the center buttons based on current player
        const buttons = [this.btnPlayAction, this.btnPlayMobile].filter(Boolean);
        buttons.forEach(btn => {
            if (playerId !== null && this.colors[playerId]) {
                btn.style.setProperty('--player-bg', this.colors[playerId]);
            }
        });

        // Enable/disable nav buttons (desktop)
        const hasHistory = max > 0;
        const canGoBack = current > 1;

        if (this.btnFirst) this.btnFirst.disabled = !gameExists || !hasHistory || !canGoBack;
        if (this.btnPrev) this.btnPrev.disabled = !gameExists || !hasHistory || !canGoBack;
        if (this.btnStep) {
            this.btnStep.disabled = !gameExists;
            this.btnStep.textContent = '▶';
            this.btnStep.title = isAtEnd ? 'Execute next turn' : 'Next turn in history';
        }
        if (this.btnLast) {
            this.btnLast.disabled = !gameExists;
            this.btnLast.title = 'Run to end of game';
        }

        // Sync mobile nav buttons
        const btnFirstMobile = document.getElementById('btn-first-mobile');
        const btnPrevMobile = document.getElementById('btn-prev-mobile');
        const btnStepMobile = document.getElementById('btn-step-mobile');
        const btnLastMobile = document.getElementById('btn-last-mobile');

        if (btnFirstMobile) btnFirstMobile.disabled = !gameExists || !hasHistory || !canGoBack;
        if (btnPrevMobile) btnPrevMobile.disabled = !gameExists || !hasHistory || !canGoBack;
        if (btnStepMobile) btnStepMobile.disabled = !gameExists;
        if (btnLastMobile) btnLastMobile.disabled = !gameExists;
    }

    // Set controls to loading state (during turn execution)
    setHistoryLoading(loading) {
        if (this.btnStep) {
            this.btnStep.disabled = loading;
            if (loading) {
                this.btnStep.textContent = '⏳';
            } else {
                this.btnStep.textContent = '▶';
            }
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

        // Unit info
        let unitHtml = '';
        if (hexData.unit) {
            const unitIcons = {
                peasant: '🧑‍🌾',
                spearman: '🗡️',
                knight: '⚔️',
                baron: '👑',
                castle: '🏰'
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

        // Terrain info
        const terrainIcons = {
            land: '🟩',
            sea: '🌊',
            tree: '🌲',
            grave: '💀'
        };
        const terrainIcon = terrainIcons[hexData.terrain] || '';

        // Capital indicator
        const capitalHtml = hexData.has_capital
            ? '<div class="hex-capital"><span>🏛️</span> <span>Capital</span></div>'
            : '';

        // Region stats (if territory)
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
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'placement-banner';
            document.getElementById('game-area').appendChild(banner);
        }
        banner.innerHTML = `Click a highlighted hex to place <strong>${unitType}</strong> <button onclick="humanPlayer.cancelPlacement()">Cancel</button>`;
        banner.style.display = 'block';
    }

    hidePlacementMode() {
        const banner = document.getElementById('placement-banner');
        if (banner) banner.style.display = 'none';
    }

    updateState(state) {
        this.state = state;
        this.updatePlayers();
        this.updateStatusBar();
    }

    updatePlayers() {
        // Player cards removed from UI
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
            this.updatePlayers();
        }
    }

    setConnectionStatus(connected) {
        this.connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
        this.connectionStatus.className = connected ? 'connected' : 'disconnected';
    }

    // Legacy method - now handled by setPlayButtonState and setHistoryPosition
    setGameControls(gameExists, gameRunning) {
        this.btnNew.disabled = false;
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

        // Limit log entries
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
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
