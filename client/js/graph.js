/**
 * Stats graph using Chart.js - Stacked area 100%
 */

class StatsGraph {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.chart = null;
        // Use same colors as board/ui (modern pastel palette)
        this.colors = {
            0: '#F0A8A8',  // Soft rose
            1: '#A8C8F0',  // Sky blue
            2: '#B8E0B0',  // Mint green
            3: '#F0E8A8',  // Pale yellow
            4: '#D8B8E8',  // Lavender
            5: '#F0C8A8'   // Peach
        };
        this.colorNames = ['Rose', 'Sky', 'Mint', 'Sunny', 'Lavender', 'Peach'];
        this.treesColor = '#7AA870';  // Soft forest green for trees
        this.currentMetric = 'territory';
        this.showTrees = true;
        this.lastTurn = 0;  // Track last turn to avoid duplicates
    }

    async fetchAndUpdate() {
        try {
            const resp = await fetch('/api/stats-history');
            const data = await resp.json();
            console.log('[Graph] API response:', data);
            if (data.status === 'ok' && data.history && data.history.length > 0) {
                console.log('[Graph] Updating with', data.history.length, 'turns');
                this.update(data.history);
            } else {
                console.log('[Graph] No data, showing empty');
                this.showEmpty();
            }
        } catch (e) {
            console.error('[Graph] Failed to fetch stats history:', e);
            this.showEmpty();
        }
    }

    showEmpty() {
        if (!this.canvas) return;
        const ctx = this.canvas.getContext('2d');
        ctx.fillStyle = this.getTextColor();
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet', this.canvas.width / 2, this.canvas.height / 2);
    }

    update(history) {
        if (!this.canvas) return;

        const turns = history.map(h => h.turn);
        const playerCount = history[0]?.players?.length || 4;
        this.lastTurn = turns[turns.length - 1] || 0;

        // Calculate percentages for 100% stacked chart
        const datasets = [];

        // For territory metric, include trees as part of the total (if toggled on)
        const includeTreesAsPlayer = (this.currentMetric === 'territory' && this.showTrees);

        for (let p = 0; p < playerCount; p++) {
            const playerData = history.map(h => {
                const player = h.players.find(pl => pl.id === p);
                let value = player ? (player[this.currentMetric] || 0) : 0;

                // For territory, subtract trees from player's count (trees shown separately)
                if (includeTreesAsPlayer && player) {
                    value -= (player.trees || 0);
                }

                // Calculate total (including trees as separate category for territory)
                let total = h.players.reduce((sum, pl) => {
                    let v = pl[this.currentMetric] || 0;
                    if (includeTreesAsPlayer) {
                        v -= (pl.trees || 0);  // Subtract trees from territory
                    }
                    return sum + v;
                }, 0);
                if (includeTreesAsPlayer) {
                    total += h.players.reduce((sum, pl) => sum + (pl.trees || 0), 0);  // Add total trees
                }

                return total > 0 ? (value / total) * 100 : 0;
            });

            datasets.push({
                label: this.colorNames[p],
                data: playerData,
                backgroundColor: this.colors[p] + 'CC',
                borderColor: this.colors[p],
                borderWidth: 1,
                fill: p === 0 ? 'origin' : '-1',
                tension: 0.2,
                pointRadius: 0,
            });
        }

        // Add trees as pseudo-player for territory metric
        if (includeTreesAsPlayer) {
            const treesData = history.map(h => {
                const totalTrees = h.players.reduce((sum, pl) => sum + (pl.trees || 0), 0);
                const totalTerritory = h.players.reduce((sum, pl) => sum + (pl.territory || 0), 0);
                return totalTerritory > 0 ? (totalTrees / totalTerritory) * 100 : 0;
            });
            console.log('[Graph] Trees data:', treesData, 'Total trees in last turn:',
                history[history.length-1]?.players?.reduce((sum, pl) => sum + (pl.trees || 0), 0));

            datasets.push({
                label: 'Trees',
                data: treesData,
                backgroundColor: this.treesColor + 'CC',
                borderColor: this.treesColor,
                borderWidth: 1,
                fill: '-1',
                tension: 0.2,
                pointRadius: 0,
            });
        }

        console.log('[Graph] Datasets count:', datasets.length, 'Metric:', this.currentMetric);

        const metricLabels = {
            territory: 'Territory',
            units: 'Units',
            gold: 'Gold'
        };

        if (this.chart) {
            this.chart.data.labels = turns;
            this.chart.data.datasets = datasets;
            this.chart.options.plugins.title.text = metricLabels[this.currentMetric];
            this.chart.update();
        } else {
            this.chart = new Chart(this.canvas, {
                type: 'line',
                data: { labels: turns, datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        title: {
                            display: true,
                            text: metricLabels[this.currentMetric],
                            color: this.getTextColor(),
                            font: { size: 12 }
                        },
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%`
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            display: true,
                            ticks: { color: this.getTextColor(), font: { size: 10 } },
                            grid: { display: false }
                        },
                        y: {
                            stacked: true,
                            min: 0,
                            max: 100,
                            ticks: {
                                color: this.getTextColor(),
                                callback: (v) => v + '%',
                                font: { size: 10 },
                                stepSize: 25
                            },
                            grid: { color: this.getGridColor() }
                        }
                    }
                }
            });
        }
    }

    // Add a single turn's data to the chart (incremental update)
    addTurn(turn, players) {
        // Skip if no chart, wrong turn, or already have this turn
        if (!this.chart || turn <= this.lastTurn) return;

        const includeTreesAsPlayer = (this.currentMetric === 'territory' && this.showTrees);

        // Calculate total for percentage
        let total = players.reduce((sum, p) => {
            let v = p[this.currentMetric] || 0;
            if (includeTreesAsPlayer) v -= (p.trees || 0);
            return sum + v;
        }, 0);
        if (includeTreesAsPlayer) {
            total += players.reduce((sum, p) => sum + (p.trees || 0), 0);
        }

        // Add label
        this.chart.data.labels.push(turn);

        // Add data point for each player
        players.forEach((p, i) => {
            if (this.chart.data.datasets[i]) {
                let value = p[this.currentMetric] || 0;
                if (includeTreesAsPlayer) value -= (p.trees || 0);
                const pct = total > 0 ? (value / total) * 100 : 0;
                this.chart.data.datasets[i].data.push(pct);
            }
        });

        // Add trees if enabled
        if (includeTreesAsPlayer) {
            const treesIdx = players.length;
            if (this.chart.data.datasets[treesIdx]) {
                const totalTrees = players.reduce((sum, p) => sum + (p.trees || 0), 0);
                const pct = total > 0 ? (totalTrees / total) * 100 : 0;
                this.chart.data.datasets[treesIdx].data.push(pct);
            }
        }

        this.lastTurn = turn;
        this.chart.update('none');  // 'none' = no animation for smooth updates
    }

    setMetric(metric) {
        this.currentMetric = metric;
        // Destroy chart when changing metric (dataset count may change)
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        this.fetchAndUpdate();
    }

    setShowTrees(show) {
        this.showTrees = show;
        // Destroy chart when toggling trees (dataset count changes)
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        this.fetchAndUpdate();
    }

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        this.lastTurn = 0;
    }

    getTextColor() {
        // Use Ionic color system
        const isDark = document.body.classList.contains('dark') ||
                       document.documentElement.getAttribute('data-theme') === 'dark';
        return isDark ? '#A8A090' : '#5A5048';
    }

    getGridColor() {
        const isDark = document.body.classList.contains('dark') ||
                       document.documentElement.getAttribute('data-theme') === 'dark';
        return isDark ? '#383432' : '#E0DCD5';
    }
}
