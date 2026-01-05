"""Slay AI Agent using Claude Code SDK."""

import asyncio
import os
import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import Callable

# Set OAuth token before importing SDK
os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = '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'
os.environ.pop('ANTHROPIC_API_KEY', None)  # Ensure no API key

from claude_code_sdk import query, ClaudeCodeOptions, AssistantMessage, TextBlock, ToolUseBlock, ResultMessage

sys.path.insert(0, str(Path(__file__).parent.parent))

from ai.tools import SYSTEM_PROMPT
from game.state import GameState


@dataclass
class AgentMessage:
    """Message from agent to broadcast."""
    type: str  # "thinking", "action", "summary"
    content: str
    player_id: int
    data: dict = field(default_factory=dict)


class SlayAgent:
    """AI agent that plays Slay using Claude Code SDK."""

    def __init__(self, player_id: int, color_name: str, model: str = "claude-sonnet-4-20250514"):
        self.player_id = player_id
        self.color_name = color_name
        self.model = model
        self.session_id: str | None = None  # For conversation continuity

    async def play_turn(
        self,
        game_state: GameState,
        on_message: Callable[[AgentMessage], None] | None = None
    ) -> list[dict]:
        """Play a full turn using Claude Code SDK."""
        import inspect
        actions = []

        async def emit(msg: AgentMessage):
            if on_message:
                result = on_message(msg)
                if inspect.iscoroutine(result):
                    await result

        # Build the prompt with current game state
        state_prompt = game_state.to_prompt()

        # Custom system prompt for Slay
        system_prompt = f"""{SYSTEM_PROMPT}

You are {self.color_name} (Player {self.player_id}).

To take actions, output JSON on its own line:
{{"tool": "move", "from_q": 0, "from_r": 6, "to_q": 0, "to_r": 5}}
{{"tool": "buy", "unit_type": "peasant", "q": 0, "r": 6}}
{{"tool": "end_turn"}}

Coordinates must match exactly what's shown in "Available moves" and "YOUR EMPTY HEXES"."""

        user_prompt = f"""{state_prompt}

Analyze the situation, decide your strategy, and take your actions."""

        # Configure SDK options
        options = ClaudeCodeOptions(
            model=self.model,
            system_prompt=system_prompt,
            max_turns=50,
            resume=self.session_id,  # Continue previous conversation
        )

        turn_ended = False
        full_response = ""

        try:
            async for message in query(prompt=user_prompt, options=options):
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            text = block.text.strip()
                            if text:
                                full_response += text + "\n"

                                # Parse JSON tool calls from text
                                import json
                                import re
                                json_pattern = r'\{[^{}]*"tool"[^{}]*\}'

                                # Split text into parts (reasoning vs tool calls)
                                last_end = 0
                                for match in re.finditer(json_pattern, text):
                                    # Send reasoning before this tool call (split by paragraphs)
                                    reasoning = text[last_end:match.start()].strip()
                                    if reasoning:
                                        # Split into paragraphs for progressive display
                                        paragraphs = [p.strip() for p in reasoning.split('\n\n') if p.strip()]
                                        for para in paragraphs:
                                            await emit(AgentMessage(
                                                type="thinking",
                                                content=para,
                                                player_id=self.player_id
                                            ))
                                            await asyncio.sleep(0.4)  # Delay between paragraphs

                                    # Send tool call
                                    tool_json = match.group()
                                    await emit(AgentMessage(
                                        type="tool_call",
                                        content=tool_json,
                                        player_id=self.player_id
                                    ))
                                    await asyncio.sleep(0.5)  # Delay for visibility

                                    # Execute tool
                                    try:
                                        tool_call = json.loads(tool_json)
                                        action = self._execute_tool(tool_call, game_state)
                                        if action:
                                            actions.append(action)
                                            await emit(AgentMessage(
                                                type="tool_result",
                                                content=f"{action.get('success', True) and '✓' or '✗'} {action.get('message', '')}",
                                                player_id=self.player_id,
                                                data=action
                                            ))
                                            await asyncio.sleep(0.3)  # Delay for visibility
                                            if action.get('type') == 'end_turn':
                                                turn_ended = True
                                    except json.JSONDecodeError:
                                        pass

                                    last_end = match.end()

                                # Send remaining reasoning after last tool call
                                remaining = text[last_end:].strip()
                                if remaining:
                                    paragraphs = [p.strip() for p in remaining.split('\n\n') if p.strip()]
                                    for para in paragraphs:
                                        await emit(AgentMessage(
                                            type="thinking",
                                            content=para,
                                            player_id=self.player_id
                                        ))
                                        await asyncio.sleep(0.3)

                elif isinstance(message, ResultMessage):
                    # Store session_id for conversation continuity
                    self.session_id = message.session_id

        except Exception as e:
            print(f"Agent error: {e}")
            import traceback
            traceback.print_exc()

        # Force end turn if not ended
        if not turn_ended:
            result = game_state.end_turn()
            actions.append({"type": "end_turn", "forced": True, **result})
            await emit(AgentMessage(
                type="summary",
                content="Turn ended (forced)",
                player_id=self.player_id
            ))

        return actions

    def _execute_tool(self, tool_call: dict, game_state: GameState) -> dict | None:
        """Execute a tool call from agent output."""
        tool = tool_call.get('tool')

        if tool == 'move':
            result = game_state.move_unit(
                from_q=tool_call.get('from_q'),
                from_r=tool_call.get('from_r'),
                to_q=tool_call.get('to_q'),
                to_r=tool_call.get('to_r')
            )
            return result

        elif tool == 'buy':
            result = game_state.buy_unit(
                unit_type=tool_call.get('unit_type'),
                target_q=tool_call.get('q'),
                target_r=tool_call.get('r')
            )
            return result

        elif tool == 'end_turn':
            result = game_state.end_turn()
            return {"type": "end_turn", **result}

        return None


class GameRunner:
    """Orchestrates a game between multiple AI agents."""

    def __init__(self, game_state: GameState, model: str = "claude-sonnet-4-20250514"):
        self.game_state = game_state
        self.agents: dict[int, SlayAgent] = {}

        # Create an agent for each player
        for player in game_state.players:
            self.agents[player.id] = SlayAgent(
                player_id=player.id,
                color_name=player.color_name,
                model=model
            )

    async def run_turn(
        self,
        on_message: Callable[[AgentMessage], None] | None = None
    ) -> list[dict]:
        """Run current player's turn."""
        current = self.game_state.current_player
        if current.eliminated:
            return []

        agent = self.agents[current.id]
        self.game_state.start_turn()

        return await agent.play_turn(self.game_state, on_message)

    async def run_game(
        self,
        max_turns: int = 100,
        on_message: Callable[[AgentMessage], None] | None = None,
        on_turn_end: Callable[[int, int], None] | None = None
    ) -> int | None:
        """Run full game until victory or max turns. Returns winner id."""

        for _ in range(max_turns * len(self.game_state.players)):
            winner = self.game_state.rules.check_victory()
            if winner is not None:
                return winner

            current_turn = self.game_state.turn
            current_player = self.game_state.current_player.id

            actions = await self.run_turn(on_message)

            if on_turn_end:
                on_turn_end(current_turn, current_player)

            for action in actions:
                if "winner" in action:
                    return action["winner"]

        return None
