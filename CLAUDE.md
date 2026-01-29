# YALS - Yet Another Slay

Clone du jeu de stratégie hexagonal Slay avec IA agentique (Claude).

## Stack

- **Backend**: Python, FastAPI, WebSocket, uvicorn
- **Frontend**: Vanilla JS, Ionic Framework, Canvas API, Chart.js
- **AI**: Anthropic Claude API (agents LLM)
- **DB**: SQLite (parties sauvegardées)

## Architecture

```
server/
  main.py              # Entry point (uvicorn port 7000)
  web/server.py        # FastAPI app, WebSocket, API routes
  game/
    orchestrator.py    # Game loop, turn management
    state.py           # GameState, player/hex data
    board.py           # Hex grid logic
    mapgen.py          # Procedural map generation
    rules.py           # Combat, movement, economy rules
    units.py           # Unit types (peasant, spearman, knight, baron)
    controllers/       # Player controllers (human, classic_ai, llm_ai)
    history/           # Snapshot/replay system
  ai/
    agent.py           # Claude agent for LLM AI players
    tools.py           # Agent tools (move, buy, end_turn)

client/
  game.html            # Main game page (Ionic app)
  index.html           # Landing page
  rules.html           # Game rules
  style.css            # Theme (pastel colors, dark mode)
  js/
    app.js             # Main app logic, socket events
    board.js           # Canvas hex rendering
    ui.js              # UI state, modals, controls
    human.js           # Human player input handling
    graph.js           # Stats chart (Chart.js)
    websocket.js       # WebSocket client
```

## Commands

```bash
# Dev local
cd server && python main.py          # http://localhost:7000

# Deploy (tuls.me)
ssh -i ~/.ssh/alexis root@51.15.225.121
cd /opt/yals && git pull && systemctl restart yals
```

## Conventions

### Couleurs joueurs (pastel)
| ID | Nom    | Couleur   |
|----|--------|-----------|
| 0  | Rose   | #F0A8A8   |
| 1  | Sky    | #A8C8F0   |
| 2  | Mint   | #B8E0B0   |
| 3  | Sunny  | #F0E8A8   |
| 4  | Lavender | #D8B8E8 |
| 5  | Peach  | #F0C8A8   |

### UI Footer
- Turn bar: numéro tour + joueur actuel
- Action buttons: "Terminer mon tour" / "Lancer la partie" / "Pause"
- History controls: navigation entre snapshots

### API WebSocket
Messages reçus: `state`, `new_game`, `turn_start`, `action`, `game_over`
Messages envoyés: `ping`

## Key Concepts

- **Region**: groupe de hexagones connectés d'un même joueur avec une capitale
- **Capital**: hex spécial qui stocke l'or de la région
- **Income**: +1 or/tour par hex, -coût entretien unités
- **Combat**: unité forte tue unité faible, égalité = défenseur gagne
- **Snapshot**: état complet sauvegardé chaque tour pour replay
