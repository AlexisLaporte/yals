"""History manager for tracking and undoing game actions."""
from __future__ import annotations
from typing import TYPE_CHECKING

from .action import GameAction, ActionType
from .snapshot import StateSnapshot

if TYPE_CHECKING:
    from ..state import GameState


class HistoryManager:
    """Manages action log and snapshots for undo/replay."""

    def __init__(self):
        self.actions: list[GameAction] = []
        self.snapshots: dict[int, StateSnapshot] = {}  # snapshot_id -> snapshot
        self._action_sequence = 0
        self._snapshot_sequence = 0  # Unique ID for each player-turn

    def record_action(self, action_type: ActionType, player_id: int,
                     turn: int, params: dict, result: dict) -> GameAction:
        """Record an action."""
        action = GameAction(
            action_type=action_type,
            player_id=player_id,
            turn=turn,
            sequence=self._action_sequence,
            params=params,
            result=result,
        )
        self.actions.append(action)
        self._action_sequence += 1
        return action

    def capture_snapshot(self, game_state: GameState, at_turn: int) -> int:
        """Take a snapshot. Returns the snapshot ID."""
        self._snapshot_sequence += 1
        self.snapshots[self._snapshot_sequence] = StateSnapshot.capture(
            game_state, len(self.actions)
        )
        return self._snapshot_sequence

    def get_snapshot(self, snapshot_id: int) -> StateSnapshot | None:
        """Get snapshot by ID."""
        return self.snapshots.get(snapshot_id)

    def get_state_at_snapshot(self, snapshot_id: int) -> GameState:
        """Reconstruct state at given snapshot."""
        if snapshot_id not in self.snapshots:
            raise ValueError(f"Snapshot {snapshot_id} not found")
        return self.snapshots[snapshot_id].restore()

    def get_max_snapshot_id(self) -> int:
        """Get the highest snapshot ID (latest state)."""
        return self._snapshot_sequence

    def undo_to_snapshot(self, snapshot_id: int) -> GameState:
        """Return state at snapshot and truncate history."""
        state = self.get_state_at_snapshot(snapshot_id)
        snapshot = self.snapshots[snapshot_id]

        # Remove actions after this snapshot
        self.actions = self.actions[:snapshot.action_count]
        self._action_sequence = len(self.actions)

        # Remove snapshots after this one
        self.snapshots = {sid: s for sid, s in self.snapshots.items() if sid <= snapshot_id}
        self._snapshot_sequence = snapshot_id

        return state

    def get_actions(self, from_turn: int = 0) -> list[dict]:
        """Get action history from specified turn."""
        return [a.to_dict() for a in self.actions if a.turn >= from_turn]

    def get_turn_actions(self, turn: int) -> list[dict]:
        """Get all actions for a specific turn."""
        return [a.to_dict() for a in self.actions if a.turn == turn]

    def to_dict(self) -> dict:
        return {
            "actions": [a.to_dict() for a in self.actions],
            "snapshots": {str(sid): s.to_dict() for sid, s in self.snapshots.items()},
            "snapshot_sequence": self._snapshot_sequence,
        }

    @classmethod
    def from_dict(cls, data: dict) -> HistoryManager:
        manager = cls()
        manager.actions = [GameAction.from_dict(a) for a in data["actions"]]
        manager.snapshots = {
            int(sid): StateSnapshot.from_dict(s)
            for sid, s in data["snapshots"].items()
        }
        manager._action_sequence = len(manager.actions)
        manager._snapshot_sequence = data.get("snapshot_sequence", len(manager.snapshots))
        return manager
