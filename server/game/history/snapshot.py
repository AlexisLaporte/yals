"""Game state snapshots for undo/replay."""
from __future__ import annotations
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..state import GameState


@dataclass
class StateSnapshot:
    """Complete game state at a point in time (start of turn)."""
    turn: int
    current_player_idx: int
    board_data: dict
    players_data: list[dict]
    action_count: int

    @classmethod
    def capture(cls, game_state: GameState, action_count: int) -> StateSnapshot:
        """Capture current game state."""
        return cls(
            turn=game_state.turn,
            current_player_idx=game_state.current_player_idx,
            board_data=game_state.board.to_dict(),
            players_data=[p.to_dict() for p in game_state.players],
            action_count=action_count,
        )

    def restore(self) -> GameState:
        """Reconstruct GameState from snapshot."""
        from ..state import GameState
        return GameState.from_snapshot(self)

    def to_dict(self) -> dict:
        return {
            "turn": self.turn,
            "current_player_idx": self.current_player_idx,
            "board": self.board_data,
            "players": self.players_data,
            "action_count": self.action_count,
        }

    @classmethod
    def from_dict(cls, data: dict) -> StateSnapshot:
        return cls(
            turn=data["turn"],
            current_player_idx=data["current_player_idx"],
            board_data=data["board"],
            players_data=data["players"],
            action_count=data["action_count"],
        )
