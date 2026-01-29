/**
 * Main application entry point - Ionic Integration
 */

// Global reference for UI buttons
let humanPlayer = null;

(async function() {
    // Wait for Ionic to be ready
    await customElements.whenDefined('ion-modal');
    await customElements.whenDefined('ion-menu');

    // Initialize components
    const canvas = document.getElementById('board');
    const board = new HexBoard(canvas);
    const socket = new GameSocket();
    const ui = new GameUI();
    const statsGraph = new StatsGraph('stats-chart');
    humanPlayer = new HumanPlayer(board, ui);

    ui.setHumanPlayer(humanPlayer);

    // Theme change handler - reload board colors
    ui.onThemeChange = () => {
        board.loadColorsFromCSS();
        board.render();
    };

    let gameRunning = false;
    let gameExists = false;
    let waitingForHuman = null;
    let humanPlayerId = 0;

    // History navigation state
    let viewTurn = 0;
    let maxTurn = 0;
    let viewingHistory = false;

    // Track current player for display
    let currentPlayerName = null;
    let currentPlayerId = null;
    let currentGameId = null;

    // Ionic modal references
    const setupModal = document.getElementById('setup-modal');
    const loadModal = document.getElementById('load-modal');
    const statsModal = document.getElementById('stats-modal');

    // URL helpers
    function updateGameUrl(gameId) {
        if (gameId) {
            currentGameId = gameId;
            history.replaceState({gameId}, '', `/game/${gameId}`);
        }
    }

    function getGameIdFromUrl() {
        const match = window.location.pathname.match(/^\/game\/(\d+)$/);
        return match ? parseInt(match[1]) : null;
    }

    // Reroll map button
    const btnRerollMap = document.getElementById('btn-reroll-map');

    // Update all controls based on current state
    function updateControls() {
        if (!gameExists) {
            ui.setPlayButtonState('disabled');
            ui.setTurnInfo(0, '-', null, false);
            ui.setHistoryPosition(0, 0, true, null, null, false);
            if (btnRerollMap) btnRerollMap.classList.remove('visible');
            return;
        }

        // Show reroll button only before first turn when not running
        if (btnRerollMap) btnRerollMap.classList.toggle('visible', maxTurn === 0 && !gameRunning);

        const isHumanTurn = waitingForHuman !== null && !viewingHistory;

        // Action button state
        if (isHumanTurn) {
            ui.setPlayButtonState('end_turn');
        } else if (gameRunning) {
            ui.setPlayButtonState('pause');
        } else {
            ui.setPlayButtonState('play');
        }

        // Update turn bar info
        ui.setTurnInfo(viewTurn, currentPlayerName, currentPlayerId, isHumanTurn);

        // History nav
        const isAtEnd = viewTurn >= maxTurn;
        ui.setHistoryPosition(viewTurn, maxTurn, isAtEnd, currentPlayerName, currentPlayerId, true);
    }

    // Navigate to a specific snapshot (view only)
    async function goToSnapshot(snapshotId) {
        if (snapshotId < 1 || snapshotId > maxTurn) return;

        if (gameRunning && snapshotId < maxTurn) {
            await pauseGame();
        }

        try {
            const response = await fetch(`/api/snapshot/${snapshotId}`);
            const data = await response.json();
            if (data.status === 'ok' && data.state) {
                viewTurn = snapshotId;
                if (data.max_snapshot) {
                    maxTurn = data.max_snapshot;
                }
                viewingHistory = viewTurn < maxTurn;
                board.setState(data.state);
                ui.updateState(data.state);

                if (data.state.players && data.state.current_player !== undefined) {
                    currentPlayerId = data.state.current_player;
                    currentPlayerName = data.state.players[currentPlayerId]?.color_name || null;
                }

                updateControls();

                if (viewingHistory) {
                    humanPlayer.disable();
                    board.clearAffordableHighlight();
                }
            }
        } catch (e) {
            console.error('Failed to load snapshot:', e);
        }
    }

    // Prevent double-clicks
    let executingTurn = false;

    async function executeNextTurn() {
        if (executingTurn) return;
        executingTurn = true;
        ui.setHistoryLoading(true);

        try {
            const response = await fetch('/api/next-turn', { method: 'POST' });
            const data = await response.json();
            if (data.status === 'game_over') {
                ui.addSystemLog(`Game over! Winner: Player ${data.winner}`);
            }
        } catch (e) {
            console.error('Failed to run next turn:', e);
        } finally {
            executingTurn = false;
            ui.setHistoryLoading(false);
            updateControls();
        }
    }

    async function startGame() {
        try {
            const response = await fetch('/api/start', { method: 'POST' });
            const data = await response.json();
            if (data.status === 'ok') {
                gameRunning = true;
                viewingHistory = false;
                updateControls();
            }
        } catch (e) {
            console.error('Failed to start game:', e);
        }
    }

    async function pauseGame() {
        try {
            const response = await fetch('/api/pause', { method: 'POST' });
            const data = await response.json();
            if (data.status === 'ok') {
                gameRunning = false;
                updateControls();
            }
        } catch (e) {
            console.error('Failed to pause game:', e);
        }
    }

    // Socket event handlers
    socket.on('connected', () => {
        ui.setConnectionStatus(true);
    });

    socket.on('disconnected', () => {
        ui.setConnectionStatus(false);
    });

    socket.on('state', (data) => {
        console.log('State received, waiting_for_human:', data.waiting_for_human, 'max_snapshot:', data.max_snapshot);
        gameExists = true;

        if (data.game_running !== undefined) {
            gameRunning = data.game_running;
        }

        if (data.max_snapshot !== undefined && data.max_snapshot > 0) {
            maxTurn = data.max_snapshot;
        }

        if (!viewingHistory) {
            viewTurn = maxTurn;
            if (data.snapshot_player_id !== undefined) {
                currentPlayerId = data.snapshot_player_id;
                currentPlayerName = data.snapshot_player_name || null;
            } else if (data.state?.players && data.state?.current_player !== undefined) {
                currentPlayerId = data.state.current_player;
                currentPlayerName = data.state.players[currentPlayerId]?.color_name || null;
            }
        }

        board.setState(data.state);
        ui.updateState(data.state);

        if (data.state?.turn && data.state?.players) {
            const statsPlayers = data.state.players.map(p => ({
                id: p.id,
                territory: p.total_territory,
                gold: p.total_gold,
                units: p.total_units,
                trees: p.total_trees
            }));
            statsGraph.addTurn(data.state.turn, statsPlayers);
        }

        waitingForHuman = data.waiting_for_human;
        if (waitingForHuman !== null && waitingForHuman !== undefined && !viewingHistory) {
            humanPlayer.enable(waitingForHuman);
            board.setAffordableCapitals(waitingForHuman);
        } else {
            humanPlayer.disable();
            humanPlayer.enableSpectator();
            board.clearAffordableHighlight();
        }

        updateControls();
    });

    socket.on('new_game', (data) => {
        gameExists = true;
        gameRunning = false;
        waitingForHuman = null;
        viewTurn = 0;
        maxTurn = 0;
        viewingHistory = false;

        if (data.state?.players && data.state?.current_player !== undefined) {
            currentPlayerId = data.state.current_player;
            currentPlayerName = data.state.players[currentPlayerId]?.color_name || null;
        }

        board.setState(data.state);
        board.clearAffordableHighlight();
        ui.updateState(data.state);
        ui.clearLog();
        ui.addSystemLog('New game created. Press Play to step through or fast-forward to auto-run.');
        statsGraph.destroy();
        statsGraph.fetchAndUpdate();
        humanPlayer.disable();
        humanPlayer.enableSpectator();
        updateControls();
    });

    socket.on('turn_start', (data) => {
        const typeInfo = data.player_type === 'human' ? ' (YOUR TURN)' : ` (${data.player_type})`;
        ui.addSystemLog(`--- Turn ${data.turn}: ${data.player_name}'s turn${typeInfo} ---`);
    });

    socket.on('territory_deaths', (data) => {
        if (data.deaths?.length) {
            const byPlayer = {};
            for (const d of data.deaths) {
                if (!byPlayer[d.player]) byPlayer[d.player] = [];
                byPlayer[d.player].push(d.unit);
            }
            for (const [playerId, units] of Object.entries(byPlayer)) {
                const msg = `Territory loss: ${units.join(', ')} died (isolated)`;
                ui.addLog('action', parseInt(playerId), msg);
            }
        }
    });

    socket.on('action', (data) => {
        if (data.action && data.action.type) {
            const action = data.action;
            let msg = `${action.type}: `;
            if (action.type === 'move') {
                msg += `(${action.from?.[0]},${action.from?.[1]}) → (${action.to?.[0]},${action.to?.[1]})`;
                if (action.killed) msg += ` killed ${action.killed}`;
            } else if (action.type === 'buy') {
                msg += `${action.unit_type} at (${action.position?.[0]},${action.position?.[1]})`;
            } else if (action.type === 'end_turn') {
                msg += 'ended turn';
            }
            if (action.success === false) msg += ` FAILED: ${action.message}`;
            ui.addLog('action', data.player, msg);
        }
    });

    socket.on('agent_thinking', (data) => {
        ui.addLog('thinking', data.player, data.content);
    });

    socket.on('agent_tool_call', (data) => {
        ui.addLog('tool_call', data.player, data.content);
    });

    socket.on('agent_tool_result', (data) => {
        ui.addLog('tool_result', data.player, data.content);
        if (data.data) {
            if (data.data.from) {
                board.highlightHex(data.data.from[0], data.data.from[1], '#ff0');
            }
            if (data.data.to) {
                board.highlightHex(data.data.to[0], data.data.to[1], '#0f0');
            }
            if (data.data.position) {
                board.highlightHex(data.data.position[0], data.data.position[1], '#0ff');
            }
        }
    });

    socket.on('agent_action', (data) => {
        ui.addLog('action', data.player, data.content);
    });

    socket.on('agent_summary', (data) => {
        ui.addLog('summary', data.player, data.content);
    });

    socket.on('game_over', (data) => {
        gameRunning = false;
        ui.showGameOver(data.winner, data.winner_name);
        updateControls();
    });

    socket.on('error', (data) => {
        ui.addSystemLog(`Error: ${data.message}`);
    });

    // Setup modal elements
    const btnStartGame = document.getElementById('btn-start-game');
    const btnCancelSetup = document.getElementById('btn-cancel-setup');
    const playerSlots = document.querySelectorAll('.player-slot');

    // Player type change handler for Ionic selects
    playerSlots.forEach(slot => {
        const typeSelect = slot.querySelector('.player-type');
        const diffSelect = slot.querySelector('.ai-difficulty');

        if (typeSelect && diffSelect) {
            typeSelect.addEventListener('ionChange', (e) => {
                diffSelect.style.display = e.detail.value === 'human' ? 'none' : 'block';
            });
            // Initial state
            diffSelect.style.display = typeSelect.value === 'human' ? 'none' : 'block';
        }
    });

    // Load modal elements
    const gamesList = document.getElementById('games-list');
    const btnCancelLoad = document.getElementById('btn-cancel-load');

    // Render mini board preview
    function renderMiniBoard(canvas, boardData) {
        if (!boardData || !boardData.hexes) return;
        const ctx = canvas.getContext('2d');
        const hexes = boardData.hexes;

        let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
        for (const key in hexes) {
            const [q, r] = key.split(',').map(Number);
            minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
            minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        }

        const hexSize = Math.min(canvas.width / (maxQ - minQ + 3), canvas.height / (maxR - minR + 3)) * 0.5;
        const offsetX = canvas.width / 2 - (maxQ + minQ) / 2 * hexSize * 1.5;
        const offsetY = canvas.height / 2 - (maxR + minR) / 2 * hexSize * 1.7;

        const colors = { 0: '#F0A8A8', 1: '#A8C8F0', 2: '#B8E0B0', 3: '#F0E8A8', 4: '#D8B8E8', 5: '#F0C8A8' };

        for (const key in hexes) {
            const hex = hexes[key];
            const [q, r] = key.split(',').map(Number);
            const x = offsetX + hexSize * 1.5 * q;
            const y = offsetY + hexSize * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);

            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI / 3 * i - Math.PI / 6;
                const hx = x + hexSize * 0.9 * Math.cos(angle);
                const hy = y + hexSize * 0.9 * Math.sin(angle);
                if (i === 0) ctx.moveTo(hx, hy);
                else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.fillStyle = hex.owner !== null ? colors[hex.owner] : (hex.terrain === 'sea' ? '#A8C8E8' : '#B8D4A0');
            ctx.fill();
        }
    }

    // Load game by ID
    async function loadGame(gameId) {
        try {
            const response = await fetch(`/api/game/${gameId}`);
            const data = await response.json();
            if (data.status === 'ok') {
                ui.addSystemLog(`Loaded game at turn ${data.turn}`);
                gameExists = true;
                gameRunning = false;
                viewTurn = data.turn || 1;
                maxTurn = data.turn || 1;
                viewingHistory = false;
                await loadModal.dismiss();
                updateGameUrl(data.game_id || gameId);
                statsGraph.fetchAndUpdate();
                updateControls();
            }
        } catch (e) {
            console.error('Failed to load game:', e);
        }
    }

    // Show load modal with games list
    async function showLoadModal() {
        try {
            const response = await fetch('/api/games');
            const data = await response.json();

            if (data.status === 'ok' && data.games.length > 0) {
                gamesList.innerHTML = data.games.map(game => `
                    <ion-item button class="game-item" data-id="${game.id}">
                        <canvas class="game-preview" width="80" height="60" slot="start" data-board='${JSON.stringify(game.board)}'></canvas>
                        <ion-label class="game-info">
                            <h2 class="turn">Turn ${game.turn}</h2>
                            <p class="date">${new Date(game.updated_at).toLocaleString()}</p>
                            <p class="players">${game.player_count} players</p>
                        </ion-label>
                    </ion-item>
                `).join('');

                // Render previews
                gamesList.querySelectorAll('.game-preview').forEach(canvas => {
                    try {
                        const boardData = JSON.parse(canvas.dataset.board);
                        renderMiniBoard(canvas, boardData);
                    } catch (e) {}
                });

                // Click handlers
                gamesList.querySelectorAll('.game-item').forEach(item => {
                    item.addEventListener('click', () => loadGame(parseInt(item.dataset.id)));
                });
            } else {
                gamesList.innerHTML = '<ion-item><ion-label class="ion-text-center">No saved games</ion-label></ion-item>';
            }

            await loadModal.present();
        } catch (e) {
            console.error('Failed to fetch games:', e);
        }
    }

    // Map preview state
    let currentPreviewSeed = null;
    const setupMapPreview = document.getElementById('setup-map-preview');
    const btnChangeMap = document.getElementById('btn-change-map');

    async function updateMapPreview() {
        const sizeSelect = document.getElementById('map-size');
        const seedInput = document.getElementById('map-seed');
        const size = parseInt(sizeSelect?.value || '20');
        const seedValue = seedInput?.value || '';
        const seed = seedValue ? parseInt(seedValue) : null;
        const numPlayers = document.querySelectorAll('.player-slot').length;

        try {
            const url = `/api/map-preview?width=${size}&height=${size}&num_players=${numPlayers}` +
                        (seed !== null ? `&seed=${seed}` : '');
            const response = await fetch(url);
            const data = await response.json();
            if (data.status === 'ok' && setupMapPreview) {
                currentPreviewSeed = data.seed;
                renderMiniBoard(setupMapPreview, data.board);
            }
        } catch (e) {
            console.error('Failed to fetch map preview:', e);
        }
    }

    // Change Map button
    btnChangeMap?.addEventListener('click', () => {
        const seedInput = document.getElementById('map-seed');
        if (seedInput) seedInput.value = '';
        updateMapPreview();
    });

    // Update preview when size changes
    document.getElementById('map-size')?.addEventListener('ionChange', updateMapPreview);

    // Quick AI Battle (from menu)
    document.getElementById('menu-quick-ai')?.addEventListener('click', async () => {
        const menu = document.querySelector('ion-menu');
        await menu?.close();

        const config = {
            players: [
                { controller_type: 'classic_ai', ai_difficulty: 'normal' },
                { controller_type: 'classic_ai', ai_difficulty: 'normal' },
                { controller_type: 'classic_ai', ai_difficulty: 'normal' },
                { controller_type: 'classic_ai', ai_difficulty: 'normal' },
            ],
            map: { width: 15, height: 15, seed: null },
            enable_history: true
        };

        try {
            const response = await fetch('/api/new-game-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const data = await response.json();
            if (data.status === 'ok') {
                gameExists = true;
                gameRunning = false;
                viewTurn = 0;
                maxTurn = 0;
                viewingHistory = false;
                updateGameUrl(data.game_id);
                ui.addSystemLog('Quick AI Battle started! Press Play to auto-run.');
                updateControls();
            }
        } catch (e) {
            console.error('Failed to create quick AI game:', e);
        }
    });

    // Custom Game button (opens modal) - from menu
    document.getElementById('menu-new-custom')?.addEventListener('click', async () => {
        const menu = document.querySelector('ion-menu');
        await menu?.close();
        await setupModal.present();
        updateMapPreview();
    });

    // Load button - from menu
    document.getElementById('menu-load')?.addEventListener('click', async () => {
        const menu = document.querySelector('ion-menu');
        await menu?.close();
        await showLoadModal();
    });

    // Reroll map button
    btnRerollMap?.addEventListener('click', async () => {
        btnRerollMap.disabled = true;
        try {
            const response = await fetch('/api/reroll-map', { method: 'POST' });
            const data = await response.json();
            if (data.status === 'ok') {
                ui.addSystemLog(`Map regenerated (seed: ${data.seed})`);
            } else {
                ui.addSystemLog(`Error: ${data.message}`);
            }
        } catch (e) {
            console.error('Failed to reroll map:', e);
        }
        btnRerollMap.disabled = false;
    });

    btnCancelLoad?.addEventListener('click', async () => {
        await loadModal.dismiss();
    });

    btnCancelSetup?.addEventListener('click', async () => {
        await setupModal.dismiss();
        currentPreviewSeed = null;
    });

    btnStartGame?.addEventListener('click', async () => {
        const players = [];
        playerSlots.forEach(slot => {
            const typeSelect = slot.querySelector('.player-type');
            const diffSelect = slot.querySelector('.ai-difficulty');
            const type = typeSelect?.value || 'classic_ai';
            const difficulty = diffSelect?.value || 'normal';
            players.push({
                controller_type: type,
                ai_difficulty: difficulty
            });
        });

        const sizeSelect = document.getElementById('map-size');
        const seedInput = document.getElementById('map-seed');
        const size = parseInt(sizeSelect?.value || '20');
        const seedValue = seedInput?.value || '';
        const seed = seedValue ? parseInt(seedValue) : currentPreviewSeed;

        const config = {
            players,
            map: { width: size, height: size, seed },
            enable_history: true
        };

        try {
            const response = await fetch('/api/new-game-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const data = await response.json();
            if (data.status === 'ok') {
                gameExists = true;
                gameRunning = false;
                viewTurn = 0;
                maxTurn = 0;
                viewingHistory = false;
                await setupModal.dismiss();
                currentPreviewSeed = null;
                updateGameUrl(data.game_id);

                const humanPlayers = players
                    .map((p, i) => p.controller_type === 'human' ? i : -1)
                    .filter(i => i >= 0);

                if (humanPlayers.length > 0) {
                    ui.addSystemLog(`Game created! You control: ${humanPlayers.map(i => ui.colorNames[i]).join(', ')}. Press Play to start.`);
                } else {
                    ui.addSystemLog('AI vs AI game. Press Play to step or fast-forward to auto-run.');
                }
                updateControls();
            }
        } catch (e) {
            console.error('Failed to create game:', e);
            ui.addSystemLog('Error creating game: ' + e.message);
        }
    });

    // End Turn button (human player)
    ui.btnEndTurn?.addEventListener('click', () => {
        if (waitingForHuman !== null && !viewingHistory) {
            humanPlayer.endTurn();
        }
    });

    // Run Game button
    ui.btnRunGame?.addEventListener('click', async () => {
        await startGame();
    });

    // Pause button
    ui.btnPauseGame?.addEventListener('click', async () => {
        await pauseGame();
    });

    // Double-click confirmation state
    let stepConfirmPending = false;
    let lastConfirmPending = false;
    let confirmTimeout = null;

    function resetConfirm() {
        stepConfirmPending = false;
        lastConfirmPending = false;
        ui.btnStep?.classList.remove('confirm-pending');
        ui.btnLast?.classList.remove('confirm-pending');
        if (confirmTimeout) clearTimeout(confirmTimeout);
    }

    // Playback navigation buttons
    ui.btnFirst?.addEventListener('click', () => {
        resetConfirm();
        goToSnapshot(1);
    });

    ui.btnPrev?.addEventListener('click', () => {
        resetConfirm();
        goToSnapshot(viewTurn - 1);
    });

    ui.btnStep?.addEventListener('click', async () => {
        if (viewTurn < maxTurn) {
            resetConfirm();
            await goToSnapshot(viewTurn + 1);
        } else {
            if (stepConfirmPending) {
                resetConfirm();
                await executeNextTurn();
            } else {
                resetConfirm();
                stepConfirmPending = true;
                ui.btnStep.classList.add('confirm-pending');
                confirmTimeout = setTimeout(resetConfirm, 2000);
            }
        }
    });

    ui.btnLast?.addEventListener('click', async () => {
        if (viewTurn < maxTurn) {
            resetConfirm();
            viewingHistory = false;
            await goToSnapshot(maxTurn);
        } else {
            if (lastConfirmPending) {
                resetConfirm();
                await startGame();
            } else {
                resetConfirm();
                lastConfirmPending = true;
                ui.btnLast.classList.add('confirm-pending');
                confirmTimeout = setTimeout(resetConfirm, 2000);
            }
        }
    });

    // Metric toggle - listen for custom events from Ionic segment
    document.addEventListener('metricChange', (e) => {
        statsGraph.setMetric(e.detail.metric);
    });

    // Trees toggle - listen for custom events
    document.addEventListener('treesToggle', (e) => {
        statsGraph.setShowTrees(e.detail.showTrees);
    });

    // Speed segment from menu
    document.getElementById('menu-speed')?.addEventListener('ionChange', async (e) => {
        const speed = e.detail.value;
        try {
            await fetch('/api/speed', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset: speed })
            });
        } catch (e) {
            console.error('Failed to set speed:', e);
        }
    });

    // Stats FAB opens modal
    document.getElementById('open-stats-modal')?.addEventListener('click', async () => {
        await statsModal.present();
    });

    // Connect WebSocket
    socket.connect();

    // Auto-load game on startup or show setup modal
    setTimeout(async () => {
        if (!gameExists) {
            const urlGameId = getGameIdFromUrl();
            let shouldShowSetup = true;

            try {
                if (urlGameId) {
                    await loadGame(urlGameId);
                    console.log('Loaded game from URL:', urlGameId);
                    shouldShowSetup = false;
                } else {
                    const response = await fetch('/api/game/latest');
                    const data = await response.json();
                    if (data.status === 'ok') {
                        updateGameUrl(data.game_id);
                        statsGraph.fetchAndUpdate();
                        console.log('Auto-loaded last game at turn', data.turn);
                        shouldShowSetup = false;
                    }
                }
            } catch (e) {
                // No game to load - will show setup modal
            }

            // If no game loaded, show setup modal to create a new one
            if (shouldShowSetup) {
                await setupModal.present();
                updateMapPreview();
            }
        }
    }, 500);

    // Ping to keep connection alive
    setInterval(() => {
        if (socket.isConnected()) {
            socket.send({ type: 'ping' });
        }
    }, 30000);
})();
