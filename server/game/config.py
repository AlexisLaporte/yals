"""Game configuration dataclasses."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal
import json


@dataclass
class PlayerConfig:
    """Configuration for a single player."""
    controller_type: Literal["human", "classic_ai", "llm_ai"]
    name: str | None = None
    ai_difficulty: Literal["easy", "normal", "hard"] = "normal"
    llm_model: str = "claude-sonnet-4-20250514"

    def to_dict(self) -> dict:
        return {
            "controller_type": self.controller_type,
            "name": self.name,
            "ai_difficulty": self.ai_difficulty,
            "llm_model": self.llm_model,
        }

    @classmethod
    def from_dict(cls, data: dict) -> PlayerConfig:
        return cls(**data)


@dataclass
class MapConfig:
    """Map generation configuration."""
    width: int = 15
    height: int = 15
    seed: int | None = None
    # Tree mechanics (Slay-style)
    tree_growth_enabled: bool = True  # Trees spread each turn
    tree_spread_threshold: int = 2  # Min tree neighbors to spawn new tree

    def to_dict(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "seed": self.seed,
            "tree_growth_enabled": self.tree_growth_enabled,
            "tree_spread_threshold": self.tree_spread_threshold,
        }

    @classmethod
    def from_dict(cls, data: dict) -> MapConfig:
        return cls(
            width=data.get("width", 15),
            height=data.get("height", 15),
            seed=data.get("seed"),
            tree_growth_enabled=data.get("tree_growth_enabled", True),
            tree_spread_threshold=data.get("tree_spread_threshold", 2),
        )


@dataclass
class GameConfig:
    """Complete game configuration."""
    players: list[PlayerConfig]
    map: MapConfig = field(default_factory=MapConfig)
    enable_history: bool = True

    @classmethod
    def human_vs_3ai(cls, difficulty: str = "normal") -> GameConfig:
        """Preset: 1 human vs 3 classic AI."""
        return cls(
            players=[
                PlayerConfig(controller_type="human", name="Player"),
                PlayerConfig(controller_type="classic_ai", ai_difficulty=difficulty),
                PlayerConfig(controller_type="classic_ai", ai_difficulty=difficulty),
                PlayerConfig(controller_type="classic_ai", ai_difficulty=difficulty),
            ]
        )

    @classmethod
    def all_classic_ai(cls, num_players: int = 4,
                       difficulty: str = "normal") -> GameConfig:
        """Preset: All classic AI players."""
        return cls(
            players=[
                PlayerConfig(controller_type="classic_ai", ai_difficulty=difficulty)
                for _ in range(num_players)
            ]
        )

    @classmethod
    def all_llm_ai(cls, num_players: int = 4,
                   model: str = "claude-sonnet-4-20250514") -> GameConfig:
        """Preset: All LLM AI players."""
        return cls(
            players=[
                PlayerConfig(controller_type="llm_ai", llm_model=model)
                for _ in range(num_players)
            ]
        )

    @classmethod
    def mixed_ai(cls, classic_count: int = 2, llm_count: int = 2) -> GameConfig:
        """Preset: Mixed classic and LLM AI players."""
        players = []
        for _ in range(classic_count):
            players.append(PlayerConfig(controller_type="classic_ai"))
        for _ in range(llm_count):
            players.append(PlayerConfig(controller_type="llm_ai"))
        return cls(players=players)

    def to_dict(self) -> dict:
        return {
            "players": [p.to_dict() for p in self.players],
            "map": self.map.to_dict(),
            "enable_history": self.enable_history,
        }

    @classmethod
    def from_dict(cls, data: dict) -> GameConfig:
        return cls(
            players=[PlayerConfig.from_dict(p) for p in data["players"]],
            map=MapConfig.from_dict(data.get("map", {})),
            enable_history=data.get("enable_history", True),
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, json_str: str) -> GameConfig:
        return cls.from_dict(json.loads(json_str))
