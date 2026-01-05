"""Game action recording."""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
import time


class ActionType(Enum):
    MOVE = "move"
    BUY = "buy"
    END_TURN = "end_turn"
    TURN_START = "turn_start"


@dataclass(frozen=True)
class GameAction:
    """Immutable record of a game action."""
    action_type: ActionType
    player_id: int
    turn: int
    sequence: int
    params: dict
    result: dict
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "type": self.action_type.value,
            "player": self.player_id,
            "turn": self.turn,
            "seq": self.sequence,
            "params": self.params,
            "result": self.result,
            "ts": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict) -> GameAction:
        return cls(
            action_type=ActionType(data["type"]),
            player_id=data["player"],
            turn=data["turn"],
            sequence=data["seq"],
            params=data["params"],
            result=data["result"],
            timestamp=data.get("ts", 0),
        )
