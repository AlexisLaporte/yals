"""Human player controller."""
from __future__ import annotations
import asyncio
from typing import TYPE_CHECKING, Callable, Awaitable

from .base import PlayerController, PlayerType

if TYPE_CHECKING:
    from ..state import GameState


class HumanController(PlayerController):
    """Controller that waits for human input via API."""

    def __init__(self, player_id: int):
        super().__init__(player_id)
        self._pending_action: asyncio.Future | None = None
        self._actions_this_turn: list[dict] = []
        self._turn_complete: asyncio.Event | None = None
        self._game_state = None
        self._on_action = None

    @property
    def player_type(self) -> PlayerType:
        return PlayerType.HUMAN

    @property
    def is_async(self) -> bool:
        return True

    async def play_turn(
        self,
        game_state: GameState,
        on_action: Callable[[dict], Awaitable[None]] | None = None
    ) -> list[dict]:
        """Wait for human to complete their turn via submit_action calls."""
        self._actions_this_turn = []
        self._turn_complete = asyncio.Event()
        self._on_action = on_action
        self._game_state = game_state

        # Wait until turn is ended
        await self._turn_complete.wait()

        return self._actions_this_turn

    async def submit_action(self, action: dict) -> dict:
        """Called by API endpoint when human submits action.

        Args:
            action: {"type": "move"|"buy"|"end_turn", ...params}

        Returns:
            Result of the action
        """
        if self._game_state is None:
            return {"success": False, "message": "Not your turn"}

        game_state = self._game_state
        action_type = action.get("type")

        if action_type == "move":
            result = game_state.move_unit(
                action["from_q"], action["from_r"],
                action["to_q"], action["to_r"]
            )
        elif action_type == "buy":
            result = game_state.buy_unit(
                action["unit_type"], action["q"], action["r"]
            )
        elif action_type == "end_turn":
            result = game_state.end_turn()
            result["type"] = "end_turn"
        else:
            return {"success": False, "message": f"Unknown action: {action_type}"}

        self._actions_this_turn.append(result)

        if self._on_action:
            await self._on_action(result)

        # End turn if action was end_turn
        if action_type == "end_turn" and isinstance(self._turn_complete, asyncio.Event):
            self._turn_complete.set()

        return result

    def cancel_turn(self):
        """Cancel waiting for human input (e.g., on disconnect)."""
        if self._turn_complete:
            self._turn_complete.set()
