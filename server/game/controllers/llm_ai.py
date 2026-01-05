"""LLM-based AI controller using Claude."""
from __future__ import annotations
from typing import TYPE_CHECKING, Callable, Awaitable
import sys
from pathlib import Path

# Add server dir to path for ai imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from .base import PlayerController, PlayerType

if TYPE_CHECKING:
    from ..state import GameState


class LLMController(PlayerController):
    """Wrapper around SlayAgent (Claude-powered)."""

    def __init__(self, player_id: int, color_name: str,
                 model: str = "claude-sonnet-4-20250514"):
        super().__init__(player_id)
        self.color_name = color_name
        self.model = model
        self._agent = None  # Lazy init to avoid import issues

    def _get_agent(self):
        """Lazily initialize the SlayAgent."""
        if self._agent is None:
            from ai.agent import SlayAgent
            self._agent = SlayAgent(self.player_id, self.color_name, self.model)
        return self._agent

    @property
    def player_type(self) -> PlayerType:
        return PlayerType.LLM_AI

    async def play_turn(
        self,
        game_state: GameState,
        on_action: Callable[[dict], Awaitable[None]] | None = None
    ) -> list[dict]:
        """Execute turn using Claude LLM."""
        agent = self._get_agent()

        # Convert on_action to on_message format expected by SlayAgent
        async def on_message(msg):
            if on_action and msg.type in ("tool_result",):
                await on_action(msg.data)

        return await agent.play_turn(game_state, on_message=on_message)
