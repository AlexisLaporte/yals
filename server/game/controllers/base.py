"""Base player controller abstraction."""
from __future__ import annotations
from abc import ABC, abstractmethod
from enum import Enum
from typing import TYPE_CHECKING, Callable, Awaitable

if TYPE_CHECKING:
    from ..state import GameState


class PlayerType(Enum):
    HUMAN = "human"
    CLASSIC_AI = "classic_ai"
    LLM_AI = "llm_ai"


class PlayerController(ABC):
    """Interface for player control (human or AI)."""

    def __init__(self, player_id: int):
        self.player_id = player_id

    @property
    @abstractmethod
    def player_type(self) -> PlayerType:
        """Return the type of this controller."""
        pass

    @property
    def is_async(self) -> bool:
        """True if controller waits for external input (human)."""
        return False

    @abstractmethod
    async def play_turn(
        self,
        game_state: GameState,
        on_action: Callable[[dict], Awaitable[None]] | None = None
    ) -> list[dict]:
        """Execute the player's turn, returning all actions taken.

        Args:
            game_state: Current game state (turn already started)
            on_action: Optional callback called after each action

        Returns:
            List of action results from this turn
        """
        pass
