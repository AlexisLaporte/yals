from __future__ import annotations
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .board import Terrain

if TYPE_CHECKING:
    from .board import Board, Hex


COLORS = ["#F0A8A8", "#A8C8F0", "#B8E0B0", "#F0E8A8", "#D8B8E8", "#F0C8A8"]
COLOR_NAMES = ["Rose", "Sky", "Mint", "Sunny", "Lavender", "Peach"]


@dataclass
class Region:
    """A connected group of hexes belonging to one player."""
    hexes: set[Hex]
    has_capital: bool
    gold: int = 0

    @property
    def capital_hex(self) -> Hex | None:
        """Return the hex where the capital is located (first hex by coordinates)."""
        if not self.has_capital or not self.hexes:
            return None
        # Pick deterministic hex (lowest q, then lowest r)
        return min(self.hexes, key=lambda h: (h.q, h.r))

    @property
    def income(self) -> int:
        """Income = number of hexes in region (excluding trees and graves).

        Capital always generates at least 1 gold.
        """
        base = sum(1 for h in self.hexes if h.terrain not in (Terrain.TREE, Terrain.GRAVE))
        if self.has_capital:
            return max(1, base)
        return base

    @property
    def max_gold(self) -> int:
        """Max gold storage: unlimited with capital, 10 without."""
        return 999999 if self.has_capital else 10

    def has_castle(self) -> bool:
        """Check if region has at least one castle unit (required in Slay)."""
        from .units import UnitType
        for h in self.hexes:
            if h.unit and h.unit.type == UnitType.CASTLE:
                return True
        return False

    def get_territory_maintenance(self) -> int:
        """Calculate territory maintenance cost based on size (Slay rules).

        Formula: (number_of_hexes - 1) gold per turn
        - 1 hex: 0g maintenance
        - 2 hexes: 1g maintenance
        - 3 hexes: 2g maintenance, etc.
        """
        return max(0, len(self.hexes) - 1)

    def get_upkeep(self) -> int:
        """Total upkeep cost for all units in region."""
        total = 0
        for h in self.hexes:
            if h.unit:
                total += h.unit.upkeep
        return total

    def collect_income(self):
        """Collect income for this region."""
        self.gold = min(self.gold + self.income, self.max_gold)

    def pay_upkeep(self) -> list[Hex]:
        """Pay upkeep (territory maintenance + unit upkeep), return hexes with units that died from starvation.

        In Slay, each territory has a maintenance cost based on its size: (hexes - 1) gold.
        This is IN ADDITION to unit upkeep costs.
        """
        territory_cost = self.get_territory_maintenance()
        unit_upkeep = self.get_upkeep()
        total_cost = territory_cost + unit_upkeep

        if self.gold >= total_cost:
            self.gold -= total_cost
            return []

        # Not enough gold - try to pay territory maintenance first, then starve units
        if self.gold >= territory_cost:
            # Can afford territory maintenance, but not all unit upkeep
            self.gold -= territory_cost
            remaining_gold = self.gold
            unit_upkeep_to_pay = unit_upkeep

            # Starve weakest units first
            starved = []
            units_by_upkeep = sorted(
                [h for h in self.hexes if h.unit],
                key=lambda h: h.unit.upkeep
            )
            while remaining_gold < unit_upkeep_to_pay and units_by_upkeep:
                h = units_by_upkeep.pop(0)
                unit_upkeep_to_pay -= h.unit.upkeep
                h.unit = None
                h.terrain = Terrain.GRAVE
                starved.append(h)

            self.gold = max(0, remaining_gold - unit_upkeep_to_pay)
            return starved
        else:
            # Cannot even afford territory maintenance - this shouldn't happen
            # because check_territory_maintenance should have killed the region
            # But handle it gracefully just in case
            self.gold = 0
            return []


