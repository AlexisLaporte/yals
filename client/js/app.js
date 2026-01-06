/**
 * Main application entry point
 */

// Global reference for UI buttons
let humanPlayer = null;

(function() {
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
    let humanPlayerId = 0; // Player 0 is human by default

    // History navigation state
    let viewTurn = 0;      // Currently viewed turn
    let maxTurn = 0;       // Latest turn in game
    let viewingHistory = false;  // Are we viewing a past turn?

    // Track current player for display
    let currentPlayerName = null;
    let currentPlayerId = null;
    let currentGameId = null;

    // Responsive panel management
    const rightPanel = document.getElementById('right-panel');

    function checkMobileLayout() {
        const isMobile = window.innerWidth < 768;

        // Auto-collapse panel on mobile at startup or resize to mobile
        if (isMobile && !rightPanel.classList.contains('collapsed')) {
            rightPanel.classList.add('collapsed');
        }
        // Auto-expand panel on desktop if it was collapsed
        else if (!isMobile && window.innerWidth >= 1024 && rightPanel.classList.contains('collapsed')) {
            rightPanel.classList.remove('collapsed');
        }
    }

    // Check layout on startup and resize
    checkMobileLayout();
    window.addEventListener('resize', checkMobileLayout);

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
            ui.setHistoryPosition(0, 0, true, null, null, false);
            btnRerollMap.classList.remove('visible');
            return;
        }

        // Show reroll button only before first turn when not running
        btnRerollMap.classList.toggle('visible', maxTurn === 0 && !gameRunning);

        // Play button state
        if (waitingForHuman !== null && !viewingHistory) {
            ui.setPlayButtonState('end_turn');
        } else if (gameRunning) {
            ui.setPlayButtonState('pause');
        } else {
            ui.setPlayButtonState('play');
        }

        // History nav with player name and color
        const isAtEnd = viewTurn >= maxTurn;
        ui.setHistoryPosition(viewTurn, maxTurn, isAtEnd, currentPlayerName, currentPlayerId, true);
    }

    // Navigate to a specific snapshot (view only)
    async function goToSnapshot(snapshotId) {
        if (snapshotId < 1 || snapshotId > maxTurn) return;

        // Auto-pause when rewinding while game is running
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

                // Extract current player info
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

    // Fetch current max snapshot from server
    async function fetchMaxSnapshot() {
        try {
            const response = await fetch('/api/available-turns');
            const data = await response.json();
            if (data.status === 'ok' && data.turns.length > 0) {
                maxTurn = Math.max(...data.turns);
            }
        } catch (e) {
            console.error('Failed to fetch max snapshot:', e);
        }
    }

    // Prevent double-clicks
    let executingTurn = false;

    // Execute next turn (when at end of history)
    async function executeNextTurn() {
        if (executingTurn) return;  // Prevent double-click
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

    // Start auto-play
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

    // Pause auto-play
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
        console.log('State received, waiting_for_human:', data.waiting_for_human, 'max_snapshot:', data.max_snapshot,
                    'snapshot_player:', data.snapshot_player_id, data.snapshot_player_name);
        gameExists = true;

        // Sync game_running from server
        if (data.game_running !== undefined) {
            gameRunning = data.game_running;
        }

        // Update max snapshot from server if provided
        if (data.max_snapshot !== undefined && data.max_snapshot > 0) {
            maxTurn = data.max_snapshot;
        }

        // If not viewing history, sync viewTurn to max and use snapshot's player info
        if (!viewingHistory) {
            viewTurn = maxTurn;
            // Use snapshot player info for history nav display (not live player)
            if (data.snapshot_player_id !== undefined) {
                currentPlayerId = data.snapshot_player_id;
                currentPlayerName = data.snapshot_player_name || null;
            } else if (data.state?.players && data.state?.current_player !== undefined) {
                // Fallback to live state if no snapshot info
                currentPlayerId = data.state.current_player;
                currentPlayerName = data.state.players[currentPlayerId]?.color_name || null;
            }
        }

        board.setState(data.state);
        ui.updateState(data.state);

        // Incremental graph update (convert player format)
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

        // Handle human player waiting state
        waitingForHuman = data.waiting_for_human;
        if (waitingForHuman !== null && waitingForHuman !== undefined && !viewingHistory) {
            console.log('Enabling human player for player', waitingForHuman);
            humanPlayer.enable(waitingForHuman);
            board.setAffordableCapitals(waitingForHuman);  // Highlight buyable territories
        } else {
            humanPlayer.disable();
            humanPlayer.enableSpectator();  // Allow viewing hex info even when not playing
            board.clearAffordableHighlight();
        }

        updateControls();
    });

    socket.on('new_game', (data) => {
        gameExists = true;
        gameRunning = false;
        waitingForHuman = null;
        viewTurn = 0;  // No snapshot yet - will be created on first turn
        maxTurn = 0;
        viewingHistory = false;

        // Extract current player info from new game state
        if (data.state?.players && data.state?.current_player !== undefined) {
            currentPlayerId = data.state.current_player;
            currentPlayerName = data.state.players[currentPlayerId]?.color_name || null;
        }

        board.setState(data.state);
        board.clearAffordableHighlight();
        ui.updateState(data.state);
        ui.clearLog();
        ui.addSystemLog('New game created. Press ▶ to step through or ▶▶ to auto-run.');
        statsGraph.destroy();
        statsGraph.fetchAndUpdate();
        humanPlayer.disable();
        humanPlayer.enableSpectator();  // Allow viewing hex info
        updateControls();
    });

    socket.on('turn_start', (data) => {
        const typeInfo = data.player_type === 'human' ? ' (YOUR TURN)' : ` (${data.player_type})`;
        ui.addSystemLog(`--- Turn ${data.turn}: ${data.player_name}'s turn${typeInfo} ---`);
    });

    socket.on('territory_deaths', (data) => {
        // Units that died from being isolated (no capital) at start of turn
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
        // Highlight affected hexes
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
    const setupModal = document.getElementById('setup-modal');
    const btnStartGame = document.getElementById('btn-start-game');
    const btnCancelSetup = document.getElementById('btn-cancel-setup');
    const playerSlots = document.querySelectorAll('.player-slot');

    // Show/hide difficulty based on player type
    playerSlots.forEach(slot => {
        const typeSelect = slot.querySelector('.player-type');
        const diffSelect = slot.querySelector('.ai-difficulty');

        typeSelect.addEventListener('change', () => {
            diffSelect.style.display = typeSelect.value === 'human' ? 'none' : 'block';
        });

        // Initial state
        diffSelect.style.display = typeSelect.value === 'human' ? 'none' : 'block';
    });

    // Load modal elements
    const loadModal = document.getElementById('load-modal');
    const gamesList = document.getElementById('games-list');
    const btnCancelLoad = document.getElementById('btn-cancel-load');

    // Render mini board preview
    function renderMiniBoard(canvas, boardData) {
        if (!boardData || !boardData.hexes) return;
        const ctx = canvas.getContext('2d');
        const hexes = boardData.hexes;

        // Find bounds
        let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
        for (const key in hexes) {
            const [q, r] = key.split(',').map(Number);
            minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q);
            minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        }

        const hexSize = Math.min(canvas.width / (maxQ - minQ + 3), canvas.height / (maxR - minR + 3)) * 0.5;
        const offsetX = canvas.width / 2 - (maxQ + minQ) / 2 * hexSize * 1.5;
        const offsetY = canvas.height / 2 - (maxR + minR) / 2 * hexSize * 1.7;

        const colors = { 0: '#E08080', 1: '#80A0E0', 2: '#80C080', 3: '#E0E080', 4: '#C080C0', 5: '#E0A060' };

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
            ctx.fillStyle = hex.owner !== null ? colors[hex.owner] : (hex.terrain === 'sea' ? '#6090C0' : '#90B060');
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
                loadModal.classList.remove('active');
                updateGameUrl(data.game_id || gameId);
                statsGraph.fetchAndUpdate();  // Load full history
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
                    <div class="game-item" data-id="${game.id}">
                        <canvas class="game-preview" width="80" height="60" data-board='${JSON.stringify(game.board)}'></canvas>
                        <div class="game-info">
                            <div class="turn">Turn ${game.turn}</div>
                            <div class="date">${new Date(game.updated_at).toLocaleString()}</div>
                            <div class="players">${game.player_count} players</div>
                        </div>
                    </div>
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
                gamesList.innerHTML = '<div class="empty">No saved games</div>';
            }

            loadModal.classList.add('active');
        } catch (e) {
            console.error('Failed to fetch games:', e);
        }
    }

    // Map preview state
    let currentPreviewSeed = null;
    const setupMapPreview = document.getElementById('setup-map-preview');
    const btnChangeMap = document.getElementById('btn-change-map');

    // Fetch and render map preview
    async function updateMapPreview() {
        const size = parseInt(document.getElementById('map-size').value);
        const seedInput = document.getElementById('map-seed').value;
        const seed = seedInput ? parseInt(seedInput) : null;
        const numPlayers = document.querySelectorAll('.player-slot').length;

        try {
            const url = `/api/map-preview?width=${size}&height=${size}&num_players=${numPlayers}` +
                        (seed !== null ? `&seed=${seed}` : '');
            const response = await fetch(url);
            const data = await response.json();
            if (data.status === 'ok') {
                currentPreviewSeed = data.seed;
                renderMiniBoard(setupMapPreview, data.board);
            }
        } catch (e) {
            console.error('Failed to fetch map preview:', e);
        }
    }

    // Change Map button
    btnChangeMap.addEventListener('click', () => {
        document.getElementById('map-seed').value = '';  // Clear seed to get new random
        updateMapPreview();
    });

    // Update preview when size changes
    document.getElementById('map-size').addEventListener('change', updateMapPreview);

    // Quick AI Battle
    document.getElementById('btn-quick-ai').addEventListener('click', async () => {
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
                ui.addSystemLog('Quick AI Battle started! Press ▶ to step or ▶▶ to auto-run.');
                updateControls();
            }
        } catch (e) {
            console.error('Failed to create quick AI game:', e);
        }
    });

    // Custom Game button (opens modal)
    document.getElementById('btn-new-custom').addEventListener('click', () => {
        setupModal.classList.add('active');
        updateMapPreview();  // Generate preview when modal opens
    });

    document.getElementById('btn-load').addEventListener('click', showLoadModal);

    // Reroll map button (regenerate map at turn 1)
    btnRerollMap.addEventListener('click', async () => {
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

    btnCancelLoad.addEventListener('click', () => {
        loadModal.classList.remove('active');
    });

    // Close load modal on background click
    loadModal.addEventListener('click', (e) => {
        if (e.target === loadModal) {
            loadModal.classList.remove('active');
        }
    });

    btnCancelSetup.addEventListener('click', () => {
        setupModal.classList.remove('active');
        currentPreviewSeed = null;
    });

    btnStartGame.addEventListener('click', async () => {
        // Build config from form
        const players = [];
        playerSlots.forEach(slot => {
            const type = slot.querySelector('.player-type').value;
            const difficulty = slot.querySelector('.ai-difficulty').value;
            players.push({
                controller_type: type,
                ai_difficulty: difficulty
            });
        });

        const size = parseInt(document.getElementById('map-size').value);
        const seedInput = document.getElementById('map-seed').value;
        // Use preview seed if available, otherwise use input or null
        const seed = seedInput ? parseInt(seedInput) : currentPreviewSeed;

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
                setupModal.classList.remove('active');
                currentPreviewSeed = null;
                updateGameUrl(data.game_id);

                // Find human players
                const humanPlayers = players
                    .map((p, i) => p.controller_type === 'human' ? i : -1)
                    .filter(i => i >= 0);

                if (humanPlayers.length > 0) {
                    ui.addSystemLog(`Game created! You control: ${humanPlayers.map(i => ui.colorNames[i]).join(', ')}. Press ▶ to start.`);
                } else {
                    ui.addSystemLog('AI vs AI game. Press ▶ to step or ▶▶ to auto-run.');
                }
                updateControls();
            }
        } catch (e) {
            console.error('Failed to create game:', e);
            ui.addSystemLog('Error creating game: ' + e.message);
        }
    });

    // Close modal on background click
    setupModal.addEventListener('click', (e) => {
        if (e.target === setupModal) {
            setupModal.classList.remove('active');
            currentPreviewSeed = null;
        }
    });

    // Play/Pause/End Turn contextual button
    ui.btnPlayAction.addEventListener('click', async () => {
        if (waitingForHuman !== null && !viewingHistory) {
            // End human turn
            humanPlayer.endTurn();
        } else if (gameRunning) {
            // Pause
            await pauseGame();
        } else {
            // Start auto-play
            await startGame();
        }
    });

    // Double-click confirmation state
    let stepConfirmPending = false;
    let lastConfirmPending = false;
    let confirmTimeout = null;

    function resetConfirm() {
        stepConfirmPending = false;
        lastConfirmPending = false;
        ui.btnStep.classList.remove('confirm-pending');
        ui.btnLast.classList.remove('confirm-pending');
        if (confirmTimeout) clearTimeout(confirmTimeout);
    }

    // Playback navigation buttons
    ui.btnFirst.addEventListener('click', () => {
        resetConfirm();
        goToSnapshot(1);
    });
    ui.btnPrev.addEventListener('click', () => {
        resetConfirm();
        goToSnapshot(viewTurn - 1);
    });
    ui.btnStep.addEventListener('click', async () => {
        if (viewTurn < maxTurn) {
            // Navigate forward in history
            resetConfirm();
            await goToSnapshot(viewTurn + 1);
        } else {
            // At end - double-click required to execute
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

    // Fast forward: run game to completion
    ui.btnLast.addEventListener('click', async () => {
        if (viewTurn < maxTurn) {
            // First go to current end (no confirmation needed)
            resetConfirm();
            viewingHistory = false;
            await goToSnapshot(maxTurn);
        } else {
            // At end - double-click required to start auto-play
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

    // Metric toggle buttons
    document.querySelectorAll('.metric-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.metric-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            statsGraph.setMetric(btn.dataset.metric);
        });
    });

    // Trees toggle
    const treesToggle = document.getElementById('toggle-trees');
    if (treesToggle) {
        treesToggle.addEventListener('change', () => {
            statsGraph.setShowTrees(treesToggle.checked);
        });
    }

    // Speed toggle buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const speed = btn.dataset.speed;
            try {
                const response = await fetch('/api/speed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preset: speed })
                });
                if (response.ok) {
                    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            } catch (e) {
                console.error('Failed to set speed:', e);
            }
        });
    });

    // Connect WebSocket
    socket.connect();

    // Auto-load game on startup (from URL or latest)
    setTimeout(async () => {
        if (!gameExists) {
            const urlGameId = getGameIdFromUrl();
            try {
                if (urlGameId) {
                    // Load specific game from URL
                    await loadGame(urlGameId);
                    console.log('Loaded game from URL:', urlGameId);
                } else {
                    // Load latest game
                    const response = await fetch('/api/game/latest');
                    const data = await response.json();
                    if (data.status === 'ok') {
                        updateGameUrl(data.game_id);
                        statsGraph.fetchAndUpdate();  // Load full history
                        console.log('Auto-loaded last game at turn', data.turn);
                    }
                }
            } catch (e) {
                // No game to load, that's fine
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
