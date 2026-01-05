/**
 * Human player interaction handler with state machine
 */

const PlayerState = {
    IDLE: 'idle',
    UNIT_SELECTED: 'unit_selected',
    PLACING_UNIT: 'placing_unit',
};

class HumanPlayer {
    constructor(board, ui) {
        this.board = board;
        this.ui = ui;
        this.playerId = null;
        this.enabled = false;
        this.spectatorMode = false;  // Can view hex info but not play

        // State machine
        this.state = PlayerState.IDLE;
        this.selectedUnit = null;      // {q, r} of selected unit
        this.placingUnitType = null;   // unit type being placed
        this.placingRegionHexes = [];  // valid hexes for placement
        this.currentRegion = null;     // currently viewed region (for keyboard shortcuts)

        this.validMoves = [];
        this.validPurchases = [];

        this.board.canvas.addEventListener('click', (e) => this.onCanvasClick(e));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.ui.hideRegionPanel();
                this.cancelPlacement();
                return;
            }
            // Unit buy shortcuts (P=peasant, S=spearman, K=knight, B=baron)
            if (!this.enabled) return;
            const unitKeys = { 'p': 'peasant', 's': 'spearman', 'k': 'knight', 'b': 'baron' };
            const unitType = unitKeys[e.key.toLowerCase()];
            if (unitType) {
                this.buyUnitByKey(unitType);
            }
        });
    }

    buyUnitByKey(unitType) {
        const costs = { peasant: 10, spearman: 20, knight: 30, baron: 40 };
        const cost = costs[unitType];

        // Use currently selected region if available
        if (this.currentRegion && this.currentRegion.gold >= cost) {
            const hasEmptyHex = this.currentRegion.hexes.some(h => !h.data.unit);
            if (hasEmptyHex) {
                this.startPlacingUnit(unitType, this.currentRegion.hexes);
                return;
            }
        }

        // Fallback: find any affordable region with empty hex
        const player = this.board.state?.players?.[this.playerId];
        if (!player?.region_gold) return;

        for (const [capitalKey, gold] of Object.entries(player.region_gold)) {
            if (gold < cost) continue;

            const [q, r] = capitalKey.split(',').map(Number);
            const regionInfo = this.findRegionForHex({ q, r });
            const hasEmptyHex = regionInfo.hexes.some(h => !h.data.unit);
            if (hasEmptyHex) {
                this.startPlacingUnit(unitType, regionInfo.hexes);
                return;
            }
        }
    }

    enable(playerId) {
        this.playerId = playerId;
        this.enabled = true;
        this.spectatorMode = false;  // Disable spectator when playing
        this.resetState();
        this.loadValidActions();
        this.ui.showHumanControls(true, this);
    }

    enableSpectator() {
        this.spectatorMode = true;
        this.enabled = false;
    }

    disable() {
        this.enabled = false;
        this.resetState();
        this.ui.showHumanControls(false);
        this.ui.hideRegionPanel();
        this.ui.hidePlacementMode();
        this.board.render();
    }

    resetState() {
        this.state = PlayerState.IDLE;
        this.selectedUnit = null;
        this.placingUnitType = null;
        this.placingRegionHexes = [];
        this.currentRegion = null;
    }

    async loadValidActions() {
        try {
            const [movesRes, purchasesRes] = await Promise.all([
                fetch('/api/valid-moves'),
                fetch('/api/valid-purchases')
            ]);
            const movesData = await movesRes.json();
            const purchasesData = await purchasesRes.json();
            this.validMoves = movesData.moves || [];
            this.validPurchases = purchasesData.purchases || [];
        } catch (e) {
            console.error('Failed to load valid actions:', e);
        }
    }

    async onCanvasClick(e) {
        // Allow clicks in enabled mode or spectator mode
        if (!this.enabled && !this.spectatorMode) return;

        // Ignore click if board was just dragged
        if (this.board.wasDragging) {
            this.board.wasDragging = false;
            return;
        }

        const rect = this.board.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hex = this.board.pixelToHex(x, y);

        if (!hex) return;

        const hexData = this.getHexData(hex.q, hex.r);
        if (!hexData) return;

        // Spectator mode: always show hex info (read-only)
        if (this.spectatorMode) {
            this.showHexInfo(hex, hexData);
            return;
        }

        switch (this.state) {
            case PlayerState.IDLE:
                await this.handleIdleClick(hex, hexData);
                break;
            case PlayerState.UNIT_SELECTED:
                await this.handleUnitSelectedClick(hex, hexData);
                break;
            case PlayerState.PLACING_UNIT:
                await this.handlePlacingUnitClick(hex, hexData);
                break;
        }
    }

    async handleIdleClick(hex, hexData) {
        // Click on own unit that can move → select it
        if (hexData.owner === this.playerId && hexData.unit && !hexData.unit.has_moved) {
            this.selectUnit(hex);
            return;
        }

        // Click on own territory → show region panel with buy options
        if (hexData.owner === this.playerId) {
            this.showRegionPanel(hex);
            return;
        }

        // Click on enemy/neutral territory → show hex info (read-only)
        this.showHexInfo(hex, hexData);
    }

    async handleUnitSelectedClick(hex, hexData) {
        const from = this.selectedUnit;

        // Click on same unit → deselect
        if (hex.q === from.q && hex.r === from.r) {
            this.deselectUnit();
            return;
        }

        // Click on another own unit → select it instead
        if (hexData.owner === this.playerId && hexData.unit && !hexData.unit.has_moved) {
            this.selectUnit(hex);
            return;
        }

        // Check if valid move
        const move = this.validMoves.find(m =>
            m.from_q === from.q && m.from_r === from.r &&
            m.to_q === hex.q && m.to_r === hex.r
        );

        if (move) {
            await this.executeMove(from, hex);
        } else {
            this.deselectUnit();
        }
    }

    async handlePlacingUnitClick(hex, hexData) {
        const isValidPlacement = this.placingRegionHexes.some(
            h => h.q === hex.q && h.r === hex.r
        );

        if (isValidPlacement) {
            await this.placeUnit(hex);
        } else {
            this.cancelPlacement();
        }
    }

    selectUnit(hex) {
        this.selectedUnit = hex;
        this.state = PlayerState.UNIT_SELECTED;
        this.currentRegion = null;
        this.ui.hideRegionPanel();
        this.renderHighlights();
    }

    deselectUnit() {
        this.selectedUnit = null;
        this.state = PlayerState.IDLE;
        this.board.render();
    }

    showRegionPanel(hex) {
        const regionInfo = this.findRegionForHex(hex);
        this.currentRegion = regionInfo;
        this.ui.showRegionPanel(hex, regionInfo, this);
    }

    showHexInfo(hex, hexData) {
        // Click on sea or empty space → close modal
        if (hexData.terrain === 'sea' || (hexData.owner === null && !hexData.unit)) {
            this.ui.hideRegionPanel();
            return;
        }

        // Find region info for any owned territory
        let regionInfo = null;
        if (hexData.owner !== null) {
            regionInfo = this.findRegionForAnyHex(hex, hexData.owner);
        }
        this.ui.showHexInfo(hex, hexData, regionInfo);
    }

    findRegionForAnyHex(startHex, ownerId) {
        const board = this.board.state.board;
        const player = this.board.state.players[ownerId];
        const visited = new Set();
        const regionHexes = [];

        // BFS to find connected hexes
        const queue = [startHex];
        visited.add(`${startHex.q},${startHex.r}`);

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${current.q},${current.r}`;
            const hexData = board.hexes[key];

            if (hexData && hexData.owner === ownerId) {
                regionHexes.push({q: current.q, r: current.r, data: hexData});

                const neighbors = this.getNeighbors(current.q, current.r);
                for (const n of neighbors) {
                    const nKey = `${n.q},${n.r}`;
                    if (!visited.has(nKey)) {
                        visited.add(nKey);
                        const nData = board.hexes[nKey];
                        if (nData && nData.owner === ownerId) {
                            queue.push(n);
                        }
                    }
                }
            }
        }

        // Find capital and gold
        let gold = 0;
        for (const h of regionHexes) {
            if (h.data.has_capital) {
                const capitalKey = `${h.q},${h.r}`;
                gold = player?.region_gold?.[capitalKey] || 0;
                break;
            }
        }

        return {
            hexes: regionHexes,
            gold: gold,
            income: regionHexes.length,
        };
    }

    findRegionForHex(startHex) {
        const board = this.board.state.board;
        const player = this.board.state.players[this.playerId];
        const visited = new Set();
        const regionHexes = [];

        // BFS to find connected hexes
        const queue = [startHex];
        visited.add(`${startHex.q},${startHex.r}`);

        while (queue.length > 0) {
            const current = queue.shift();
            const key = `${current.q},${current.r}`;
            const hexData = board.hexes[key];

            if (hexData && hexData.owner === this.playerId) {
                regionHexes.push({q: current.q, r: current.r, data: hexData});

                const neighbors = this.getNeighbors(current.q, current.r);
                for (const n of neighbors) {
                    const nKey = `${n.q},${n.r}`;
                    if (!visited.has(nKey)) {
                        visited.add(nKey);
                        const nData = board.hexes[nKey];
                        if (nData && nData.owner === this.playerId) {
                            queue.push(n);
                        }
                    }
                }
            }
        }

        // Find capital and gold
        let gold = 0;
        for (const h of regionHexes) {
            if (h.data.has_capital) {
                const capitalKey = `${h.q},${h.r}`;
                gold = player.region_gold?.[capitalKey] || 0;
                break;
            }
        }

        return {
            hexes: regionHexes,
            gold: gold,
            income: regionHexes.length,
        };
    }

    getNeighbors(q, r) {
        return [
            {q: q+1, r: r}, {q: q-1, r: r},
            {q: q, r: r+1}, {q: q, r: r-1},
            {q: q+1, r: r-1}, {q: q-1, r: r+1},
        ];
    }

    // Called by UI when buy button clicked
    startPlacingUnit(unitType, regionHexes) {
        this.placingUnitType = unitType;

        // Filter valid purchases from server for this unit type and region
        const regionKeys = new Set(regionHexes.map(h => `${h.q},${h.r}`));
        const validHexes = (this.validPurchases || [])
            .filter(p => p.unit_type === unitType)
            .filter(p => {
                // Either on own territory (in region) or adjacent attack
                const key = `${p.q},${p.r}`;
                if (regionKeys.has(key)) return true;
                // For attacks, check if adjacent to this region
                if (p.is_attack) {
                    for (const h of regionHexes) {
                        const neighbors = this.getNeighbors(h.q, h.r);
                        if (neighbors.some(n => n.q === p.q && n.r === p.r)) {
                            return true;
                        }
                    }
                }
                return false;
            })
            .map(p => ({q: p.q, r: p.r, isAttack: p.is_attack}));

        this.placingRegionHexes = validHexes;
        this.state = PlayerState.PLACING_UNIT;
        this.ui.hideRegionPanel();
        this.ui.showPlacementMode(unitType);
        this.renderHighlights();
    }

    cancelPlacement() {
        this.placingUnitType = null;
        this.placingRegionHexes = [];
        this.state = PlayerState.IDLE;
        this.ui.hidePlacementMode();
        this.board.render();
    }

    async placeUnit(hex) {
        const unitType = this.placingUnitType;
        this.ui.hidePlacementMode();

        try {
            const response = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'buy',
                    unit_type: unitType,
                    q: hex.q,
                    r: hex.r
                })
            });

            const result = await response.json();

            if (result.status === 'ok' && result.result?.success) {
                this.placingUnitType = null;
                this.placingRegionHexes = [];
                await this.loadValidActions();
                // Auto-select the placed unit
                this.selectUnit(hex);
            } else {
                console.error('Failed to place unit:', result);
                this.cancelPlacement();
            }
        } catch (e) {
            console.error('Failed to place unit:', e);
            this.cancelPlacement();
        }
    }

    async executeMove(from, to) {
        try {
            const response = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'move',
                    from_q: from.q,
                    from_r: from.r,
                    to_q: to.q,
                    to_r: to.r
                })
            });

            const result = await response.json();

            if (result.status === 'ok' && result.result?.success) {
                await this.loadValidActions();

                // Check if unit can still move
                const canStillMove = this.validMoves.some(m =>
                    m.from_q === to.q && m.from_r === to.r
                );

                if (canStillMove) {
                    this.selectedUnit = to;
                    this.renderHighlights();
                } else {
                    this.deselectUnit();
                }
            } else {
                console.error('Move failed:', result);
                this.deselectUnit();
            }
        } catch (e) {
            console.error('Failed to move:', e);
            this.deselectUnit();
        }
    }

    renderHighlights() {
        this.board.render();

        if (this.state === PlayerState.UNIT_SELECTED && this.selectedUnit) {
            this.board.highlightHex(this.selectedUnit.q, this.selectedUnit.r, '#fff', 3);

            for (const move of this.validMoves) {
                if (move.from_q === this.selectedUnit.q && move.from_r === this.selectedUnit.r) {
                    const color = move.is_attack ? '#e63946' : '#2a9d8f';
                    this.board.highlightHex(move.to_q, move.to_r, color, 2);
                }
            }
        } else if (this.state === PlayerState.PLACING_UNIT) {
            for (const hex of this.placingRegionHexes) {
                const color = hex.isAttack ? '#e63946' : '#e9c46a';
                this.board.highlightHex(hex.q, hex.r, color, 2);
            }
        }
    }

    async endTurn() {
        console.log('End Turn clicked');
        try {
            const response = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'end_turn' })
            });
            const result = await response.json();
            console.log('End turn result:', result);
            this.disable();
        } catch (e) {
            console.error('Failed to end turn:', e);
        }
    }

    getHexData(q, r) {
        if (!this.board.state?.board) return null;
        return this.board.state.board.hexes[`${q},${r}`];
    }
}