@dataclass
class Player:
    id: int
    color: str = ""
    color_name: str = ""
    eliminated: bool = False
    regions: list[Region] = field(default_factory=list)

    def __post_init__(self):
        if not self.color:
            self.color = COLORS[self.id % len(COLORS)]
        if not self.color_name:
            self.color_name = COLOR_NAMES[self.id % len(COLOR_NAMES)]

    def update_regions(self, board: Board):
        """Recalculate regions from board state.

        In Slay, each territory of 2+ hexes automatically has a capital.
        When territories merge, gold is combined.
        """
        old_regions = {id(r): r for r in self.regions}
        old_gold_by_hex = {}
        for r in self.regions:
            for h in r.hexes:
                old_gold_by_hex[id(h)] = r.gold / len(r.hexes) if r.hexes else 0

        region_sets = board.get_regions(self.id)
        self.regions = []

        for hex_set in region_sets:
            # Territory of 2+ hexes automatically has capital
            has_capital = len(hex_set) >= 2
            region = Region(hexes=hex_set, has_capital=has_capital)

            # Preserve gold from old regions (sum up gold from merged territories)
            total_old_gold = 0
            seen_old_regions = set()
            for h in hex_set:
                for old_r in old_regions.values():
                    if h in old_r.hexes and id(old_r) not in seen_old_regions:
                        total_old_gold += old_r.gold
                        seen_old_regions.add(id(old_r))
                        break
            region.gold = min(total_old_gold, region.max_gold)

            self.regions.append(region)

    def check_castle_requirement(self) -> list[dict]:
        """Check castle requirement for all regions (Slay rules).

        Each territory MUST have at least one castle to survive.
        If a territory has no castle, it dies immediately.

        Returns list of territory deaths: [{"region_size": int, "hexes": [(q,r)], "reason": str}]
        """
        deaths = []
        regions_to_kill = []

        for region in self.regions:
            if not region.has_castle():
                # Territory dies - all hexes become neutral, units removed
                hex_coords = [(h.q, h.r) for h in region.hexes]
                deaths.append({
                    "region_size": len(region.hexes),
                    "hexes": hex_coords,
                    "reason": "no_castle"
                })
                regions_to_kill.append(region)

                # Kill the territory
                for h in region.hexes:
                    if h.unit:
                        h.terrain = Terrain.GRAVE
                        h.unit = None
                    h.owner = None

        # Remove dead regions
        for region in regions_to_kill:
            self.regions.remove(region)

        return deaths

    def check_territory_maintenance(self) -> list[dict]:
        """Check if territories can afford maintenance (Slay rules).

        Each territory has a maintenance cost based on its size: (hexes - 1) gold.
        This is IN ADDITION to unit upkeep costs.
        If a territory cannot afford maintenance + upkeep, it dies.

        Returns list of territory deaths: [{"region_size": int, "hexes": [(q,r)], "reason": str, "needed": int, "had": int}]
        """
        deaths = []
        regions_to_kill = []

        for region in self.regions:
            territory_cost = region.get_territory_maintenance()
            unit_upkeep = region.get_upkeep()
            total_cost = territory_cost + unit_upkeep

            if region.gold < total_cost:
                # Territory dies - cannot afford maintenance
                hex_coords = [(h.q, h.r) for h in region.hexes]
                deaths.append({
                    "region_size": len(region.hexes),
                    "hexes": hex_coords,
                    "reason": "insufficient_gold",
                    "needed": total_cost,
                    "had": region.gold
                })
                regions_to_kill.append(region)

                # Kill the territory
                for h in region.hexes:
                    if h.unit:
                        h.terrain = Terrain.GRAVE
                        h.unit = None
                    h.owner = None

        # Remove dead regions
        for region in regions_to_kill:
            self.regions.remove(region)

        return deaths

    def kill_isolated_units(self) -> list[tuple]:
        """Kill units in regions without capital (isolated hexes).

        In Slay, units in isolated territory die at the start of the next turn.
        Returns list of (hex, unit_type) for units that died.
        """
        deaths = []
        for region in self.regions:
            if not region.has_capital:
                for h in region.hexes:
                    if h.unit:
                        deaths.append((h, h.unit.type.value))
                        h.unit = None
                        h.terrain = Terrain.GRAVE
        return deaths

    def get_total_gold(self) -> int:
        return sum(r.gold for r in self.regions)

    def get_total_territory(self) -> int:
        return sum(len(r.hexes) for r in self.regions)

    def get_total_units(self) -> int:
        count = 0
        for r in self.regions:
            for h in r.hexes:
                if h.unit:
                    count += 1
        return count

    def get_total_trees(self) -> int:
        return sum(1 for r in self.regions for h in r.hexes if h.terrain == Terrain.TREE)

    def get_total_graves(self) -> int:
        return sum(1 for r in self.regions for h in r.hexes if h.terrain == Terrain.GRAVE)

    def start_turn(self):
        """Called at start of player's turn."""
        for region in self.regions:
            region.collect_income()

    def end_turn(self) -> list[Hex]:
        """Called at end of player's turn. Returns hexes with starved units."""
        all_starved = []
        for region in self.regions:
            starved = region.pay_upkeep()
            all_starved.extend(starved)
        return all_starved

    def check_eliminated(self, board: Board) -> bool:
        """Check if player has lost (no territory left)."""
        territory = board.get_territory(self.id)
        self.eliminated = len(territory) == 0
        return self.eliminated

    def to_dict(self) -> dict:
        # Store gold with a representative hex coord for each region
        region_gold = {}
        for r in self.regions:
            if r.hexes:
                rep_hex = min(r.hexes, key=lambda h: (h.q, h.r))
                region_gold[f"{rep_hex.q},{rep_hex.r}"] = r.gold

        return {
            "id": self.id,
            "color": self.color,
            "color_name": self.color_name,
            "eliminated": self.eliminated,
            "total_gold": self.get_total_gold(),
            "total_territory": self.get_total_territory(),
            "total_units": self.get_total_units(),
            "total_trees": self.get_total_trees(),
            "total_graves": self.get_total_graves(),
            "region_gold": region_gold,
            "regions": [
                {
                    "hex_count": len(r.hexes),
                    "has_capital": r.has_capital,
                    "has_castle": r.has_castle(),
                    "gold": r.gold,
                    "income": r.income,
                    "upkeep": r.get_upkeep(),
                    "territory_maintenance": r.get_territory_maintenance(),
                }
                for r in self.regions
            ]
        }

    @classmethod
    def from_dict(cls, data: dict, board: Board) -> Player:
        """Reconstruct player from serialized data."""
        player = cls(
            id=data["id"],
            color=data.get("color", ""),
            color_name=data.get("color_name", ""),
            eliminated=data.get("eliminated", False),
        )
        # Rebuild regions from board state
        player.update_regions(board)

        # Restore gold per region using the stored representative hex coords
        region_gold = data.get("region_gold", {})
        for r in player.regions:
            if r.hexes:
                rep_hex = min(r.hexes, key=lambda h: (h.q, h.r))
                key = f"{rep_hex.q},{rep_hex.r}"
                if key in region_gold:
                    r.gold = region_gold[key]

        return player
