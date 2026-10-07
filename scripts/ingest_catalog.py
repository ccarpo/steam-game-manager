#!/usr/bin/env python3
"""
Parse the FronkonGames/Steam games.json catalog and import it into the Steam
Game Manager SQLite database.

Filters:
  - not already owned or wishlisted (appid NOT IN games.steam_appid)
  - has community tags
  - positive + negative reviews >= MIN_REVIEWS

Keeps only the fields needed for discovery and embedding so the DB stays small.
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

DEFAULT_MIN_REVIEWS = 100


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True, help="Path to games.db")
    p.add_argument("--catalog", required=True, help="Path to games.json")
    p.add_argument("--min-reviews", type=int, default=DEFAULT_MIN_REVIEWS)
    p.add_argument("--chunk", type=int, default=500, help="Commit every N inserts")
    return p.parse_args()


def owned_appids(conn: sqlite3.Connection):
    cur = conn.execute("SELECT DISTINCT steam_appid FROM games WHERE steam_appid IS NOT NULL")
    return {row[0] for row in cur}


def to_tag_list(tags):
    if isinstance(tags, dict):
        return [name for name, _ in sorted(tags.items(), key=lambda kv: kv[1] or 0, reverse=True)]
    if isinstance(tags, list):
        if tags and isinstance(tags[0], str):
            return tags
        return [t.get("name", "") for t in tags if isinstance(t, dict) and t.get("name")]
    return []


def to_string_list(val):
    if isinstance(val, list):
        return [str(x) for x in val]
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
        except Exception:
            return []
    return []


def build_embed_text(name, tags, genres, description):
    parts = []
    if tags:
        parts.append(", ".join(tags[:15]))
    if genres:
        parts.append(", ".join(genres))
    desc = (description or "").strip()[:300]
    if desc:
        parts.append(desc)
    if not parts:
        return name or ""
    return ". ".join(parts)


def text_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def import_catalog(args):
    if not os.path.exists(args.catalog):
        print(json.dumps({"type": "error", "message": f"Catalog not found: {args.catalog}"}))
        sys.exit(1)

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")

    # Ensure the table exists (idempotent)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS steam_catalog (
            appid INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            release_date TEXT,
            tags_json TEXT,
            genres_json TEXT,
            description TEXT,
            developers_json TEXT,
            publishers_json TEXT,
            positive INTEGER DEFAULT 0,
            negative INTEGER DEFAULT 0,
            total_reviews INTEGER DEFAULT 0,
            header_image TEXT,
            embed_text TEXT NOT NULL,
            text_hash TEXT NOT NULL,
            imported_at TEXT DEFAULT (datetime('now'))
        )
    """)

    owned = owned_appids(conn)
    existing = {row[0] for row in conn.execute("SELECT appid FROM steam_catalog")}

    print(json.dumps({"type": "status", "message": f"Loading {args.catalog}... {len(owned)} owned/wishlisted appids excluded"}))
    sys.stdout.flush()

    with open(args.catalog, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(json.dumps({"type": "status", "message": f"Catalog entries: {len(data):,}"}))
    sys.stdout.flush()

    sql = """
        INSERT INTO steam_catalog
            (appid, name, release_date, tags_json, genres_json, description, developers_json,
             publishers_json, positive, negative, total_reviews, header_image, embed_text, text_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(appid) DO UPDATE SET
            name=excluded.name,
            release_date=excluded.release_date,
            tags_json=excluded.tags_json,
            genres_json=excluded.genres_json,
            description=excluded.description,
            developers_json=excluded.developers_json,
            publishers_json=excluded.publishers_json,
            positive=excluded.positive,
            negative=excluded.negative,
            total_reviews=excluded.total_reviews,
            header_image=excluded.header_image,
            embed_text=excluded.embed_text,
            text_hash=excluded.text_hash,
            imported_at=datetime('now')
    """

    imported = 0
    skipped_owned = 0
    skipped_quality = 0
    failed = 0
    chunk = 0

    def flush():
        conn.commit()
        print(json.dumps({"type": "progress", "current": imported, "name": "importing"}))
        sys.stdout.flush()

    for raw_appid, entry in data.items():
        try:
            appid = int(raw_appid)
        except ValueError:
            continue
        if appid in owned:
            skipped_owned += 1
            continue
        tags = to_tag_list(entry.get("tags"))
        if not tags:
            continue
        positive = int(entry.get("positive") or 0)
        negative = int(entry.get("negative") or 0)
        total = positive + negative
        if total < args.min_reviews:
            skipped_quality += 1
            continue

        genres = to_string_list(entry.get("genres"))
        description = entry.get("short_description") or entry.get("detailed_description") or ""
        developers = to_string_list(entry.get("developers"))
        publishers = to_string_list(entry.get("publishers"))
        embed_text = build_embed_text(entry.get("name") or "", tags, genres, description)
        hash_val = text_hash(embed_text)

        try:
            conn.execute(sql, (
                appid,
                entry.get("name") or "",
                entry.get("release_date") or "",
                json.dumps(tags, ensure_ascii=False),
                json.dumps(genres, ensure_ascii=False),
                description[:1000],
                json.dumps(developers, ensure_ascii=False),
                json.dumps(publishers, ensure_ascii=False),
                positive,
                negative,
                total,
                entry.get("header_image") or "",
                embed_text,
                hash_val,
            ))
        except sqlite3.Error as e:
            failed += 1
            print(json.dumps({"type": "error", "message": f"sqlite error for appid {appid}: {e}"}))
            sys.stdout.flush()
            continue

        imported += 1
        chunk += 1
        if chunk >= args.chunk:
            flush()
            chunk = 0

    if chunk > 0:
        flush()

    print(json.dumps({"type": "done", "imported": imported, "skippedOwned": skipped_owned, "skippedQuality": skipped_quality, "failed": failed}))
    sys.stdout.flush()
    conn.close()


if __name__ == "__main__":
    import_catalog(parse_args())
