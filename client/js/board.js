/**
 * Hexagonal board renderer using Canvas with SVG units
 */

class HexBoard {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.hexSize = 24;
        this.state = null;
        this.unitImages = {};
        this.imagesLoaded = false;

        // Highlight affordable regions (all hexes in territories with gold >= 10)
        this.affordableHexes = new Set();  // Set of "q,r" keys
        this.showAffordableHighlight = false;

        // Zoom/pan state
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // Drag state (for pan)
        this.mouseDown = false;
        this.isDragging = false;
        this.wasDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        // Colors will be loaded from CSS
        this.colors = {};
        this.terrainColors = {};
        this.loadColorsFromCSS();

        // Load unit SVGs
        this.loadUnitAssets();

        // Resize handler
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Zoom/pan handlers
        this.setupZoomPan();
    }

    loadColorsFromCSS() {
        const style = getComputedStyle(document.documentElement);

        // Player colors
        for (let i = 0; i < 6; i++) {
            this.colors[i] = style.getPropertyValue(`--player-${i}`).trim() || '#666';
        }

        // Terrain colors
        this.terrainColors = {
            land: style.getPropertyValue('--terrain-land').trim() || '#90B060',
            sea: style.getPropertyValue('--terrain-sea').trim() || '#6090C0',
            tree: style.getPropertyValue('--terrain-tree').trim() || '#408040'
        };
    }

    parseColor(color) {
        // Parse hex or rgb color to {r, g, b}
        if (!color || typeof color !== 'string') {
            return { r: 128, g: 128, b: 128 }; // Fallback gray
        }
        if (color.startsWith('#')) {
            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);
            if (isNaN(r) || isNaN(g) || isNaN(b)) {
                return { r: 128, g: 128, b: 128 };
            }
            return { r, g, b };
        } else if (color.startsWith('rgb')) {
            const match = color.match(/(\d+)/g);
            if (match && match.length >= 3) {
                return {
                    r: parseInt(match[0]),
                    g: parseInt(match[1]),
                    b: parseInt(match[2])
                };
            }
        }
        return { r: 128, g: 128, b: 128 }; // Fallback gray
    }

    darkenColor(color, factor) {
        // Darken a color by factor (0-1)
        const { r, g, b } = this.parseColor(color);
        return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
    }

    lightenColor(color, factor) {
        // Lighten a color by factor (>1)
        const { r, g, b } = this.parseColor(color);
        return `rgb(${Math.min(255, Math.round(r * factor))}, ${Math.min(255, Math.round(g * factor))}, ${Math.min(255, Math.round(b * factor))})`;
    }

    setupZoomPan() {
        // Wheel zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            const newScale = Math.max(0.5, Math.min(3, this.scale * zoomFactor));

            // Zoom toward mouse position
            const scaleChange = newScale / this.scale;
            this.panX = mouseX - (mouseX - this.panX) * scaleChange;
            this.panY = mouseY - (mouseY - this.panY) * scaleChange;
            this.scale = newScale;

            this.render();
        }, { passive: false });

        // Disable context menu on canvas
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

        // Pan with left-click drag (distinguishes click vs drag with distance threshold)
        const DRAG_THRESHOLD = 8;  // pixels before drag starts

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) {  // Left click
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.isDragging = false;  // Not yet dragging, waiting for threshold
                this.mouseDown = true;
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.mouseDown) return;

            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Start dragging once threshold is exceeded
            if (!this.isDragging && distance > DRAG_THRESHOLD) {
                this.isDragging = true;
                this.canvas.style.cursor = 'grabbing';
            }

            if (this.isDragging) {
                const moveDx = e.clientX - this.lastMouseX;
                const moveDy = e.clientY - this.lastMouseY;
                this.panX += moveDx;
                this.panY += moveDy;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.render();
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isDragging) {
                this.canvas.style.cursor = '';
                this.wasDragging = true;  // Signal to ignore next click
            }
            this.mouseDown = false;
            this.isDragging = false;
        });
    }

    resetView() {
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.render();
    }

    async loadUnitAssets() {
        const units = ['peasant', 'spearman', 'knight', 'baron', 'castle', 'tree', 'grave'];
        const loadPromises = units.map(unit => this.loadSVG(unit));
        await Promise.all(loadPromises);
        this.imagesLoaded = true;
        this.render();
    }

    loadSVG(unitType) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.unitImages[unitType] = img;
                resolve();
            };
            img.onerror = () => {
                console.warn(`Failed to load ${unitType}.svg`);
                resolve();
            };
            img.src = `/static/assets/units/${unitType}.svg`;
        });
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const newWidth = Math.max(100, rect.width - 32);
        const newHeight = Math.max(100, rect.height - 32);

        // Only resize if dimensions actually changed
        if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
            this.canvas.width = newWidth;
            this.canvas.height = newHeight;
        }
        this.render();
    }

    setState(state) {
        this.state = state;
        this.render();
    }

    // Update which territories can afford units (for human player highlight)
    setAffordableCapitals(playerId, minGold = 10) {
        this.affordableHexes.clear();
        if (!this.state || !this.state.players || playerId === null) {
            this.showAffordableHighlight = false;
            return;
        }

        const player = this.state.players[playerId];
        if (!player || !player.region_gold) {
            this.showAffordableHighlight = false;
            return;
        }

        const board = this.state.board;
        const hexes = board.hexes;

        // Find capitals with enough gold, then expand to full territory
        for (const [capitalKey, gold] of Object.entries(player.region_gold)) {
            if (gold >= minGold) {
                // BFS to find all connected hexes from this capital
                const visited = new Set();
                const queue = [capitalKey];

                while (queue.length > 0) {
                    const key = queue.shift();
                    if (visited.has(key)) continue;

                    const hex = hexes[key];
                    if (!hex || hex.owner !== playerId) continue;

                    visited.add(key);
                    this.affordableHexes.add(key);

                    // Add neighbors
                    const [q, r] = key.split(',').map(Number);
                    const neighbors = [
                        [q+1, r], [q-1, r], [q, r+1], [q, r-1], [q+1, r-1], [q-1, r+1]
                    ];
                    for (const [nq, nr] of neighbors) {
                        const nkey = `${nq},${nr}`;
                        if (!visited.has(nkey)) {
                            queue.push(nkey);
                        }
                    }
                }
            }
        }
        this.showAffordableHighlight = this.affordableHexes.size > 0;
        this.render();
    }

    clearAffordableHighlight() {
        this.affordableHexes.clear();
        this.showAffordableHighlight = false;
        this.render();
    }

    // Pointy-top hex orientation (correct formula)
    hexToPixel(q, r) {
        const size = this.hexSize;
        const x = size * Math.sqrt(3) * (q + r / 2);
        const y = size * 3 / 2 * r;
        return { x, y };
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (!this.state || !this.state.board) return;

        const board = this.state.board;
        const hexes = board.hexes;

        // Calculate bounds and offset
        const bounds = this.calculateBounds(hexes);
        this.currentOffset = bounds.offset;

        // Apply zoom/pan transformation
        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.scale, this.scale);

        // Draw hexes (fill + stroke together to avoid gaps)
        for (const key in hexes) {
            const hex = hexes[key];
            const [q, r] = key.split(',').map(Number);
            const pos = this.hexToPixel(q, r);
            const x = pos.x + bounds.offset.x;
            const y = pos.y + bounds.offset.y;

            this.drawHex(x, y, hex);
        }

        // Second pass: draw terrain icons, capitals and units
        for (const key in hexes) {
            const hex = hexes[key];
            const [q, r] = key.split(',').map(Number);
            const pos = this.hexToPixel(q, r);
            const x = pos.x + bounds.offset.x;
            const y = pos.y + bounds.offset.y;

            // Draw terrain icons (trees, graves)
            if (hex.terrain === 'tree' || hex.terrain === 'grave') {
                this.drawTerrainIcon(x, y, hex.terrain);
            }
            if (hex.has_capital) {
                this.drawCapital(x, y);
            }
            if (hex.unit) {
                this.drawUnit(x, y, hex.unit);
            }
        }

        // Third pass: highlight affordable territories (for human player)
        if (this.showAffordableHighlight && this.affordableHexes.size > 0) {
            for (const key of this.affordableHexes) {
                const [q, r] = key.split(',').map(Number);
                const pos = this.hexToPixel(q, r);
                const x = pos.x + bounds.offset.x;
                const y = pos.y + bounds.offset.y;
                this.drawAffordableHighlight(x, y);
            }
        }

        ctx.restore();
    }

    drawAffordableHighlight(x, y) {
        const ctx = this.ctx;
        const size = this.hexSize;

        ctx.save();
        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = 8;

        // Draw hex outline with white glow
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i - Math.PI / 2;
            const hx = x + size * Math.cos(angle);
            const hy = y + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    }

    calculateBounds(hexes) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const key in hexes) {
            const [q, r] = key.split(',').map(Number);
            const pos = this.hexToPixel(q, r);
            minX = Math.min(minX, pos.x);
            maxX = Math.max(maxX, pos.x);
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y);
        }

        const boardWidth = maxX - minX + this.hexSize * 2;
        const boardHeight = maxY - minY + this.hexSize * 2;

        return {
            offset: {
                x: (this.canvas.width - boardWidth) / 2 - minX + this.hexSize,
                y: (this.canvas.height - boardHeight) / 2 - minY + this.hexSize
            },
            min: { x: minX, y: minY },
            max: { x: maxX, y: maxY }
        };
    }

    drawHex(x, y, hex) {
        const ctx = this.ctx;
        const size = this.hexSize;

        // Pointy-top hexagon path (starts at top, 30° offset)
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i - Math.PI / 2;  // Pointy-top: first vertex at top
            const hx = x + size * Math.cos(angle);
            const hy = y + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();

        // Fill based on terrain/owner with gradient for depth
        if (hex.terrain === 'sea') {
            // Sea with subtle gradient
            const seaGrad = ctx.createRadialGradient(x, y - size * 0.3, 0, x, y, size);
            seaGrad.addColorStop(0, this.lightenColor(this.terrainColors.sea, 1.15));
            seaGrad.addColorStop(1, this.terrainColors.sea);
            ctx.fillStyle = seaGrad;
            ctx.fill();
        } else if (hex.owner !== null) {
            // Owned hex with gradient for depth
            const baseColor = this.colors[hex.owner] || '#666';
            const grad = ctx.createRadialGradient(x, y - size * 0.4, 0, x, y, size * 1.2);
            grad.addColorStop(0, this.lightenColor(baseColor, 1.2));
            grad.addColorStop(0.7, baseColor);
            grad.addColorStop(1, this.darkenColor(baseColor, 0.85));
            ctx.fillStyle = grad;
            ctx.fill();
        } else {
            // Neutral land
            ctx.fillStyle = this.terrainColors.land;
            ctx.fill();
        }

        // Enhanced border
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    drawCapital(x, y) {
        const ctx = this.ctx;
        const size = this.hexSize;
        const radius = size * 0.28;

        // Outer golden glow
        ctx.save();
        ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
        ctx.shadowBlur = 8;

        // Gradient fill for depth
        const grad = ctx.createRadialGradient(x, y - radius * 0.3, 0, x, y, radius);
        grad.addColorStop(0, '#FFF8DC');  // Cornsilk highlight
        grad.addColorStop(0.4, '#FFD700'); // Gold
        grad.addColorStop(1, '#B8860B');   // DarkGoldenrod edge

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Crisp border (inside save/restore so path still exists)
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#8B6914';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
    }

    drawTerrainIcon(x, y, terrain) {
        const ctx = this.ctx;
        const size = this.hexSize * 0.65;
        const img = this.unitImages[terrain];

        if (img && this.imagesLoaded) {
            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.drawImage(img, x - size * 0.5, y - size * 0.5, size, size);
            ctx.restore();
        }
    }

    drawUnit(x, y, unit) {
        const ctx = this.ctx;
        const size = this.hexSize * 0.7;
        const img = this.unitImages[unit.type];

        if (img && this.imagesLoaded) {
            ctx.save();

            if (unit.has_moved) {
                ctx.globalAlpha = 0.5;
            }

            // Drop shadow ellipse under unit
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.beginPath();
            ctx.ellipse(x, y + size * 0.45, size * 0.4, size * 0.15, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Gradient background circle
            const baseColor = unit.has_moved ? '#555' : this.colors[unit.owner] || '#666';
            const radius = size * 0.6;
            const grad = ctx.createRadialGradient(x, y - radius * 0.3, 0, x, y, radius);
            grad.addColorStop(0, this.lightenColor(baseColor, 1.3));
            grad.addColorStop(0.6, baseColor);
            grad.addColorStop(1, this.darkenColor(baseColor, 0.7));

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();

            // Border
            ctx.strokeStyle = this.darkenColor(baseColor, 0.5);
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Draw the SVG
            ctx.drawImage(img, x - size * 0.5, y - size * 0.5, size, size);

            ctx.restore();
        } else {
            // Fallback to text symbols
            this.drawUnitFallback(x, y, unit);
        }
    }

    drawUnitFallback(x, y, unit) {
        const ctx = this.ctx;
        const size = this.hexSize * 0.6;

        const symbols = {
            'peasant': 'P',
            'spearman': 'S',
            'knight': 'K',
            'baron': 'B',
            'castle': 'C'
        };

        ctx.beginPath();
        ctx.arc(x, y, size * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = unit.has_moved ? '#555' : '#fff';
        ctx.fill();
        ctx.strokeStyle = this.colors[unit.owner] || '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = `bold ${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = unit.has_moved ? '#999' : '#000';
        ctx.fillText(symbols[unit.type] || '?', x, y);
    }

    pixelToHex(px, py) {
        if (!this.state || !this.state.board) return null;

        const board = this.state.board;
        const bounds = this.calculateBounds(board.hexes);
        const size = this.hexSize;

        // Account for zoom/pan transformation
        const transformedX = (px - this.panX) / this.scale;
        const transformedY = (py - this.panY) / this.scale;

        const x = transformedX - bounds.offset.x;
        const y = transformedY - bounds.offset.y;

        // Pointy-top hex to axial conversion (correct formula)
        const q = (Math.sqrt(3)/3 * x - 1/3 * y) / size;
        const r = (2/3 * y) / size;

        // Cube round for accurate hex selection
        const rx = Math.round(q);
        const rz = Math.round(r);
        const ry = Math.round(-q - r);

        const xDiff = Math.abs(rx - q);
        const yDiff = Math.abs(ry - (-q - r));
        const zDiff = Math.abs(rz - r);

        let roundedQ, roundedR;
        if (xDiff > yDiff && xDiff > zDiff) {
            roundedQ = -ry - rz;
            roundedR = rz;
        } else if (yDiff > zDiff) {
            roundedQ = rx;
            roundedR = rz;
        } else {
            roundedQ = rx;
            roundedR = -rx - ry;
        }

        const key = `${roundedQ},${roundedR}`;
        if (board.hexes[key]) {
            return { q: roundedQ, r: roundedR };
        }

        return null;
    }

    highlightHex(q, r, color = '#fff', lineWidth = 3) {
        if (!this.state) return;

        const board = this.state.board;
        const key = `${q},${r}`;
        if (!board.hexes[key]) return;

        const bounds = this.calculateBounds(board.hexes);
        const pos = this.hexToPixel(q, r);
        const x = pos.x + bounds.offset.x;
        const y = pos.y + bounds.offset.y;

        const ctx = this.ctx;
        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.scale, this.scale);

        // Helper to draw hex path
        const drawHexPath = () => {
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = Math.PI / 3 * i - Math.PI / 2;
                const hx = x + this.hexSize * Math.cos(angle);
                const hy = y + this.hexSize * Math.sin(angle);
                if (i === 0) ctx.moveTo(hx, hy);
                else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
        };

        // Outer glow
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        drawHexPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth + 2;
        ctx.stroke();
        ctx.restore();

        // Main crisp stroke
        drawHexPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        ctx.restore();
    }
}
