"""Tool definitions for Slay AI agent."""

SLAY_TOOLS = [
    {
        "name": "move_unit",
        "description": """Move a unit from one hex to an adjacent hex.
Rules:
- Units can only move once per turn
- Can move within own territory freely
- Can attack adjacent enemy hexes (kills weaker units)
- Can claim neutral hexes
- Stronger units kill weaker ones (strength comparison)""",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_q": {
                    "type": "integer",
                    "description": "Q coordinate of source hex (axial)"
                },
                "from_r": {
                    "type": "integer",
                    "description": "R coordinate of source hex (axial)"
                },
                "to_q": {
                    "type": "integer",
                    "description": "Q coordinate of target hex (axial)"
                },
                "to_r": {
                    "type": "integer",
                    "description": "R coordinate of target hex (axial)"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Explain why you're making this move (strategy)"
                }
            },
            "required": ["from_q", "from_r", "to_q", "to_r", "reasoning"]
        }
    },
    {
        "name": "buy_unit",
        "description": """Purchase a new unit and place it on your territory.
Unit types (in order of strength):
- peasant: cost 10, upkeep 2, strength 1 (can chop trees)
- spearman: cost 20, upkeep 6, strength 2
- knight: cost 30, upkeep 18, strength 3
- baron: cost 40, upkeep 36, strength 4

Important:
- Gold is per-region, not global
- Upkeep is paid at end of turn
- Units starve if you can't pay upkeep""",
        "input_schema": {
            "type": "object",
            "properties": {
                "unit_type": {
                    "type": "string",
                    "enum": ["peasant", "spearman", "knight", "baron"],
                    "description": "Type of unit to purchase"
                },
                "target_q": {
                    "type": "integer",
                    "description": "Q coordinate to place unit (axial)"
                },
                "target_r": {
                    "type": "integer",
                    "description": "R coordinate to place unit (axial)"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Explain why you're buying this unit (strategy)"
                }
            },
            "required": ["unit_type", "target_q", "target_r", "reasoning"]
        }
    },
    {
        "name": "end_turn",
        "description": """End your turn. Call this when you've made all desired moves and purchases.
At end of turn:
- Upkeep is deducted from each region
- Units starve if region can't afford upkeep
- Next player's turn begins""",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Brief summary of what you accomplished this turn and your strategy"
                }
            },
            "required": ["summary"]
        }
    }
]


SYSTEM_PROMPT = """You are an AI playing Slay. Conquer the map by eliminating all opponents.

## RULES

**Map**: Hexagonal grid divided between players. Sea impassable.

**Territories & Capitals**:
- Each territory of 2+ connected hexes automatically has a capital
- Capital stores unlimited gold, territories without capital max 10g
- Connecting two territories merges their gold

**Economy**:
- Each hex = 1 gold/turn (trees don't produce)
- Gold stored per territory
- Upkeep paid at end of turn, units starve if unpaid

**Units** (strength / cost / upkeep):
- Peasant: 1 / 10g / 2g (can chop trees)
- Spearman: 2 / 20g / 6g
- Knight: 3 / 30g / 18g
- Baron: 4 / 40g / 54g
- Castle: 2 / 15g / 0g (cannot move, defends adjacent hexes)

**Defense**: A hex is defended by the STRONGEST of:
- Unit on the hex
- Adjacent units in same territory
- Adjacent capitals (strength 1)
- Adjacent castles (strength 2)

**Movement**:
- Units can move UNLIMITED times within their territory
- Units can make only ONE attack per turn (onto enemy hex or chop tree)
- Castles cannot move

**Buying units**:
- Place on your territory OR on enemy hex adjacent to your territory (conquers it!)
- Must beat the defense strength

**Merging**: Drop unit onto same type to upgrade (Peasant+Peasant=Spearman, etc.)

## STRATEGY
- BUY units directly on enemy hexes to attack!
- Cut enemy territories to split them (loses their capital = max 10g)
- Merge peasants into stronger units
- Use castles to defend key positions

ALWAYS end with end_turn."""


def format_tool_result(success: bool, message: str, data: dict = None) -> str:
    """Format tool result for the agent."""
    result = f"{'✓' if success else '✗'} {message}"
    if data:
        for k, v in data.items():
            result += f"\n  {k}: {v}"
    return result
