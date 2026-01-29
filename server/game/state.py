from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
import json

from .board import Board, Hex, Terrain
from .player import Player
from .units import Unit, UnitType
from .rules import GameRules
from .mapgen import generate_map, MapGenConfig


@dataclass
class GameState:
    board: Board
    players: list[Player]
    current_player_idx: int = 0
    turn: int = 1
    rules: GameRules = field(init=False)
    actions_this_turn: list[dict] = field(default_factory=list)
    # Tree config (Slay-style)
    tree_growth_enabled: bool = True
    tree_spread_threshold: int = 2

    def __post_init__(self):
        self.rules = GameRules(self.board, self.players)
        # Initialize player regions
        for player in self.players:
            player.update_regions(self.board)
            # Starting gold: 5g per non-tree hex in territory
            for region in player.regions:
                non_tree_hexes = sum(1 for h in region.hexes if h.terrain != Terrain.TREE)
                region.gold = 5 * non_tree_hexes

    @property
    def current_player(self) -> Player:
        return self.players[self.current_player_idx]

    @classmethod
    def new_game(cls, width: int = 15, height: int = 15,
                 num_players: int = 4, seed: int | None = None) -> GameState:
        """Create a new game with procedural map."""
        config = MapGenConfig(
            width=width,
            height=height,
            num_players=num_players,
            seed=seed,
        )
        board = generate_map(config)
        players = [Player(id=i) for i in range(num_players)]
        return cls(board=board, players=players)

    def start_turn(self) -> dict:
        """Called at the start of a player's turn.

        Returns dict with:
        - castle_deaths: territories that died from missing castle
        - maintenance_deaths: territories that died from insufficient gold
        - isolated_deaths: units that died from being in isolated territories
        """
        # SLAY CASTLE RULES - Check ALL players at start of each turn
        castle_deaths = []
        maintenance_deaths = []
        isolated_deaths = []

        for p in self.players:
            if not p.eliminated:
                # 1. Check castle requirement (territories without castle die)
                castle_check = p.check_castle_requirement()
                if castle_check:
                    for death in castle_check:
                        castle_deaths.append({
                            "player": p.id,
                            "region_size": death["region_size"],
                            "hexes": death["hexes"],
                            "reason": "no_castle"
                        })

                # 2. Check territory maintenance (territories that can't afford it die)
                maintenance_check = p.check_territory_maintenance()
                if maintenance_check:
                    for death in maintenance_check:
                        maintenance_deaths.append({
                            "player": p.id,
                            "region_size": death["region_size"],
                            "hexes": death["hexes"],
                            "reason": "insufficient_gold",
                            "needed": death["needed"],
                            "had": death["had"]
                        })

                # 3. Kill isolated units (single hex territories without capital)
                deaths = p.kill_isolated_units()
                for h, unit_type in deaths:
                    isolated_deaths.append({
                        "player": p.id,
                        "hex": [h.q, h.r],
                        "unit": unit_type
                    })

        player = self.current_player
        # Tree growth happens at start of turn (Slay rules)
        if self.tree_growth_enabled:
            self._grow_trees(player.id)
        player.start_turn()
        self.rules.reset_units_for_turn(player.id)
        self.actions_this_turn = []

        return {
            "castle_deaths": castle_deaths,
            "maintenance_deaths": maintenance_deaths,
            "isolated_deaths": isolated_deaths
        }

    def _grow_trees(self, player_id: int) -> list[Hex]:
        """Grow trees in player's territory (Slay rules).

        1. All graves become trees (after one turn)
        2. Trees spread to adjacent empty hexes if they have enough tree neighbors.
        Capital hexes are protected from tree growth.
        Returns list of hexes where new trees grew.
        """
        new_trees = []
        player = self.rules.get_player(player_id)
        if not player:
            return new_trees

        territory = self.board.get_territory(player_id)

        # Get capital hexes (protected from trees) and clear existing trees/graves
        capital_hexes = set()
        for region in player.regions:
            cap = region.capital_hex
            if cap:
                capital_hexes.add((cap.q, cap.r))
                # Clear tree/grave from capital so player can always buy there
                if cap.terrain in (Terrain.TREE, Terrain.GRAVE):
                    cap.terrain = Terrain.LAND

        # First: all graves become trees (except capitals)
        for h in territory:
            if h.terrain == Terrain.GRAVE and (h.q, h.r) not in capital_hexes:
                h.terrain = Terrain.TREE
                new_trees.append(h)

        # Second: tree spread to empty land hexes with enough tree neighbors (except capitals)
        # Pine trees (interior): need 2+ tree neighbors
        # Palm trees (coastal): need 1+ tree neighbor on coast
        candidates = []
        for h in territory:
            if h.terrain == Terrain.LAND and h.unit is None and (h.q, h.r) not in capital_hexes:
                neighbors = self.board.neighbors(h)
                tree_neighbors = sum(1 for n in neighbors if n.terrain == Terrain.TREE)
                is_coastal = any(n.terrain == Terrain.SEA for n in neighbors)

                # Coastal hexes: palm trees spread with just 1 tree neighbor
                # Interior hexes: pine trees need 2+ tree neighbors
                threshold = 1 if is_coastal else self.tree_spread_threshold

                if tree_neighbors >= threshold:
                    candidates.append(h)

        for h in candidates:
            h.terrain = Terrain.TREE
            new_trees.append(h)

        # Update regions if trees grew (affects income)
        if new_trees:
            player.update_regions(self.board)

        return new_trees

    def end_turn(self) -> dict:
        """Called at the end of a player's turn."""
        player = self.current_player
        starved = player.end_turn()

        result = {
            "success": True,
            "starved_units": len(starved),
            "starved_hexes": [(h.q, h.r) for h in starved]
        }

        # Check for eliminated players
        for p in self.players:
            p.check_eliminated(self.board)

        # Move to next active player
        self._advance_to_next_player()

        # Check victory
        winner = self.rules.check_victory()
        if winner is not None:
            result["winner"] = winner

        return result

    def _advance_to_next_player(self):
        """Advance to the next non-eliminated player.

        Note: Does NOT call start_turn() - the orchestrator handles that
        when run_current_turn() is called for the next player.
        """
        active = [p for p in self.players if not p.eliminated]
        if len(active) <= 1:
            return

        start_idx = self.current_player_idx
        while True:
            self.current_player_idx = (self.current_player_idx + 1) % len(self.players)
            if self.current_player_idx == 0:
                self.turn += 1
            if not self.players[self.current_player_idx].eliminated:
                break
            if self.current_player_idx == start_idx:
                break  # All players eliminated (shouldn't happen)

    def move_unit(self, from_q: int, from_r: int, to_q: int, to_r: int) -> dict:
        """Move a unit."""
        result = self.rules.execute_move(
            self.current_player.id, from_q, from_r, to_q, to_r
        )
        action = {
            "type": "move",
            "from": [from_q, from_r],
            "to": [to_q, to_r],
            "success": result.success,
            "message": result.message,
        }
        if result.killed_unit:
            action["killed"] = result.killed_unit.type.value
        if result.merged_into:
            action["merged_into"] = result.merged_into.type.value
        if result.conquered_hex:
            action["conquered"] = True

        self.actions_this_turn.append(action)
        return action

    def buy_unit(self, unit_type: str, target_q: int, target_r: int) -> dict:
        """Buy a unit."""
        try:
            utype = UnitType(unit_type)
        except ValueError:
            return {"success": False, "message": f"Invalid unit type: {unit_type}"}

        result = self.rules.execute_buy(
            self.current_player.id, utype, target_q, target_r
        )
        action = {
            "type": "buy",
            "unit_type": unit_type,
            "position": [target_q, target_r],
            "success": result.success,
            "message": result.message,
        }
        self.actions_this_turn.append(action)
        return action

    def to_dict(self) -> dict:
        """Serialize game state to JSON-compatible dict."""
        board_dict = self.board.to_dict()

        # Add capital info to hexes based on regions
        capital_hexes = set()
        for player in self.players:
            for region in player.regions:
                capital = region.capital_hex
                if capital:
                    capital_hexes.add((capital.q, capital.r))

        for key, hex_data in board_dict["hexes"].items():
            q, r = map(int, key.split(","))
            hex_data["has_capital"] = (q, r) in capital_hexes

        return {
            "turn": self.turn,
            "current_player": self.current_player_idx,
            "board": board_dict,
            "players": [p.to_dict() for p in self.players],
            "actions_this_turn": self.actions_this_turn,
            "tree_growth_enabled": self.tree_growth_enabled,
            "tree_spread_threshold": self.tree_spread_threshold,
        }

    def to_prompt(self) -> str:
        """Generate a text prompt describing the game state for Claude."""
        lines = []
        lines.append(f"=== SLAY GAME STATE ===")
        lines.append(f"Turn: {self.turn}")
        lines.append(f"Current Player: {self.current_player.color_name} (Player {self.current_player.id})")
        lines.append("")

        # Player summaries
        lines.append("PLAYERS:")
        for p in self.players:
            status = "ELIMINATED" if p.eliminated else "Active"
            lines.append(f"  {p.color_name} (P{p.id}): {status}")
            if not p.eliminated:
                lines.append(f"    Territory: {p.get_total_territory()} hexes")
                lines.append(f"    Units: {p.get_total_units()}")
                lines.append(f"    Total Gold: {p.get_total_gold()}")
                for i, region in enumerate(p.regions):
                    lines.append(f"    Region {i+1}: {len(region.hexes)} hexes, "
                               f"{region.gold}g, income {region.income}, "
                               f"upkeep {region.get_upkeep()}, "
                               f"{'HAS CAPITAL' if region.has_capital else 'no capital'}")
        lines.append("")

        # Current player's options
        player = self.current_player
        lines.append(f"YOUR OPTIONS ({player.color_name}):")

        # Available moves - prioritize offensive moves
        moves = self.rules.get_valid_moves(player.id)
        if moves:
            # Separate into offensive and other moves
            offensive_moves = []
            neutral_moves = []
            internal_moves = []
            for from_h, to_h in moves:
                if to_h.owner is not None and to_h.owner != player.id:
                    offensive_moves.append((from_h, to_h))
                elif to_h.owner is None:
                    neutral_moves.append((from_h, to_h))
                else:
                    internal_moves.append((from_h, to_h))

            if offensive_moves:
                lines.append(f"  ATTACK OPPORTUNITIES ({len(offensive_moves)}):")
                for from_h, to_h in offensive_moves:
                    unit_info = f"{from_h.unit.type.value}" if from_h.unit else "?"
                    enemy = self.players[to_h.owner].color_name
                    if to_h.unit:
                        lines.append(f"    {unit_info} ({from_h.q},{from_h.r}) → ({to_h.q},{to_h.r}) ATTACK {enemy} {to_h.unit.type.value}")
                    else:
                        lines.append(f"    {unit_info} ({from_h.q},{from_h.r}) → ({to_h.q},{to_h.r}) CONQUER {enemy} empty hex")


            if internal_moves and not offensive_moves:
                lines.append(f"  Internal moves ({len(internal_moves)} available)")
        else:
            lines.append("  No available moves (all units moved or none)")

        # Show attack-by-purchase opportunities
        attack_purchases = self.rules.get_valid_purchases(player.id)
        attack_buys = [(ut, h, gold, is_atk) for ut, h, gold, is_atk in attack_purchases if is_atk]
        if attack_buys:
            # Group by target hex to avoid duplicates
            seen = set()
            lines.append(f"  ATTACK BY PURCHASE (buy unit directly on enemy hex):")
            for ut, h, gold, _ in attack_buys:
                key = (h.q, h.r)
                if key in seen:
                    continue
                seen.add(key)
                defense = self.rules.get_defense_strength(h)
                enemy = self.players[h.owner].color_name if h.owner is not None else "neutral"
                lines.append(f"    ({h.q},{h.r}) {enemy} defense={defense} - need strength>{defense}")
            lines.append("    Units: peasant(str1,10g) spearman(str2,20g) knight(str3,30g) baron(str4,40g)")

        # Just remind available unit types
        lines.append("  Buy units on your territory OR on adjacent enemy hexes to conquer.")

        lines.append("")
        lines.append("MAP OVERVIEW:")
        lines.append(self.board.to_ascii())

        return "\n".join(lines)

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_snapshot(cls, snapshot) -> GameState:
        """Reconstruct GameState from a snapshot."""
        from .history.snapshot import StateSnapshot

        board = Board.from_dict(snapshot.board_data)
        players = [Player.from_dict(pd, board) for pd in snapshot.players_data]

        # Create without calling __post_init__ (which resets gold)
        state = object.__new__(cls)
        state.board = board
        state.players = players
        state.current_player_idx = snapshot.current_player_idx
        state.turn = snapshot.turn
        state.rules = GameRules(board, players)
        state.actions_this_turn = []
        state.tree_growth_enabled = True
        state.tree_spread_threshold = 2

        return state

    @classmethod
    def from_dict(cls, data: dict) -> GameState:
        """Reconstruct GameState from dict (for loading from DB)."""
        board = Board.from_dict(data["board"])
        players = [Player.from_dict(pd, board) for pd in data["players"]]

        state = object.__new__(cls)
        state.board = board
        state.players = players
        state.current_player_idx = data["current_player"]
        state.turn = data["turn"]
        state.rules = GameRules(board, players)
        state.actions_this_turn = []
        state.tree_growth_enabled = data.get("tree_growth_enabled", True)
        state.tree_spread_threshold = data.get("tree_spread_threshold", 2)

        return state
