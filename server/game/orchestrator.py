"""Game orchestrator that coordinates players, history, and game flow."""
from __future__ import annotations
from typing import Callable, Awaitable

from .state import GameState
from .config import GameConfig, PlayerConfig
from .history import HistoryManager, ActionType
from .controllers import (
    PlayerController,
    PlayerType,
    ClassicAIController,
    LLMController,
    HumanController,
)


class GameOrchestrator:
    """Coordinates game flow between players, handling async human input."""

    def __init__(self, config: GameConfig):
        self.config = config
        self.game_state: GameState | None = None
        self.controllers: dict[int, PlayerController] = {}
        self.history: HistoryManager | None = None
        self._waiting_for_human: int | None = None

    def initialize(self) -> GameState:
        """Create game state and controllers from config."""
        self.game_state = GameState.new_game(
            width=self.config.map.width,
            height=self.config.map.height,
            num_players=len(self.config.players),
            seed=self.config.map.seed,
        )

        for i, pc in enumerate(self.config.players):
            self.controllers[i] = self._create_controller(i, pc)

        if self.config.enable_history:
            self.history = HistoryManager()
            # Don't capture here - run_current_turn will capture at turn start

        return self.game_state

    def _create_controller(self, player_id: int, pc: PlayerConfig) -> PlayerController:
        """Create a controller based on player config."""
        if pc.controller_type == "human":
            return HumanController(player_id)
        elif pc.controller_type == "classic_ai":
            return ClassicAIController(player_id, pc.ai_difficulty)
        elif pc.controller_type == "llm_ai":
            color = self.game_state.players[player_id].color_name
            return LLMController(player_id, color, pc.llm_model)
        else:
            raise ValueError(f"Unknown controller type: {pc.controller_type}")

    @property
    def current_controller(self) -> PlayerController:
        """Get the controller for the current player."""
        return self.controllers[self.game_state.current_player_idx]

    @property
    def waiting_for_human(self) -> bool:
        """True if waiting for human input."""
        return self._waiting_for_human is not None

    @property
    def waiting_player_id(self) -> int | None:
        """ID of player we're waiting for, or None."""
        return self._waiting_for_human

    def get_player_type(self, player_id: int) -> str:
        """Get the type of a player's controller."""
        return self.controllers[player_id].player_type.value

    async def run_current_turn(
        self,
        on_action: Callable[[dict], Awaitable[None]] | None = None
    ) -> dict:
        """Execute current player's turn.

        Returns:
            - {"status": "waiting", "player": id} if human player
            - {"status": "turn_complete", "actions": count} if AI completed
            - {"status": "victory", "winner": id} if game over
        """
        controller = self.current_controller
        player = self.game_state.current_player

        # Start the turn - returns any territory deaths from isolated units
        territory_deaths = self.game_state.start_turn()

        if self.history:
            self.history.record_action(
                ActionType.TURN_START,
                player.id,
                self.game_state.turn,
                {},
                {},
            )
            # Snapshot at start of each turn
            self.history.capture_snapshot(self.game_state, self.game_state.turn)

        if controller.is_async:
            # Human player - enter waiting state
            self._waiting_for_human = player.id
            # Initialize human controller state for receiving actions
            if isinstance(controller, HumanController):
                controller._game_state = self.game_state
                controller._actions_this_turn = []
            result = {"status": "waiting", "player": player.id}
            if territory_deaths:
                result["territory_deaths"] = territory_deaths
            return result

        # AI player - run turn automatically
        async def record_action(action: dict):
            if self.history and action.get("type"):
                self.history.record_action(
                    ActionType(action["type"]),
                    player.id,
                    self.game_state.turn,
                    action,
                    action,
                )
            if on_action:
                await on_action(action)

        actions = await controller.play_turn(self.game_state, record_action)
        result = self._check_game_status(len(actions))
        if territory_deaths:
            result["territory_deaths"] = territory_deaths
        return result

    async def submit_human_action(self, action: dict) -> dict:
        """Process action from human player.

        Args:
            action: {"type": "move"|"buy"|"end_turn", ...params}

        Returns:
            {"status": "ok", "result": {...}} or
            {"status": "turn_complete", ...} or
            {"status": "victory", "winner": id}
        """
        if not self.waiting_for_human:
            return {"status": "error", "message": "Not waiting for human input"}

        controller = self.controllers[self._waiting_for_human]
        if not isinstance(controller, HumanController):
            return {"status": "error", "message": "Current player is not human"}

        result = await controller.submit_action(action)

        # Record in history
        if self.history and action.get("type"):
            self.history.record_action(
                ActionType(action["type"]),
                self._waiting_for_human,
                self.game_state.turn,
                action,
                result,
            )

        # Check if turn ended
        if action.get("type") == "end_turn":
            controller._game_state = None  # Clear controller state
            self._waiting_for_human = None
            return self._check_game_status(1)

        return {"status": "ok", "result": result}

    def _check_game_status(self, action_count: int) -> dict:
        """Check for victory and return appropriate status."""
        winner = self.game_state.rules.check_victory()
        if winner is not None:
            return {"status": "victory", "winner": winner}
        return {"status": "turn_complete", "actions": action_count}

    def undo_to_turn(self, turn: int) -> bool:
        """Restore game to start of specified turn (deprecated, use undo_to_snapshot)."""
        return self.undo_to_snapshot(turn)

    def undo_to_snapshot(self, snapshot_id: int) -> bool:
        """Restore game to specified snapshot."""
        if not self.history:
            return False

        try:
            self.game_state = self.history.undo_to_snapshot(snapshot_id)
            self._waiting_for_human = None
            return True
        except ValueError:
            return False

    def get_history(self, from_turn: int = 0) -> list[dict]:
        """Get action history from specified turn."""
        if not self.history:
            return []
        return self.history.get_actions(from_turn)

    def get_available_turns(self) -> list[int]:
        """Get list of snapshot IDs that can be navigated to."""
        if not self.history:
            return []
        return sorted(self.history.snapshots.keys())

    def get_max_snapshot_id(self) -> int:
        """Get the latest snapshot ID."""
        if not self.history:
            return 0
        return self.history.get_max_snapshot_id()

    def get_latest_snapshot_player(self) -> dict | None:
        """Get player info from the latest snapshot."""
        if not self.history:
            return None
        max_id = self.history.get_max_snapshot_id()
        if max_id == 0:
            return None
        snapshot = self.history.get_snapshot(max_id)
        if not snapshot:
            return None
        player_idx = snapshot.current_player_idx
        player_data = snapshot.players_data[player_idx] if player_idx < len(snapshot.players_data) else None
        if not player_data:
            return None
        return {
            "id": player_idx,
            "name": player_data.get("color_name", f"Player {player_idx}"),
        }

    def get_valid_moves(self) -> list[dict]:
        """Get valid moves for current player (for UI)."""
        player_id = self.game_state.current_player.id
        moves = self.game_state.rules.get_valid_moves(player_id)
        return [
            {
                "from_q": from_h.q,
                "from_r": from_h.r,
                "to_q": to_h.q,
                "to_r": to_h.r,
                "is_attack": to_h.owner != player_id,
            }
            for from_h, to_h in moves
        ]

    def get_valid_purchases(self) -> list[dict]:
        """Get valid purchases for current player (for UI)."""
        player_id = self.game_state.current_player.id
        purchases = self.game_state.rules.get_valid_purchases(player_id)
        return [
            {
                "unit_type": ut.value,
                "q": h.q,
                "r": h.r,
                "cost": h.unit.cost if h.unit else 0,
                "is_attack": is_attack,
            }
            for ut, h, gold, is_attack in purchases
        ]

    def to_dict(self) -> dict:
        """Serialize orchestrator state."""
        return {
            "config": self.config.to_dict(),
            "game_state": self.game_state.to_dict() if self.game_state else None,
            "waiting_for_human": self._waiting_for_human,
            "history": self.history.to_dict() if self.history else None,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "GameOrchestrator":
        """Restore orchestrator from saved data."""
        from .state import GameState
        from .history import HistoryManager

        config = GameConfig.from_dict(data["config"])
        orchestrator = cls(config)

        if data["game_state"]:
            orchestrator.game_state = GameState.from_dict(data["game_state"])

        # Recreate controllers
        for i, pc in enumerate(config.players):
            orchestrator.controllers[i] = orchestrator._create_controller(i, pc)

        if data["history"]:
            orchestrator.history = HistoryManager.from_dict(data["history"])

        orchestrator._waiting_for_human = data.get("waiting_for_human")

        return orchestrator
