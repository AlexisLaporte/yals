from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterator
import random


class Terrain(Enum):
    LAND = "land"
    SEA = "sea"
    TREE = "tree"
    GRAVE = "grave"


@dataclass(eq=False)
class Hex:
    q: int  # axial coordinate
    r: int  # axial coordinate
    terrain: Terrain = Terrain.LAND
    owner: int | None = None  # player_id or None
    unit: Unit | None = None
    # Note: capitals are now dynamic - any territory of 2+ hexes has a capital

    def __hash__(self):
        return hash((self.q, self.r))

    def __eq__(self, other):
        if not isinstance(other, Hex):
            return False
        return self.q == other.q and self.r == other.r

    @property
    def s(self) -> int:
        return -self.q - self.r

    def distance_to(self, other: Hex) -> int:
        return (abs(self.q - other.q) + abs(self.r - other.r) + abs(self.s - other.s)) // 2

    def to_dict(self) -> dict:
        return {
            "q": self.q,
            "r": self.r,
            "terrain": self.terrain.value,
            "owner": self.owner,
            "unit": self.unit.to_dict() if self.unit else None,
        }


# Import here to avoid circular dependency
from .units import Unit


# Directions for hex neighbors (axial coordinates)
HEX_DIRECTIONS = [
    (1, 0), (1, -1), (0, -1),
    (-1, 0), (-1, 1), (0, 1)
]


