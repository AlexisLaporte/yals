"""FastAPI server with WebSocket for Slay game."""

import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from game.state import GameState
from game.config import GameConfig, PlayerConfig, MapConfig
from game.orchestrator import GameOrchestrator
from game.controllers import HumanController
from game.database import save_game, load_last_game, new_game_slot, list_games, load_game_by_id


class ConnectionManager:
    """Manages WebSocket connections."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients."""
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for conn in dead:
            self.disconnect(conn)


class ActionRequest(BaseModel):
    """Request body for human player action."""
    type: str
    from_q: Optional[int] = None
    from_r: Optional[int] = None
    to_q: Optional[int] = None
    to_r: Optional[int] = None
    unit_type: Optional[str] = None
    q: Optional[int] = None
    r: Optional[int] = None


class GameConfigRequest(BaseModel):
    """Request body for new game with config."""
    players: list[dict]
    map: Optional[dict] = None
    enable_history: bool = True


def create_app() -> FastAPI:
    app = FastAPI(title="Slay AI")
    manager = ConnectionManager()

    # Game state
    orchestrator: Optional[GameOrchestrator] = None
    current_game_id: Optional[int] = None
    game_running = False
    game_paused = False
    turn_delay = 1.0
    action_delay = 0.2

    # Speed presets: (turn_delay, action_delay)
    speed_presets = {
        "fast": (0.2, 0.05),
        "normal": (1.0, 0.2),
        "slow": (2.0, 0.5),
    }

    def build_state_message(extra: dict = None) -> dict:
        """Build a state broadcast message with snapshot info."""
        msg = {
            "type": "state",
            "state": orchestrator.game_state.to_dict() if orchestrator and orchestrator.game_state else None,
            "waiting_for_human": orchestrator.waiting_player_id if orchestrator else None,
            "game_running": game_running,
            "max_snapshot": orchestrator.get_max_snapshot_id() if orchestrator and orchestrator.history else 0,
        }
        # Include latest snapshot's player info
        if orchestrator:
            snapshot_player = orchestrator.get_latest_snapshot_player()
            if snapshot_player:
                msg["snapshot_player_id"] = snapshot_player["id"]
                msg["snapshot_player_name"] = snapshot_player["name"]
        if extra:
            msg.update(extra)
        return msg

    # Static files
    client_path = Path(__file__).parent.parent.parent / "client"
    if client_path.exists():
        app.mount("/static", StaticFiles(directory=str(client_path)), name="static")

    @app.get("/")
    async def get_index():
        """Serve the main page."""
        index_path = client_path / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return HTMLResponse("<h1>Slay AI</h1><p>Client not found</p>")

    @app.get("/game/{game_id}")
    async def get_game_page(game_id: int):
        """Serve the main page for a specific game (client handles loading)."""
        index_path = client_path / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return HTMLResponse("<h1>Slay AI</h1><p>Client not found</p>")

    # ==================== Game Creation ====================

    @app.post("/api/new-game")
    async def new_game(
        width: int = 15,
        height: int = 15,
        num_players: int = 4,
        seed: int | None = None,
        player_type: str = "classic_ai",
        difficulty: str = "normal"
    ):
        """Create a new game with simple parameters."""
        nonlocal orchestrator, game_running
        game_running = False

        config = GameConfig(
            players=[
                PlayerConfig(controller_type=player_type, ai_difficulty=difficulty)
                for _ in range(num_players)
            ],
            map=MapConfig(width=width, height=height, seed=seed),
        )

        orchestrator = GameOrchestrator(config)
        game_state = orchestrator.initialize()

        await manager.broadcast({
            "type": "new_game",
            "state": game_state.to_dict(),
            "config": config.to_dict(),
        })

        return {"status": "ok", "state": game_state.to_dict()}

    @app.post("/api/new-game-config")
    async def new_game_from_config(request: GameConfigRequest):
        """Create a new game from full configuration."""
        nonlocal orchestrator, game_running, current_game_id
        game_running = False
        current_game_id = None  # New game, will get ID on first save

        players = [PlayerConfig.from_dict(p) for p in request.players]
        map_config = MapConfig.from_dict(request.map) if request.map else MapConfig()

        config = GameConfig(
            players=players,
            map=map_config,
            enable_history=request.enable_history,
        )

        orchestrator = GameOrchestrator(config)
        game_state = orchestrator.initialize()

        # Save immediately to get game_id
        current_game_id = save_game(orchestrator, None)

        await manager.broadcast({
            "type": "new_game",
            "state": game_state.to_dict(),
            "config": config.to_dict(),
        })

        return {"status": "ok", "state": game_state.to_dict(), "game_id": current_game_id}

    @app.get("/api/map-preview")
    async def get_map_preview(width: int = 15, height: int = 15, seed: int = None, num_players: int = 4):
        """Generate a map preview without starting a game."""
        from game.mapgen import generate_map, MapGenConfig
        import random

        actual_seed = seed if seed is not None else random.randint(0, 999999)
        config = MapGenConfig(
            width=width,
            height=height,
            num_players=num_players,
            seed=actual_seed,
        )
        board = generate_map(config)
        return {
            "status": "ok",
            "board": board.to_dict(),
            "seed": actual_seed,
        }

    @app.post("/api/reroll-map")
    async def reroll_map():
        """Regenerate map for current game (only at turn 1)."""
        nonlocal orchestrator, current_game_id
        import random

        if not orchestrator or not orchestrator.game_state:
            return {"status": "error", "message": "No game in progress"}

        if orchestrator.game_state.turn > 1:
            return {"status": "error", "message": "Can only change map at turn 1"}

        # Get current config and generate new seed
        old_config = orchestrator.config
        new_seed = random.randint(0, 999999)
        new_map_config = MapConfig(
            width=old_config.map.width,
            height=old_config.map.height,
            seed=new_seed,
        )

        new_config = GameConfig(
            players=old_config.players,
            map=new_map_config,
            enable_history=old_config.enable_history,
        )

        # Reinitialize game with new map
        orchestrator = GameOrchestrator(new_config)
        game_state = orchestrator.initialize()

        # Save as new game
        current_game_id = save_game(orchestrator, None)

        await manager.broadcast({
            "type": "new_game",
            "state": game_state.to_dict(),
            "config": new_config.to_dict(),
        })

        return {"status": "ok", "seed": new_seed}

    # ==================== Game Persistence ====================

    @app.get("/api/games")
    async def get_games_list():
        """List recent saved games."""
        games = list_games(10)
        return {"status": "ok", "games": games}

    @app.get("/api/game/latest")
    async def get_latest_game():
        """Load the most recent saved game."""
        nonlocal orchestrator, game_running, current_game_id
        game_running = False

        data = load_last_game()
        if not data:
            return {"status": "error", "message": "No saved game found"}

        # Get the game ID from list
        games = list_games(1)
        current_game_id = games[0]["id"] if games else None

        orchestrator = GameOrchestrator.from_dict({
            "config": data["config"],
            "game_state": data["state"],
            "history": data["history"],
            "waiting_for_human": None,
        })

        # If current player is human, set up waiting state
        current_controller = orchestrator.current_controller
        if isinstance(current_controller, HumanController):
            orchestrator._waiting_for_human = orchestrator.game_state.current_player.id
            current_controller._game_state = orchestrator.game_state
            current_controller._actions_this_turn = []

        await manager.broadcast(build_state_message())

        return {"status": "ok", "turn": orchestrator.game_state.turn, "game_id": current_game_id}

    @app.get("/api/game/{game_id}")
    async def load_game(game_id: int):
        """Load a specific saved game."""
        nonlocal orchestrator, game_running, current_game_id
        game_running = False

        data = load_game_by_id(game_id)
        if not data:
            return {"status": "error", "message": "Game not found"}

        current_game_id = game_id

        orchestrator = GameOrchestrator.from_dict({
            "config": data["config"],
            "game_state": data["state"],
            "history": data["history"],
            "waiting_for_human": None,
        })

        # If current player is human, set up waiting state
        current_controller = orchestrator.current_controller
        if isinstance(current_controller, HumanController):
            orchestrator._waiting_for_human = orchestrator.game_state.current_player.id
            current_controller._game_state = orchestrator.game_state
            current_controller._actions_this_turn = []

        await manager.broadcast(build_state_message())

        return {"status": "ok", "turn": orchestrator.game_state.turn, "game_id": current_game_id}

    @app.post("/api/game/save")
    async def save_current_game():
        """Manually save current game."""
        nonlocal current_game_id
        if not orchestrator:
            return {"status": "error", "message": "No game to save"}
        current_game_id = save_game(orchestrator, current_game_id)
        return {"status": "ok", "game_id": current_game_id}

    # ==================== Game Control ====================

    @app.post("/api/start")
    async def start_game():
        """Start/resume the game loop."""
        nonlocal game_running, game_paused
        if not orchestrator or not orchestrator.game_state:
            return {"status": "error", "message": "No game created"}

        game_paused = False
        if not game_running:
            game_running = True
            asyncio.create_task(run_game_loop())

        return {"status": "ok"}

    @app.post("/api/pause")
    async def pause_game():
        """Pause the game loop."""
        nonlocal game_paused
        game_paused = True
        return {"status": "ok"}

    class SpeedRequest(BaseModel):
        preset: Optional[str] = None
        turn_delay: Optional[float] = None
        action_delay: Optional[float] = None

    @app.post("/api/speed")
    async def set_speed(req: SpeedRequest):
        """Set game speed using preset or custom delays."""
        nonlocal turn_delay, action_delay
        if req.preset and req.preset in speed_presets:
            turn_delay, action_delay = speed_presets[req.preset]
        else:
            if req.turn_delay is not None:
                turn_delay = max(0.1, min(10.0, req.turn_delay))
            if req.action_delay is not None:
                action_delay = max(0.01, min(2.0, req.action_delay))
        return {"status": "ok", "turn_delay": turn_delay, "action_delay": action_delay}

    @app.post("/api/next-turn")
    async def next_turn():
        """Execute a single turn (or start waiting for human)."""
        if not orchestrator or not orchestrator.game_state:
            return {"status": "error", "message": "No game created"}

        game_state = orchestrator.game_state

        # Check victory
        winner = game_state.rules.check_victory()
        if winner is not None:
            await manager.broadcast({
                "type": "game_over",
                "winner": winner,
                "winner_name": game_state.players[winner].color_name
            })
            return {"status": "game_over", "winner": winner}

        current = game_state.current_player
        player_type = orchestrator.get_player_type(current.id)

        await manager.broadcast({
            "type": "turn_start",
            "turn": game_state.turn,
            "player": current.id,
            "player_name": current.color_name,
            "player_type": player_type,
        })

        async def on_action(action: dict):
            await manager.broadcast({
                "type": "action",
                "player": current.id,
                "action": action,
            })
            await asyncio.sleep(action_delay)

        try:
            result = await orchestrator.run_current_turn(on_action)
        except Exception as e:
            await manager.broadcast({"type": "error", "message": str(e)})
            return {"status": "error", "message": str(e)}

        # Broadcast territory deaths (units that died from being isolated)
        if result.get("territory_deaths"):
            await manager.broadcast({
                "type": "territory_deaths",
                "deaths": result["territory_deaths"],
            })

        await manager.broadcast(build_state_message())

        return result

    # ==================== Human Player Actions ====================

    @app.post("/api/action")
    async def submit_action(request: ActionRequest):
        """Submit an action from human player."""
        if not orchestrator:
            return {"status": "error", "message": "No game created"}

        if not orchestrator.waiting_for_human:
            return {"status": "error", "message": "Not waiting for human input"}

        action = {"type": request.type}
        if request.type == "move":
            action.update({
                "from_q": request.from_q,
                "from_r": request.from_r,
                "to_q": request.to_q,
                "to_r": request.to_r,
            })
        elif request.type == "buy":
            action.update({
                "unit_type": request.unit_type,
                "q": request.q,
                "r": request.r,
            })

        player_id = orchestrator.game_state.current_player.id
        result = await orchestrator.submit_human_action(action)

        await manager.broadcast(build_state_message())

        # Broadcast action
        if request.type == "end_turn":
            action_data = {"type": "end_turn", "success": True}
        else:
            action_data = result.get("result", result)

        await manager.broadcast({
            "type": "action",
            "player": player_id,
            "action": action_data,
        })

        # Auto-save after each action
        save_game(orchestrator, current_game_id)

        return result

    @app.get("/api/valid-moves")
    async def get_valid_moves():
        """Get valid moves for current player."""
        if not orchestrator or not orchestrator.game_state:
            return {"status": "error", "message": "No game created"}
        return {"status": "ok", "moves": orchestrator.get_valid_moves()}

    @app.get("/api/valid-purchases")
    async def get_valid_purchases():
        """Get valid purchases for current player."""
        if not orchestrator or not orchestrator.game_state:
            return {"status": "error", "message": "No game created"}
        return {"status": "ok", "purchases": orchestrator.get_valid_purchases()}

    # ==================== History & Undo ====================

    @app.get("/api/history")
    async def get_history(from_turn: int = 0):
        """Get game action history."""
        if not orchestrator:
            return {"status": "error", "message": "No game created"}
        return {"status": "ok", "history": orchestrator.get_history(from_turn)}

    @app.post("/api/undo")
    async def undo_to_turn(turn: int):
        """Undo game to start of specified turn."""
        if not orchestrator:
            return {"status": "error", "message": "No game created"}

        if orchestrator.undo_to_turn(turn):
            await manager.broadcast(build_state_message({"undone_to": turn}))
            return {"status": "ok", "turn": turn}

        return {"status": "error", "message": "Undo failed"}

    @app.get("/api/available-turns")
    async def get_available_turns():
        """Get list of turns that can be undone to."""
        if not orchestrator:
            return {"status": "error", "message": "No game created"}
        return {"status": "ok", "turns": orchestrator.get_available_turns()}

    @app.get("/api/snapshot/{snapshot_id}")
    async def get_snapshot_state(snapshot_id: int):
        """Get game state at a specific snapshot (read-only, for history navigation)."""
        if not orchestrator:
            return {"status": "error", "message": "No game created"}

        if not orchestrator.history:
            return {"status": "error", "message": "History not enabled"}

        snapshot = orchestrator.history.get_snapshot(snapshot_id)
        if not snapshot:
            return {"status": "error", "message": f"Snapshot {snapshot_id} not found"}

        # Restore to GameState and serialize for client compatibility
        temp_state = snapshot.restore()
        return {
            "status": "ok",
            "snapshot_id": snapshot_id,
            "max_snapshot": orchestrator.get_max_snapshot_id(),
            "state": temp_state.to_dict()
        }

    @app.get("/api/stats-history")
    async def get_stats_history():
        """Get player stats for each turn (for graph)."""
        if not orchestrator:
            return {"status": "ok", "history": []}

        history = []

        # From snapshots
        if orchestrator.history:
            for turn in sorted(orchestrator.history.snapshots.keys()):
                snapshot = orchestrator.history.snapshots[turn]
                history.append({
                    "turn": turn,
                    "players": [
                        {
                            "id": p["id"],
                            "territory": p["total_territory"],
                            "gold": p["total_gold"],
                            "units": p["total_units"],
                            "trees": p.get("total_trees", 0),
                        }
                        for p in snapshot.players_data
                    ]
                })

        # Add current state if exists and different from last snapshot
        if orchestrator.game_state:
            current_turn = orchestrator.game_state.turn
            if not history or history[-1]["turn"] != current_turn:
                history.append({
                    "turn": current_turn,
                    "players": [
                        {
                            "id": p.id,
                            "territory": p.get_total_territory(),
                            "gold": p.get_total_gold(),
                            "units": p.get_total_units(),
                            "trees": p.get_total_trees(),
                        }
                        for p in orchestrator.game_state.players
                    ]
                })

        return {"status": "ok", "history": history}

    # ==================== State ====================

    @app.get("/api/state")
    async def get_state():
        """Get current game state."""
        if not orchestrator or not orchestrator.game_state:
            return {"status": "error", "message": "No game"}
        return {
            "status": "ok",
            "state": orchestrator.game_state.to_dict(),
            "waiting_for_human": orchestrator.waiting_player_id,
            "game_running": game_running,
            "config": orchestrator.config.to_dict(),
        }

    # ==================== WebSocket ====================

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await manager.connect(websocket)
        try:
            if orchestrator and orchestrator.game_state:
                # Restore human waiting state if needed
                current_controller = orchestrator.current_controller
                if isinstance(current_controller, HumanController) and not orchestrator.waiting_for_human:
                    orchestrator._waiting_for_human = orchestrator.game_state.current_player.id
                    current_controller._game_state = orchestrator.game_state
                    current_controller._actions_this_turn = []

                await websocket.send_json(build_state_message())

            while True:
                data = await websocket.receive_text()
                try:
                    cmd = json.loads(data)
                    if cmd.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            manager.disconnect(websocket)

    # ==================== Game Loop ====================

    async def run_game_loop():
        """Main game loop for AI-only games."""
        nonlocal game_running

        while game_running and orchestrator and orchestrator.game_state:
            while game_paused and game_running:
                await asyncio.sleep(0.1)

            if not game_running:
                break

            game_state = orchestrator.game_state

            # Check victory
            winner = game_state.rules.check_victory()
            if winner is not None:
                await manager.broadcast({
                    "type": "game_over",
                    "winner": winner,
                    "winner_name": game_state.players[winner].color_name
                })
                game_running = False
                break

            # Skip if waiting for human
            if orchestrator.waiting_for_human:
                await asyncio.sleep(0.5)
                continue

            current = game_state.current_player
            player_type = orchestrator.get_player_type(current.id)

            await manager.broadcast({
                "type": "turn_start",
                "turn": game_state.turn,
                "player": current.id,
                "player_name": current.color_name,
                "player_type": player_type,
            })

            async def on_action(action: dict):
                await manager.broadcast({
                    "type": "action",
                    "player": current.id,
                    "action": action,
                })
                await asyncio.sleep(action_delay)

            try:
                result = await orchestrator.run_current_turn(on_action)
            except Exception as e:
                await manager.broadcast({"type": "error", "message": str(e)})

            # Broadcast territory deaths (units that died from being isolated)
            if result.get("territory_deaths"):
                await manager.broadcast({
                    "type": "territory_deaths",
                    "deaths": result["territory_deaths"],
                })

            await manager.broadcast(build_state_message())

            # Auto-save after each turn
            save_game(orchestrator, current_game_id)

            # If now waiting for human, don't delay
            if orchestrator.waiting_for_human:
                continue

            await asyncio.sleep(turn_delay)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7000)
