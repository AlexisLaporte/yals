"""Procedural map generator using Perlin noise."""
import random
import math
from dataclasses import dataclass
from .board import Board, Hex, Terrain


@dataclass
class MapGenConfig:
    """Configuration for map generation."""
    width: int = 20
    height: int = 20
    num_players: int = 4
    seed: int | None = None
    # Noise parameters
    land_threshold: float = 0.35  # Higher = less land
    noise_scale: float = 0.12  # Lower = smoother terrain
    octaves: int = 4  # More = more detail
    # Features
    tree_density: float = 0.08  # More trees = more barriers
    # Shape
    island_falloff: float = 0.65  # How quickly edges become sea (0-1)


def _fade(t: float) -> float:
    """Smoothstep fade function."""
    return t * t * t * (t * (t * 6 - 15) + 10)


def _lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation."""
    return a + t * (b - a)


def _grad(hash_val: int, x: float, y: float) -> float:
    """Gradient function for 2D Perlin noise."""
    h = hash_val & 3
    if h == 0:
        return x + y
    elif h == 1:
        return -x + y
    elif h == 2:
        return x - y
    else:
        return -x - y


class PerlinNoise:
    """2D Perlin noise generator."""

    def __init__(self, seed: int = 0):
        self.perm = list(range(256))
        random.seed(seed)
        random.shuffle(self.perm)
        self.perm = self.perm + self.perm  # Double for overflow

    def noise(self, x: float, y: float) -> float:
        """Generate noise value at (x, y), returns -1 to 1."""
        # Grid cell coordinates
        xi = int(math.floor(x)) & 255
        yi = int(math.floor(y)) & 255

        # Relative position in cell
        xf = x - math.floor(x)
        yf = y - math.floor(y)

        # Fade curves
        u = _fade(xf)
        v = _fade(yf)

        # Hash coordinates of corners
        aa = self.perm[self.perm[xi] + yi]
        ab = self.perm[self.perm[xi] + yi + 1]
        ba = self.perm[self.perm[xi + 1] + yi]
        bb = self.perm[self.perm[xi + 1] + yi + 1]

        # Blend gradients
        x1 = _lerp(_grad(aa, xf, yf), _grad(ba, xf - 1, yf), u)
        x2 = _lerp(_grad(ab, xf, yf - 1), _grad(bb, xf - 1, yf - 1), u)

        return _lerp(x1, x2, v)

    def octave_noise(self, x: float, y: float, octaves: int = 4, persistence: float = 0.5) -> float:
        """Multi-octave noise for more natural terrain."""
        total = 0.0
        frequency = 1.0
        amplitude = 1.0
        max_value = 0.0

        for _ in range(octaves):
            total += self.noise(x * frequency, y * frequency) * amplitude
            max_value += amplitude
            amplitude *= persistence
            frequency *= 2

        return total / max_value


def _distance_to_center(q: int, r: int, width: int, height: int) -> float:
    """Normalized distance from hex to map center (0 = center, 1 = corner)."""
    # Convert axial to approximate cartesian for distance calc
    x = q + r / 2
    y = r * 0.866  # sqrt(3)/2

    center_x = width / 2
    center_y = height * 0.866 / 2

    dx = (x - center_x) / (width / 2)
    dy = (y - center_y) / (height * 0.866 / 2)

    return math.sqrt(dx * dx + dy * dy)


def _get_connected_component(board: Board, start: Hex) -> set[Hex]:
    """Get all hexes connected to start via land."""
    visited = set()
    to_visit = [start]

    while to_visit:
        current = to_visit.pop()
        if current in visited:
            continue
        if current.terrain == Terrain.SEA:
            continue
        visited.add(current)
        for neighbor in board.neighbors(current):
            if neighbor not in visited and neighbor.terrain != Terrain.SEA:
                to_visit.append(neighbor)

    return visited


def generate_map(config: MapGenConfig) -> Board:
    """Generate a procedural island map."""
    seed = config.seed if config.seed is not None else random.randint(0, 999999)
    random.seed(seed)

    noise = PerlinNoise(seed)
    board = Board(width=config.width, height=config.height)

    # Phase 1: Generate terrain with Perlin noise
    for h in board:
        # Get noise value
        nx = h.q * config.noise_scale
        ny = h.r * config.noise_scale
        noise_val = noise.octave_noise(nx, ny, config.octaves)

        # Apply island falloff (edges become sea)
        dist = _distance_to_center(h.q, h.r, config.width, config.height)
        falloff = 1 - (dist * config.island_falloff) ** 2

        # Combine noise and falloff
        terrain_val = (noise_val + 1) / 2 * falloff  # Normalize to 0-1

        if terrain_val < config.land_threshold:
            h.terrain = Terrain.SEA
        else:
            h.terrain = Terrain.LAND

    # Phase 2: Ensure single connected landmass
    land_hexes = [h for h in board if h.terrain == Terrain.LAND]
    if land_hexes:
        # Find largest connected component
        largest_component = set()
        visited_all = set()

        for h in land_hexes:
            if h not in visited_all:
                component = _get_connected_component(board, h)
                visited_all.update(component)
                if len(component) > len(largest_component):
                    largest_component = component

        # Remove disconnected land
        for h in land_hexes:
            if h not in largest_component:
                h.terrain = Terrain.SEA

    # Phase 3: Smooth coastline (cellular automata pass)
    for _ in range(2):
        changes = []
        for h in board:
            land_neighbors = sum(1 for n in board.neighbors(h) if n.terrain == Terrain.LAND)
            sea_neighbors = sum(1 for n in board.neighbors(h) if n.terrain == Terrain.SEA)

            # Fill small bays (sea surrounded by land)
            if h.terrain == Terrain.SEA and land_neighbors >= 5:
                changes.append((h, Terrain.LAND))
            # Erode peninsulas (land surrounded by sea)
            elif h.terrain == Terrain.LAND and sea_neighbors >= 5:
                changes.append((h, Terrain.SEA))

        for h, terrain in changes:
            h.terrain = terrain

    # Phase 4: Create small territories (1-3 hexes, Slay-style)
    # Territories of same player must NOT be adjacent (to stay separate)
    land_hexes = [h for h in board if h.terrain == Terrain.LAND]
    if not land_hexes:
        return board

    random.shuffle(land_hexes)
    unclaimed = set(land_hexes)
    player_idx = 0

    def is_adjacent_to_same_player(hex, player_id):
        """Check if hex is adjacent to any hex owned by player_id."""
        for n in board.neighbors(hex):
            if n.owner == player_id:
                return True
        return False

    # Create territories by picking seeds and growing them 0-2 hexes
    while unclaimed:
        # Pick a seed that is NOT adjacent to same player's territory
        candidates = [h for h in unclaimed if not is_adjacent_to_same_player(h, player_idx)]
        if not candidates:
            # No valid seed for this player, try next player
            player_idx = (player_idx + 1) % config.num_players
            # Check if any player can still place
            any_valid = False
            for p in range(config.num_players):
                if any(not is_adjacent_to_same_player(h, p) for h in unclaimed):
                    any_valid = True
                    break
            if not any_valid:
                # Assign remaining hexes - prefer player with fewest adjacent hexes
                for h in list(unclaimed):
                    # Count adjacent hexes per player
                    adj_count = {p: 0 for p in range(config.num_players)}
                    for n in board.neighbors(h):
                        if n.owner is not None:
                            adj_count[n.owner] += 1
                    # Pick player with most adjacent (to extend existing territory, not create new)
                    best_player = max(adj_count.keys(), key=lambda p: adj_count[p])
                    h.owner = best_player
                    unclaimed.remove(h)
                break
            continue

        seed = random.choice(candidates)
        unclaimed.remove(seed)
        seed.owner = player_idx
        territory = [seed]

        # Grow territory by 0-2 additional hexes (total size 1-3)
        # Weight towards smaller: 40% size 1, 40% size 2, 20% size 3
        target_size = random.choices([1, 2, 3], weights=[40, 40, 20])[0]

        while len(territory) < target_size:
            # Find unclaimed neighbors (not adjacent to other territories of same player)
            frontier = []
            for h in territory:
                for neighbor in board.neighbors(h):
                    if neighbor in unclaimed:
                        # Check neighbor's other neighbors aren't same player
                        other_neighbors = [n for n in board.neighbors(neighbor) if n not in territory]
                        if not any(n.owner == player_idx for n in other_neighbors):
                            frontier.append(neighbor)
            if not frontier:
                break
            # Add one neighbor
            new_hex = random.choice(frontier)
            unclaimed.remove(new_hex)
            new_hex.owner = player_idx
            territory.append(new_hex)

        player_idx = (player_idx + 1) % config.num_players

    # Phase 6: Add trees on owned territory
    # Trees stay owned but generate no income (Slay rules)
    owned_hexes = [h for h in land_hexes if h.owner is not None and h.unit is None]
    num_trees = int(len(owned_hexes) * config.tree_density)
    for h in random.sample(owned_hexes, min(num_trees, len(owned_hexes))):
        h.terrain = Terrain.TREE
        # Keep owner - trees on owned land stay owned

    return board
