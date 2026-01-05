"""Classic heuristic-based AI for Slay."""
from __future__ import annotations
from dataclasses import dataclass
from typing import TYPE_CHECKING
import random

from ..units import UnitType, UNIT_STATS

if TYPE_CHECKING:
    from ..state import GameState
    from ..board import Hex
    from ..player import Player, Region


@dataclass
class ScoredMove:
    """A move with its heuristic score."""
    from_hex: Hex
    to_hex: Hex
    score: float
    reason: str


@dataclass
class ScoredPurchase:
    """A purchase with its heuristic score."""
    unit_type: UnitType
    target_hex: Hex
    score: float
    reason: str
    is_attack: bool


class ClassicAI:
    """Heuristic-based AI that plays Slay using strategic rules."""

    def __init__(self, player_id: int, difficulty: str = "normal"):
        self.player_id = player_id
        self.difficulty = difficulty
        self.randomness = {"easy": 0.3, "normal": 0.1, "hard": 0.0}.get(difficulty, 0.1)

    def play_turn(self, state: GameState) -> list[dict]:
        """Play a complete turn, returning list of actions taken."""
        actions = []

        # Phase 1: Execute attacks with existing units
        actions.extend(self._execute_attacks(state))

        # Phase 2: Buy units (prioritize attack purchases, then defense)
        actions.extend(self._execute_purchases(state))

        # Phase 3: Reposition units internally
        actions.extend(self._execute_repositioning(state))

        return actions

    def _execute_attacks(self, state: GameState) -> list[dict]:
        """Execute attack moves with existing units."""
        actions = []
        for _ in range(50):
            scored_moves = self._score_moves(state)
            attack_moves = [m for m in scored_moves
                           if m.to_hex.owner != self.player_id and m.score > 0]

            if not attack_moves:
                break

            move = self._pick_best(attack_moves)
            if not move:
                break

            result = state.move_unit(
                move.from_hex.q, move.from_hex.r,
                move.to_hex.q, move.to_hex.r
            )
            if result["success"]:
                actions.append(result)
            else:
                break

        return actions

    def _execute_purchases(self, state: GameState) -> list[dict]:
        """Buy units strategically."""
        actions = []
        for _ in range(20):
            scored_purchases = self._score_purchases(state)
            if not scored_purchases:
                break

            purchase = self._pick_best(scored_purchases)
            if not purchase or purchase.score <= 0:
                break

            result = state.buy_unit(
                purchase.unit_type.value,
                purchase.target_hex.q,
                purchase.target_hex.r
            )
            if result["success"]:
                actions.append(result)
            else:
                break

        return actions

    def _execute_repositioning(self, state: GameState) -> list[dict]:
        """Move units internally to better positions."""
        actions = []
        for _ in range(30):
            scored_moves = self._score_moves(state)
            internal_moves = [m for m in scored_moves
                             if m.to_hex.owner == self.player_id and m.score > 0]

            if not internal_moves:
                break

            move = self._pick_best(internal_moves)
            if not move:
                break

            result = state.move_unit(
                move.from_hex.q, move.from_hex.r,
                move.to_hex.q, move.to_hex.r
            )
            if result["success"]:
                actions.append(result)
            else:
                break

        return actions

    def _score_moves(self, state: GameState) -> list[ScoredMove]:
        """Score all valid moves."""
        rules = state.rules
        player = rules.get_player(self.player_id)
        valid_moves = rules.get_valid_moves(self.player_id)

        scored = []
        for from_hex, to_hex in valid_moves:
            score, reason = self._evaluate_move(state, from_hex, to_hex, player)
            scored.append(ScoredMove(from_hex, to_hex, score, reason))

        return sorted(scored, key=lambda m: -m.score)

    def _evaluate_move(self, state: GameState, from_hex: Hex, to_hex: Hex,
                       player: Player) -> tuple[float, str]:
        """Evaluate a single move."""
        unit = from_hex.unit
        score = 0.0
        reasons = []

        # Attack enemy territory
        if to_hex.owner is not None and to_hex.owner != self.player_id:
            score += 10.0
            reasons.append("attack")

            if to_hex.unit:
                score += to_hex.unit.strength * 5
                reasons.append(f"kill_{to_hex.unit.type.value}")

            enemy = state.rules.get_player(to_hex.owner)
            if enemy:
                split_bonus = self._estimate_split_value(state, to_hex, enemy)
                score += split_bonus
                if split_bonus > 0:
                    reasons.append("split_territory")

                for region in enemy.regions:
                    capital = region.capital_hex
                    if capital and to_hex.distance_to(capital) < from_hex.distance_to(capital):
                        score += 3.0
                        reasons.append("towards_capital")
                        break

        # Capture neutral
        elif to_hex.owner is None:
            if to_hex.terrain.value == "tree" and unit.type == UnitType.PEASANT:
                score += 2.0
                reasons.append("chop_tree")
            else:
                score += 1.0
                reasons.append("expand")

        # Internal movement (own territory)
        else:
            # Chop trees in own territory to increase income
            if to_hex.terrain.value == "tree":
                # Find region to check income situation
                region = self._find_region_for_hex(state, to_hex, state.rules.get_player(self.player_id), False)
                if region:
                    # High priority if income <= upkeep (need more income)
                    if region.income <= region.get_upkeep():
                        score += 5.0
                        reasons.append("chop_tree_urgent")
                    else:
                        score += 2.0
                        reasons.append("chop_tree")

            elif to_hex.unit and unit.can_merge_with(to_hex.unit):
                merged_upkeep = UNIT_STATS[self._get_upgrade(unit.type)]["upkeep"]
                old_upkeep = unit.upkeep + to_hex.unit.upkeep

                if merged_upkeep < old_upkeep:
                    score += 2.0
                    reasons.append("merge_save_upkeep")
                elif self._is_frontier(state, to_hex):
                    score += 1.5
                    reasons.append("merge_on_frontier")

            elif self._is_frontier(state, to_hex) and not self._is_frontier(state, from_hex):
                score += 1.0
                reasons.append("move_to_frontier")

            elif self._count_friendly_units_nearby(state, from_hex) > 2:
                if self._count_friendly_units_nearby(state, to_hex) < 2:
                    score += 0.5
                    reasons.append("spread_out")

        return score, "+".join(reasons) if reasons else "none"

    def _score_purchases(self, state: GameState) -> list[ScoredPurchase]:
        """Score all valid purchases."""
        rules = state.rules
        player = rules.get_player(self.player_id)
        valid_purchases = rules.get_valid_purchases(self.player_id)

        scored = []
        for unit_type, target_hex, region_gold, is_attack in valid_purchases:
            score, reason = self._evaluate_purchase(
                state, unit_type, target_hex, region_gold, is_attack, player
            )
            scored.append(ScoredPurchase(unit_type, target_hex, score, reason, is_attack))

        return sorted(scored, key=lambda p: -p.score)

    def _evaluate_purchase(self, state: GameState, unit_type: UnitType,
                          target_hex: Hex, region_gold: int, is_attack: bool,
                          player: Player) -> tuple[float, str]:
        """Evaluate a purchase."""
        cost = UNIT_STATS[unit_type]["cost"]
        upkeep = UNIT_STATS[unit_type]["upkeep"]
        strength = UNIT_STATS[unit_type]["strength"]

        score = 0.0
        reasons = []

        region = self._find_region_for_hex(state, target_hex, player, is_attack)
        if not region:
            return -100, "no_region"

        # Check economic sustainability
        future_income = region.income + (1 if is_attack else 0)
        future_upkeep = region.get_upkeep() + upkeep
        gold_after = region_gold - cost

        # Count trees in region - unit can chop trees to increase income
        trees_in_region = sum(1 for h in region.hexes if h.terrain.value == "tree")
        potential_income = future_income + min(trees_in_region, 1)  # Can chop at least 1 tree

        if gold_after + potential_income < future_upkeep:
            turns_until_starve = gold_after / max(1, future_upkeep - potential_income)
            if turns_until_starve < 2:
                return -50, "would_starve"

        # Attack purchases are high priority
        if is_attack:
            score += 15.0
            reasons.append("attack_purchase")

            if target_hex.unit:
                score += target_hex.unit.strength * 4
                reasons.append(f"kill_{target_hex.unit.type.value}")

            defense = state.rules.get_defense_strength(target_hex)
            overkill = strength - defense - 1
            if overkill == 0:
                score += 3.0
                reasons.append("efficient")
            elif overkill > 0:
                score -= overkill * 2

        # Defensive purchases on frontier
        elif self._is_frontier(state, target_hex):
            score += 5.0
            reasons.append("frontier_defense")

            if unit_type == UnitType.CASTLE:
                score += 5.0
                reasons.append("castle_defense")

            threat = self._assess_threat(state, target_hex)
            score += threat * 2
            if threat > 0:
                reasons.append(f"threat_{threat}")

        else:
            score += 1.0
            reasons.append("interior")

            if unit_type == UnitType.PEASANT:
                for neighbor in state.board.neighbors(target_hex):
                    if neighbor.terrain.value == "tree":
                        score += 2.0
                        reasons.append("near_tree")
                        break

        if region_gold > cost * 2:
            score += 2.0
            reasons.append("can_afford")

        if unit_type == UnitType.PEASANT and state.turn < 10:
            score += 2.0
            reasons.append("early_game")

        return score, "+".join(reasons) if reasons else "none"

    def _pick_best(self, items: list) -> any:
        """Pick the best item, with some randomness based on difficulty."""
        if not items:
            return None

        if self.randomness == 0:
            return items[0]

        top_n = min(3, len(items))
        weights = [1.0 - i * self.randomness for i in range(top_n)]
        return random.choices(items[:top_n], weights=weights)[0]

    def _is_frontier(self, state: GameState, h: Hex) -> bool:
        """Check if hex is on the frontier."""
        for neighbor in state.board.neighbors(h):
            if neighbor.owner != self.player_id:
                return True
        return False

    def _estimate_split_value(self, state: GameState, target: Hex, enemy: Player) -> float:
        """Estimate value of conquering this hex for splitting enemy territory."""
        enemy_neighbors = sum(1 for n in state.board.neighbors(target)
                             if n.owner == enemy.id)
        if enemy_neighbors >= 3:
            return 5.0
        elif enemy_neighbors >= 2:
            return 2.0
        return 0.0

    def _count_friendly_units_nearby(self, state: GameState, h: Hex) -> int:
        """Count friendly units in adjacent hexes."""
        return sum(1 for n in state.board.neighbors(h)
                   if n.owner == self.player_id and n.unit)

    def _assess_threat(self, state: GameState, h: Hex) -> int:
        """Assess enemy threat level to a hex."""
        max_threat = 0
        for neighbor in state.board.neighbors(h):
            if neighbor.owner is not None and neighbor.owner != self.player_id:
                if neighbor.unit:
                    max_threat = max(max_threat, neighbor.unit.strength)
        return max_threat

    def _find_region_for_hex(self, state: GameState, target: Hex,
                            player: Player, is_attack: bool) -> Region | None:
        """Find which region would contain this hex."""
        if is_attack:
            for neighbor in state.board.neighbors(target):
                if neighbor.owner == self.player_id:
                    for region in player.regions:
                        if neighbor in region.hexes:
                            return region
        else:
            for region in player.regions:
                if target in region.hexes:
                    return region
        return None

    def _get_upgrade(self, unit_type: UnitType) -> UnitType:
        """Get the upgrade for a unit type."""
        upgrades = {
            UnitType.PEASANT: UnitType.SPEARMAN,
            UnitType.SPEARMAN: UnitType.KNIGHT,
            UnitType.KNIGHT: UnitType.BARON,
        }
        return upgrades.get(unit_type, UnitType.BARON)
