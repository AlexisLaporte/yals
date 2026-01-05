from __future__ import annotations
from dataclasses import dataclass
from enum import Enum


class UnitType(Enum):
    PEASANT = "peasant"
    SPEARMAN = "spearman"
    KNIGHT = "knight"
    BARON = "baron"
    CASTLE = "castle"  # Static defense, no upkeep


UNIT_STATS = {
    UnitType.PEASANT: {"strength": 1, "cost": 10, "upkeep": 2},
    UnitType.SPEARMAN: {"strength": 2, "cost": 20, "upkeep": 6},
    UnitType.KNIGHT: {"strength": 3, "cost": 30, "upkeep": 18},
    UnitType.BARON: {"strength": 4, "cost": 40, "upkeep": 54},  # Was 36, correct is 54
    UnitType.CASTLE: {"strength": 2, "cost": 15, "upkeep": 0},  # Defends adjacent hexes
}

# Upgrade path: two units of same type merge into next level
UPGRADE_PATH = {
    UnitType.PEASANT: UnitType.SPEARMAN,
    UnitType.SPEARMAN: UnitType.KNIGHT,
    UnitType.KNIGHT: UnitType.BARON,
    UnitType.BARON: None,  # Cannot upgrade further
    UnitType.CASTLE: None,  # Castles don't merge
}


@dataclass
class Unit:
    type: UnitType
    owner: int
    has_moved: bool = False

    @property
    def strength(self) -> int:
        return UNIT_STATS[self.type]["strength"]

    @property
    def cost(self) -> int:
        return UNIT_STATS[self.type]["cost"]

    @property
    def upkeep(self) -> int:
        return UNIT_STATS[self.type]["upkeep"]

    @property
    def is_mobile(self) -> bool:
        """Castles cannot move."""
        return self.type != UnitType.CASTLE

    def can_kill(self, other: Unit) -> bool:
        """Returns True if this unit can kill the other unit."""
        return self.strength > other.strength

    def can_merge_with(self, other: Unit) -> bool:
        """Returns True if units can merge (same type, same owner, upgradeable)."""
        return (self.type == other.type and
                self.owner == other.owner and
                self.is_mobile and  # Castles can't merge
                UPGRADE_PATH[self.type] is not None)

    @classmethod
    def merge(cls, u1: Unit, u2: Unit) -> Unit | None:
        """Merge two units into upgraded unit."""
        if not u1.can_merge_with(u2):
            return None
        new_type = UPGRADE_PATH[u1.type]
        if new_type is None:
            return None
        return Unit(type=new_type, owner=u1.owner, has_moved=True)

    def reset_for_turn(self):
        """Reset unit state at start of turn."""
        self.has_moved = False

    def to_dict(self) -> dict:
        return {
            "type": self.type.value,
            "owner": self.owner,
            "strength": self.strength,
            "has_moved": self.has_moved,
        }

    @classmethod
    def from_dict(cls, data: dict) -> Unit:
        return cls(
            type=UnitType(data["type"]),
            owner=data["owner"],
            has_moved=data.get("has_moved", False),
        )

    def __str__(self) -> str:
        symbols = {
            UnitType.PEASANT: "P",
            UnitType.SPEARMAN: "S",
            UnitType.KNIGHT: "K",
            UnitType.BARON: "B",
            UnitType.CASTLE: "C",
        }
        return f"{symbols[self.type]}{self.owner}"