@dataclass
class Board:
    width: int
    height: int
    hexes: dict[tuple[int, int], Hex] = field(default_factory=dict)

    def __post_init__(self):
        if not self.hexes:
            self._generate_empty_board()

    def _generate_empty_board(self):
        for r in range(self.height):
            r_offset = r // 2
            for q in range(-r_offset, self.width - r_offset):
                self.hexes[(q, r)] = Hex(q=q, r=r)

    def get(self, q: int, r: int) -> Hex | None:
        return self.hexes.get((q, r))

    def __getitem__(self, coords: tuple[int, int]) -> Hex | None:
        return self.hexes.get(coords)

    def __iter__(self) -> Iterator[Hex]:
        return iter(self.hexes.values())

    def neighbors(self, h: Hex) -> list[Hex]:
        result = []
        for dq, dr in HEX_DIRECTIONS:
            neighbor = self.get(h.q + dq, h.r + dr)
            if neighbor:
                result.append(neighbor)
        return result

    def get_territory(self, player_id: int) -> list[Hex]:
        return [h for h in self.hexes.values() if h.owner == player_id]

    def get_region(self, start: Hex) -> set[Hex]:
        """Get all connected hexes of the same owner starting from start."""
        if start.owner is None:
            return set()

        visited = set()
        to_visit = [start]
        owner = start.owner

        while to_visit:
            current = to_visit.pop()
            if current in visited:
                continue
            if current.owner != owner:
                continue
            visited.add(current)
            for neighbor in self.neighbors(current):
                if neighbor not in visited and neighbor.owner == owner:
                    to_visit.append(neighbor)

        return visited

    def get_regions(self, player_id: int) -> list[set[Hex]]:
        """Get all distinct regions for a player."""
        territory = self.get_territory(player_id)
        visited = set()
        regions = []

        for h in territory:
            if h not in visited:
                region = self.get_region(h)
                visited.update(region)
                regions.append(region)

        return regions

    def get_frontier(self, player_id: int) -> list[Hex]:
        """Get hexes adjacent to enemy territory."""
        frontier = []
        for h in self.get_territory(player_id):
            for neighbor in self.neighbors(h):
                if neighbor.owner is not None and neighbor.owner != player_id:
                    frontier.append(h)
                    break
        return frontier

    @classmethod
    def generate(cls, width: int = 15, height: int = 15,
                 num_players: int = 4, sea_ratio: float = 0.1,
                 tree_ratio: float = 0.03, seed: int | None = None,
                 regions_per_player: int = 5) -> Board:
        """Generate a Slay-style map: 100% filled, multiple regions per player."""
        if seed is not None:
            random.seed(seed)

        board = cls(width=width, height=height)
        all_hexes = list(board.hexes.values())

        # Add sea around edges only
        for h in all_hexes:
            if h.r == 0 or h.r == height - 1:
                h.terrain = Terrain.SEA
            elif h.q < -height // 4 or h.q >= width - height // 4:
                h.terrain = Terrain.SEA

        # Small random sea patches
        land_hexes = [h for h in all_hexes if h.terrain == Terrain.LAND]
        num_sea = int(len(land_hexes) * sea_ratio)
        for h in random.sample(land_hexes, min(num_sea, len(land_hexes))):
            h.terrain = Terrain.SEA

        land_hexes = [h for h in all_hexes if h.terrain == Terrain.LAND]
        if not land_hexes:
            return board

        # Create multiple seeds per player (scattered across the map)
        all_seeds = []  # List of (hex, player_id)
        available = land_hexes.copy()
        random.shuffle(available)

        total_seeds = num_players * regions_per_player
        for i in range(min(total_seeds, len(available))):
            player_id = i % num_players
            h = available[i]
            h.owner = player_id
            all_seeds.append((h, player_id))

        # Note: capitals are now dynamic - any territory of 2+ hexes has a capital

        # Grow all seeds simultaneously (Voronoi-style)
        unclaimed = [h for h in land_hexes if h.owner is None]
        seed_territories = {i: [h] for i, (h, _) in enumerate(all_seeds)}

        while unclaimed:
            grew = False
            for seed_idx, (_, player_id) in enumerate(all_seeds):
                if not unclaimed:
                    break
                # Find frontier for this seed's territory
                frontier = []
                for h in seed_territories[seed_idx]:
                    for neighbor in board.neighbors(h):
                        if neighbor.terrain == Terrain.LAND and neighbor.owner is None:
                            frontier.append(neighbor)
                if frontier:
                    new_hex = random.choice(frontier)
                    new_hex.owner = player_id
                    seed_territories[seed_idx].append(new_hex)
                    unclaimed.remove(new_hex)
                    grew = True
            if not grew:
                break

        # Add a few trees (not on hexes with units)
        # Trees stay owned but generate no income (Slay rules)
        owned_hexes = [h for h in land_hexes if h.owner is not None and h.unit is None]
        num_trees = int(len(owned_hexes) * tree_ratio)
        for h in random.sample(owned_hexes, min(num_trees, len(owned_hexes))):
            h.terrain = Terrain.TREE
            # Keep owner - trees on owned land stay owned

        return board

    def to_dict(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "hexes": {f"{q},{r}": h.to_dict() for (q, r), h in self.hexes.items()}
        }

    @classmethod
    def from_dict(cls, data: dict) -> Board:
        """Reconstruct board from serialized data."""
        board = cls(width=data["width"], height=data["height"])
        board.hexes = {}
        for key, hex_data in data["hexes"].items():
            q, r = map(int, key.split(","))
            h = Hex(q=q, r=r)
            h.terrain = Terrain(hex_data["terrain"])
            h.owner = hex_data["owner"]
            if hex_data.get("unit"):
                h.unit = Unit.from_dict(hex_data["unit"])
            board.hexes[(q, r)] = h
        return board

    def to_ascii(self) -> str:
        """ASCII representation for debugging."""
        lines = []
        for r in range(self.height):
            indent = " " * (r // 2)
            row = []
            r_offset = r // 2
            for q in range(-r_offset, self.width - r_offset):
                h = self.get(q, r)
                if not h:
                    row.append(" ")
                elif h.terrain == Terrain.SEA:
                    row.append("~")
                elif h.terrain == Terrain.TREE:
                    row.append("T")
                elif h.owner is not None:
                    row.append(str(h.owner))
                else:
                    row.append(".")
            lines.append(indent + " ".join(row))
        return "\n".join(lines)
