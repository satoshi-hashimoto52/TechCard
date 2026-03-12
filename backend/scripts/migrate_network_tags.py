import re
import sqlite3
from pathlib import Path

GROUP_TAG_NAMES = ["HITACHI", "YOKOGAWA"]
YEAR_RE = re.compile(r"(19|20)\d{2}")


def _parse_year(name: str) -> int | None:
    if not name:
        return None
    match = YEAR_RE.search(name)
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS company_groups (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE,
            description TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS company_tech_tags (
            company_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (company_id, tag_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE,
            start_date DATE,
            end_date DATE,
            location TEXT,
            year INTEGER
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS event_contacts (
            event_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            PRIMARY KEY (event_id, contact_id)
        )
        """
    )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(companies)").fetchall()}
    if "group_id" not in columns:
        conn.execute("ALTER TABLE companies ADD COLUMN group_id INTEGER")


def _fetch_tags(conn: sqlite3.Connection):
    rows = conn.execute("SELECT id, name, type FROM tags").fetchall()
    tags = [{"id": row[0], "name": row[1], "type": row[2]} for row in rows]
    by_id = {row["id"]: row for row in tags}
    by_name = {row["name"].lower(): row for row in tags if row["name"]}
    return tags, by_id, by_name


def _migrate_tech_tags(conn: sqlite3.Connection, tags_by_id: dict[int, dict]) -> None:
    tech_tag_ids = {
        tag_id
        for tag_id, tag in tags_by_id.items()
        if (tag.get("type") in (None, "", "tech", "technology"))
    }
    if not tech_tag_ids:
        print("No tech tags found for migration.")
        return

    tech_ids_tuple = tuple(tech_tag_ids)
    rows = conn.execute(
        """
        SELECT contact_tags.contact_id, contact_tags.tag_id, contacts.company_id
        FROM contact_tags
        JOIN contacts ON contacts.id = contact_tags.contact_id
        WHERE contact_tags.tag_id IN ({})
        """.format(",".join(["?"] * len(tech_ids_tuple))),
        tech_ids_tuple,
    ).fetchall()
    inserted = 0
    skipped = 0
    for contact_id, tag_id, company_id in rows:
        if company_id is None:
            skipped += 1
            continue
        conn.execute(
            "INSERT OR IGNORE INTO company_tech_tags (company_id, tag_id) VALUES (?, ?)",
            (company_id, tag_id),
        )
        inserted += 1

    conn.execute(
        "DELETE FROM contact_tags WHERE tag_id IN ({})".format(",".join(["?"] * len(tech_ids_tuple))),
        tech_ids_tuple,
    )
    print(f"Tech tags migrated: {inserted}, skipped(no company): {skipped}")


def _migrate_event_tags(conn: sqlite3.Connection, tags_by_id: dict[int, dict]) -> None:
    event_tag_ids = {tag_id for tag_id, tag in tags_by_id.items() if tag.get("type") == "event"}
    if not event_tag_ids:
        print("No event tags found for migration.")
        return

    event_id_by_tag: dict[int, int] = {}
    for tag_id in event_tag_ids:
        tag = tags_by_id[tag_id]
        name = (tag.get("name") or "").strip()
        if not name:
            continue
        row = conn.execute("SELECT id FROM events WHERE name = ?", (name,)).fetchone()
        if row:
            event_id = row[0]
        else:
            year = _parse_year(name)
            conn.execute(
                "INSERT INTO events (name, year) VALUES (?, ?)",
                (name, year),
            )
            event_id = conn.execute("SELECT id FROM events WHERE name = ?", (name,)).fetchone()[0]
        event_id_by_tag[tag_id] = event_id

    rows = conn.execute(
        """
        SELECT contact_id, tag_id
        FROM contact_tags
        WHERE tag_id IN ({})
        """.format(",".join(["?"] * len(event_tag_ids))),
        tuple(event_tag_ids),
    ).fetchall()
    inserted = 0
    for contact_id, tag_id in rows:
        event_id = event_id_by_tag.get(tag_id)
        if not event_id:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO event_contacts (event_id, contact_id) VALUES (?, ?)",
            (event_id, contact_id),
        )
        inserted += 1

    conn.execute(
        "DELETE FROM contact_tags WHERE tag_id IN ({})".format(",".join(["?"] * len(event_tag_ids))),
        tuple(event_tag_ids),
    )
    print(f"Event tags migrated: {inserted}")


def _migrate_groups(conn: sqlite3.Connection, tags_by_name: dict[str, dict]) -> None:
    if not GROUP_TAG_NAMES:
        print("No group tag names configured.")
        return

    group_tag_ids = []
    for name in GROUP_TAG_NAMES:
        tag = tags_by_name.get(name.lower())
        if not tag:
            print(f"Group tag not found: {name}")
            continue
        group_tag_ids.append(tag["id"])

        row = conn.execute("SELECT id FROM company_groups WHERE name = ?", (name,)).fetchone()
        if row:
            group_id = row[0]
        else:
            conn.execute("INSERT INTO company_groups (name) VALUES (?)", (name,))
            group_id = conn.execute("SELECT id FROM company_groups WHERE name = ?", (name,)).fetchone()[0]

        contact_rows = conn.execute(
            """
            SELECT contacts.company_id
            FROM contact_tags
            JOIN contacts ON contacts.id = contact_tags.contact_id
            WHERE contact_tags.tag_id = ?
            """,
            (tag["id"],),
        ).fetchall()
        conflicts = 0
        assigned = 0
        for (company_id,) in contact_rows:
            if company_id is None:
                continue
            current = conn.execute(
                "SELECT group_id FROM companies WHERE id = ?",
                (company_id,),
            ).fetchone()
            if current and current[0] and current[0] != group_id:
                conflicts += 1
                continue
            conn.execute(
                "UPDATE companies SET group_id = ? WHERE id = ?",
                (group_id, company_id),
            )
            assigned += 1
        print(f"Group '{name}' assigned to companies: {assigned}, conflicts: {conflicts}")

    if group_tag_ids:
        conn.execute(
            "DELETE FROM contact_tags WHERE tag_id IN ({})".format(",".join(["?"] * len(group_tag_ids))),
            tuple(group_tag_ids),
        )


def main() -> None:
    db_path = Path(__file__).resolve().parents[1] / "techcard.db"
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        _ensure_tables(conn)
        tags, tags_by_id, tags_by_name = _fetch_tags(conn)
        if not tags:
            print("No tags found.")
            return
        _migrate_tech_tags(conn, tags_by_id)
        _migrate_event_tags(conn, tags_by_id)
        _migrate_groups(conn, tags_by_name)
        conn.commit()
        print("Migration completed.")


if __name__ == "__main__":
    main()
