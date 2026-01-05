"""SQLite database for game persistence."""
import sqlite3
import json
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent.parent.parent / "data" / "yals.db"


def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database schema."""
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            turn INTEGER NOT NULL,
            config_json TEXT NOT NULL,
            state_json TEXT NOT NULL,
            history_json TEXT
        )
    """)
    conn.commit()
    conn.close()


def save_game(orchestrator, game_id: int | None = None) -> int:
    """Save current game state. Returns game ID."""
    if not orchestrator or not orchestrator.game_state:
        return None

    conn = get_connection()
    now = datetime.now().isoformat()

    data = orchestrator.to_dict()
    config_json = json.dumps(data["config"])
    state_json = json.dumps(data["game_state"])
    history_json = json.dumps(data["history"]) if data["history"] else None

    if game_id:
        # Update existing game
        conn.execute("""
            UPDATE games SET updated_at=?, turn=?, config_json=?, state_json=?, history_json=?
            WHERE id=?
        """, (now, orchestrator.game_state.turn, config_json, state_json, history_json, game_id))
    else:
        # Insert new game
        cursor = conn.execute("""
            INSERT INTO games (created_at, updated_at, turn, config_json, state_json, history_json)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (now, now, orchestrator.game_state.turn, config_json, state_json, history_json))
        game_id = cursor.lastrowid

    conn.commit()
    conn.close()
    return game_id


def load_last_game() -> dict | None:
    """Load most recent game. Returns dict with config, state, history or None."""
    conn = get_connection()
    cursor = conn.execute("""
        SELECT config_json, state_json, history_json FROM games
        ORDER BY updated_at DESC LIMIT 1
    """)
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return {
        "config": json.loads(row["config_json"]),
        "state": json.loads(row["state_json"]),
        "history": json.loads(row["history_json"]) if row["history_json"] else None,
    }


def new_game_slot():
    """Create a new game slot (for starting fresh)."""
    conn = get_connection()
    # Insert a new row instead of deleting all
    conn.commit()
    conn.close()


def list_games(limit: int = 10) -> list[dict]:
    """List recent games."""
    conn = get_connection()
    cursor = conn.execute("""
        SELECT id, created_at, updated_at, turn,
               json_extract(config_json, '$.players') as players_json,
               json_extract(state_json, '$.board') as board_json
        FROM games
        ORDER BY updated_at DESC
        LIMIT ?
    """, (limit,))

    games = []
    for row in cursor:
        players = json.loads(row["players_json"]) if row["players_json"] else []
        games.append({
            "id": row["id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "turn": row["turn"],
            "player_count": len(players),
            "board": json.loads(row["board_json"]) if row["board_json"] else None,
        })

    conn.close()
    return games


def load_game_by_id(game_id: int) -> dict | None:
    """Load a specific game by ID."""
    conn = get_connection()
    cursor = conn.execute("""
        SELECT config_json, state_json, history_json FROM games WHERE id = ?
    """, (game_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    return {
        "config": json.loads(row["config_json"]),
        "state": json.loads(row["state_json"]),
        "history": json.loads(row["history_json"]) if row["history_json"] else None,
    }


# Initialize on import
init_db()
