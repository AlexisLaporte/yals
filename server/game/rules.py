from __future__ import annotations
from dataclasses import dataclass
from typing import TYPE_CHECKING

from .units import Unit, UnitType, UNIT_STATS

if TYPE_CHECKING:
    from .board import Board, Hex
    from .player import Player


@dataclass
class MoveResult:
    success: bool
    message: str
    killed_unit: Unit | None = None
    merged_into: Unit | None = None
    conquered_hex: bool = False


@dataclass
class BuyResult:
    success: bool
    message: str
    unit: Unit | None = None


class GameRules:
    """Validates and executes game actions."""

    def __init__(self, board: Board, players: list[Player]):
        self.board = board
        self.players = players

    def get_player(self, player_id: int) -> Player | None:
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def get_region_for_hex(self, player: Player, h: Hex):
        """Find which region a hex belongs to."""
        for region in player.regions:
            if h in region.hexes:
                return region
        return None

    def get_defense_strength(self, target_hex: Hex) -> int:
        """Calculate defense strength of a hex.

        In Slay, a hex is defended by:
        - The unit on it (if any)
        - Adjacent units in the same territory
        - Adjacent capitals (strength 1)
        - Adjacent castles (strength 2)

        Returns the maximum defense strength.
        """
        if target_hex.owner is None:
            return 0

        max_defense = 0
        owner = target_hex.owner
        player = self.get_player(owner)

        # Unit on the hex itself
        if target_hex.unit:
            max_defense = max(max_defense, target_hex.unit.strength)

        # Capital on the hex itself (strength 1)
        if player:
            region = self.get_region_for_hex(player, target_hex)
            if region and region.capital_hex == target_hex:
                max_defense = max(max_defense, 1)

        # Check adjacent hexes for defenders
        for neighbor in self.board.neighbors(target_hex):
            if neighbor.owner == owner:
                # Adjacent capital - only if neighbor IS the capital hex
                region = self.get_region_for_hex(player, neighbor) if player else None
                if region and region.capital_hex == neighbor:
                    max_defense = max(max_defense, 1)

                # Adjacent unit
                if neighbor.unit and neighbor.unit.owner == owner:
                    max_defense = max(max_defense, neighbor.unit.strength)

        return max_defense

    def can_move(self, player_id: int, from_hex: Hex, to_hex: Hex) -> tuple[bool, str]:
        """Check if a move is valid.

        In Slay:
        - Units can move unlimited times within their own territory
        - Units can make only ONE attack per turn (onto enemy hex or chop tree)
        - Castles cannot move at all
        - Must beat the defense strength (includes adjacent defenders)
        """
        if from_hex.unit is None:
            return False, "No unit on source hex"

        if from_hex.unit.owner != player_id:
            return False, "Unit does not belong to player"

        # Castles cannot move
        if not from_hex.unit.is_mobile:
            return False, "Castles cannot move"

        # Check adjacency
        if to_hex not in self.board.neighbors(from_hex):
            return False, "Target hex is not adjacent"

        # Check terrain
        if to_hex.terrain.value == "sea":
            return False, "Cannot move to sea"

        # Tree/grave clearing in own territory - any unit can do it (Slay rules)
        # Counts as action (one per turn)
        if to_hex.terrain.value in ("tree", "grave") and to_hex.owner == player_id:
            if from_hex.unit.has_moved:
                return False, "Unit already acted this turn"
            return True, "OK"

        # Moving within own territory - unlimited moves allowed
        if to_hex.owner == player_id:
            # Can merge with same type unit
            if to_hex.unit:
                if from_hex.unit.can_merge_with(to_hex.unit):
                    return True, "OK"
                return False, "Hex occupied (can merge same unit types)"
            return True, "OK"

        # Attack or neutral capture - only one per turn
        if from_hex.unit.has_moved:
            return False, "Unit already attacked this turn"

        # Trees on enemy territory - can attack (tree is chopped on conquest)

        # Graves on enemy territory - can attack (grave clears on capture)
        # No additional check needed - will be handled in execute_move

        # Attacking enemy territory - check defense strength
        if to_hex.owner is not None:
            defense = self.get_defense_strength(to_hex)
            if from_hex.unit.strength <= defense:
                return False, f"Defense too strong ({defense} >= {from_hex.unit.strength})"

        return True, "OK"

    def execute_move(self, player_id: int, from_q: int, from_r: int,
                     to_q: int, to_r: int) -> MoveResult:
        """Execute a move action."""
        from_hex = self.board.get(from_q, from_r)
        to_hex = self.board.get(to_q, to_r)

        if not from_hex or not to_hex:
            return MoveResult(False, "Invalid coordinates")

        can, reason = self.can_move(player_id, from_hex, to_hex)
        if not can:
            return MoveResult(False, reason)

        unit = from_hex.unit
        killed_unit = None
        merged_into = None
        conquered = False
        is_attack = (to_hex.owner != player_id)

        # Handle combat
        if to_hex.unit and to_hex.owner != player_id:
            killed_unit = to_hex.unit
            to_hex.unit = None

        # Handle merge with friendly unit
        if to_hex.unit and to_hex.owner == player_id:
            if unit.can_merge_with(to_hex.unit):
                merged_into = Unit.merge(unit, to_hex.unit)
                if merged_into:
                    to_hex.unit = merged_into
                    from_hex.unit = None
                    return MoveResult(True, f"Units merged into {merged_into.type.value}",
                                     merged_into=merged_into)
            else:
                return MoveResult(False, "Cannot merge units of different types")

        # Handle tree chopping / grave clearing
        if to_hex.terrain.value in ("tree", "grave"):
            to_hex.terrain = to_hex.terrain.__class__("land")  # Convert to land
            unit.has_moved = True  # Counts as attack action

        # Execute move
        from_hex.unit = None
        to_hex.unit = unit

        # Only mark as moved if it was an attack (not internal movement)
        if is_attack:
            unit.has_moved = True
            conquered = True
            old_owner = to_hex.owner
            to_hex.owner = player_id

            # Clear graves when capturing (Slay rules)
            if to_hex.terrain.value == "grave":
                to_hex.terrain = to_hex.terrain.__class__("land")

            # Recalculate regions for affected players
            player = self.get_player(player_id)
            if player:
                player.update_regions(self.board)
            if old_owner is not None:
                old_player = self.get_player(old_owner)
                if old_player:
                    old_player.update_regions(self.board)

        return MoveResult(True, "Move successful", killed_unit=killed_unit,
                         conquered_hex=conquered)

    def can_buy(self, player_id: int, unit_type: UnitType,
                target_hex: Hex) -> tuple[bool, str, any]:
        """Check if a unit can be purchased and placed.

        In Slay, you can place units:
        1. On your own empty territory
        2. On enemy hex adjacent to your territory (attack by purchase)

        Returns (can_buy, reason, paying_region)
        """
        player = self.get_player(player_id)
        if not player:
            return False, "Player not found", None

        # Can buy on trees (chops the tree on conquest)

        # Cannot place on graves in own territory (must clear first)
        # But CAN attack enemy territory with graves (grave clears on capture)
        if target_hex.terrain.value == "grave" and target_hex.owner == player_id:
            return False, "Clear the grave first", None

        if target_hex.terrain.value == "sea":
            return False, "Cannot place unit on sea", None

        new_unit_strength = UNIT_STATS[unit_type]["strength"]
        cost = UNIT_STATS[unit_type]["cost"]

        # Case 1: Placing on own territory
        if target_hex.owner == player_id:
            if target_hex.unit is not None:
                return False, "Hex already has a unit", None
            region = self.get_region_for_hex(player, target_hex)
            if not region:
                return False, "Hex not in any region", None
            if region.gold < cost:
                return False, f"Not enough gold ({region.gold} < {cost})", None
            return True, "OK", region

        # Case 2: Attack by purchase - place on enemy hex adjacent to our territory
        if target_hex.owner is not None and target_hex.owner != player_id:
            # Check defense strength (includes adjacent defenders)
            defense = self.get_defense_strength(target_hex)
            if new_unit_strength <= defense:
                return False, f"Defense too strong ({defense} >= {new_unit_strength})", None

            # Find adjacent friendly region to pay from
            paying_region = None
            for neighbor in self.board.neighbors(target_hex):
                if neighbor.owner == player_id:
                    region = self.get_region_for_hex(player, neighbor)
                    if region and region.gold >= cost:
                        paying_region = region
                        break

            if not paying_region:
                return False, "No adjacent region with enough gold", None

            return True, "OK", paying_region

        return False, "Invalid target", None

    def execute_buy(self, player_id: int, unit_type: UnitType,
                    target_q: int, target_r: int) -> BuyResult:
        """Execute a buy action (can be on own territory or attack enemy)."""
        target_hex = self.board.get(target_q, target_r)
        if not target_hex:
            return BuyResult(False, "Invalid coordinates")

        can, reason, paying_region = self.can_buy(player_id, unit_type, target_hex)
        if not can:
            return BuyResult(False, reason)

        player = self.get_player(player_id)
        cost = UNIT_STATS[unit_type]["cost"]
        paying_region.gold -= cost

        # Clear tree if buying on one (chop)
        if target_hex.terrain.value == "tree":
            target_hex.terrain = target_hex.terrain.__class__("land")

        # Kill enemy unit if present
        killed = None
        if target_hex.unit and target_hex.owner != player_id:
            killed = target_hex.unit

        # Conquer hex if enemy
        conquered = False
        old_owner = target_hex.owner
        if old_owner != player_id:
            conquered = True
            target_hex.owner = player_id

            # Clear graves when capturing (Slay rules)
            if target_hex.terrain.value == "grave":
                target_hex.terrain = target_hex.terrain.__class__("land")

            # Update regions
            player.update_regions(self.board)
            if old_owner is not None:
                old_player = self.get_player(old_owner)
                if old_player:
                    old_player.update_regions(self.board)

        # Place new unit
        unit = Unit(type=unit_type, owner=player_id, has_moved=True)
        target_hex.unit = unit

        msg = f"Purchased {unit_type.value}"
        if killed:
            msg += f", killed {killed.type.value}"
        if conquered:
            msg += ", conquered hex"

        return BuyResult(True, msg, unit=unit)

    def get_valid_moves(self, player_id: int) -> list[tuple[Hex, Hex]]:
        """Get all valid moves for a player."""
        moves = []
        territory = self.board.get_territory(player_id)

        for from_hex in territory:
            if from_hex.unit and from_hex.unit.owner == player_id and not from_hex.unit.has_moved:
                for to_hex in self.board.neighbors(from_hex):
                    can, _ = self.can_move(player_id, from_hex, to_hex)
                    if can:
                        moves.append((from_hex, to_hex))

        return moves

    def get_valid_purchases(self, player_id: int) -> list[tuple[UnitType, Hex, int, bool]]:
        """Get all valid purchases. Returns (unit_type, hex, region_gold, is_attack)."""
        purchases = []
        player = self.get_player(player_id)
        if not player:
            return purchases

        for unit_type in UnitType:
            cost = UNIT_STATS[unit_type]["cost"]
            strength = UNIT_STATS[unit_type]["strength"]

            # Own territory placements (including on trees - unit chops the tree)
            for region in player.regions:
                if region.gold >= cost:
                    for h in region.hexes:
                        if h.unit is None and h.terrain.value not in ("sea", "grave"):
                            purchases.append((unit_type, h, region.gold, False))

            # Attack purchases (place on enemy hex adjacent to our territory)
            for region in player.regions:
                if region.gold >= cost:
                    for h in region.hexes:
                        for neighbor in self.board.neighbors(h):
                            if (neighbor.owner is not None and
                                neighbor.owner != player_id and
                                neighbor.terrain.value != "sea"):
                                # Check defense strength (includes adjacent defenders)
                                defense = self.get_defense_strength(neighbor)
                                if strength > defense:
                                    purchases.append((unit_type, neighbor, region.gold, True))

        # Remove duplicates
        seen = set()
        unique = []
        for p in purchases:
            key = (p[0], p[1].q, p[1].r)
            if key not in seen:
                seen.add(key)
                unique.append(p)

        return unique

    def reset_units_for_turn(self, player_id: int):
        """Reset all units for a player at start of their turn."""
        for h in self.board.get_territory(player_id):
            if h.unit and h.unit.owner == player_id:
                h.unit.reset_for_turn()

    def check_victory(self) -> int | None:
        """Check if game is over. Returns winner player_id or None."""
        active_players = [p for p in self.players if not p.eliminated]
        if len(active_players) == 1:
            return active_players[0].id
        if len(active_players) == 0:
            return -1  # Draw (shouldn't happen)
        return None
