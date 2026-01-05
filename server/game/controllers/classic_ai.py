"""Classic heuristic AI controller."""
from __future__ import annotations
from typing import TYPE_CHECKING, Callable, Awaitable

from .base import PlayerController, PlayerType
from ..ai.classic import ClassicAI

if TYPE_CHECKING:
    from ..state import GameState


class ClassicAIController(PlayerController):
    """Wrapper around ClassicAI heuristic engine."""

    def __init__(self, player_id: int, difficulty: str = "normal"):
        super().__init__(player_id)
        self.difficulty = difficulty
        self._ai = ClassicAI(player_id, difficulty)

    @property
    def player_type(self) -> PlayerType:
        return PlayerType.CLASSIC_AI

    async def play_turn(
        self,
        game_state: GameState,
        on_action: Callable[[dict], Awaitable[None]] | None = None
    ) -> list[dict]:
        """Execute turn using heuristic AI."""
        actions = self._ai.play_turn(game_state)

        if on_action:
            for action in actions:
                await on_action(action)

        # End turn if AI didn't already
        if not actions or actions[-1].get("type") != "end_turn":
            result = game_state.end_turn()
            end_action = {"type": "end_turn", **result}
            actions.append(end_action)
            if on_action:
                await on_action(end_action)

        return actions
