import sqlite3
from pathlib import Path


def main() -> None:
    db_path = Path(__file__).resolve().parents[1] / "techcard.db"
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(contacts)")
        columns = {row[1] for row in cursor.fetchall()}
        if "notes" in columns:
            print("notes column already exists. No changes made.")
            return
        cursor.execute("ALTER TABLE contacts ADD COLUMN notes TEXT")
        conn.commit()
        print("Added notes column to contacts table.")


if __name__ == "__main__":
    main()
