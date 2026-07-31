#!/usr/bin/env python3
"""SQLite-backed Danbooru tag index with fine-grained group mapping."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, List, Optional, Sequence

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "tags_index.sqlite"
BASE_CATEGORIES = ["artists", "general", "characters", "series", "meta"]


def normalize_for_sql(value: str) -> str:
    """Normalize a tag or aliases for SQL LIKE matching."""
    import re

    s = (value or "").strip().lower()
    if s.startswith("@"):
        s = s[1:].strip()
    s = s.replace("\\(", "(").replace("\\)", ")")
    s = s.replace("-", " ").replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def tag_key(value: str) -> str:
    """Return normalized tag key used by group mapping."""
    return normalize_for_sql(value).replace(" ", "_")


def db_exists() -> bool:
    """Return whether the SQLite index is available."""
    return DB_PATH.exists()


def connect() -> sqlite3.Connection:
    """Open the SQLite index in read-only mode when possible."""
    if DB_PATH.exists():
        uri = f"file:{DB_PATH.as_posix()}?mode=ro"
        return sqlite3.connect(uri, uri=True)
    return sqlite3.connect(DB_PATH)


def init_db(rows_by_category: dict[str, list[list[Any]]]) -> None:
    """Rebuild the SQLite index from the JSON-compatible row map."""
    from tag_groups import GROUP_FILTERS

    if DB_PATH.exists():
        DB_PATH.unlink()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute(
            """
            CREATE TABLE tags (
                category TEXT NOT NULL,
                tag TEXT NOT NULL,
                tag_key TEXT NOT NULL,
                tag_norm TEXT NOT NULL,
                aliases TEXT NOT NULL,
                aliases_norm TEXT NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (category, tag)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE tag_groups (
                group_name TEXT NOT NULL,
                category TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (group_name, category, tag),
                FOREIGN KEY (category, tag) REFERENCES tags(category, tag)
            )
            """
        )
        tag_payload = []
        group_payload = []
        for category, rows in rows_by_category.items():
            for tag, count, aliases in rows:
                tag_text = str(tag)
                key = tag_key(tag_text)
                tag_payload.append((
                    category,
                    tag_text,
                    key,
                    normalize_for_sql(tag_text),
                    str(aliases or ""),
                    normalize_for_sql(str(aliases or "")),
                    int(count or 0),
                ))
                for group_name, (group_category, tag_filter) in GROUP_FILTERS.items():
                    if group_category != category:
                        continue
                    if tag_filter is None:
                        if _base_group_matches(group_name, category):
                            group_payload.append((group_name, category, tag_text))
                    elif tag_text in tag_filter or key in tag_filter:
                        group_payload.append((group_name, category, tag_text))
        conn.executemany(
            "INSERT OR REPLACE INTO tags(category, tag, tag_key, tag_norm, aliases, aliases_norm, count) VALUES (?, ?, ?, ?, ?, ?, ?)",
            tag_payload,
        )
        conn.executemany(
            "INSERT OR REPLACE INTO tag_groups(group_name, category, tag) VALUES (?, ?, ?)",
            group_payload,
        )
        conn.execute("CREATE INDEX idx_tags_category_count ON tags(category, count DESC)")
        conn.execute("CREATE INDEX idx_tags_category_tag_norm ON tags(category, tag_norm)")
        conn.execute("CREATE INDEX idx_tags_category_aliases_norm ON tags(category, aliases_norm)")
        conn.execute("CREATE INDEX idx_tag_groups_group ON tag_groups(group_name, category, tag)")
        conn.commit()
    finally:
        conn.close()


def query_categories(group_name: str, category: str, has_query: bool) -> list[str]:
    """Return source categories without loading JSON."""
    if group_name == "series":
        return ["series"]
    if group_name == "characters":
        return ["characters"]
    if category:
        return [category]
    return BASE_CATEGORIES[:]


def query_rows(
    *,
    category: str,
    group_name: str,
    min_count: int,
    prefix_norm: str,
    keyword_terms: Sequence[str],
    limit: int,
) -> Optional[List[List[Any]]]:
    """Return candidate rows for Python scoring, or None when SQLite is unavailable."""
    if not DB_PATH.exists() or not category:
        return None

    clauses = ["t.category = ?"]
    params: list[Any] = [category]
    join = ""
    if _should_join_group(group_name):
        join = " JOIN tag_groups g ON g.category = t.category AND g.tag = t.tag"
        clauses.append("g.group_name = ?")
        params.append(group_name)
    if min_count > 0:
        clauses.append("t.count >= ?")
        params.append(int(min_count))
    if prefix_norm:
        clauses.append("t.tag_norm LIKE ?")
        params.append(f"{prefix_norm}%")
    if keyword_terms:
        term_clauses = []
        for term in keyword_terms:
            term_clauses.append("(t.tag_norm LIKE ? OR t.aliases_norm LIKE ?)")
            like = f"%{normalize_for_sql(term)}%"
            params.extend([like, like])
        clauses.append("(" + " OR ".join(term_clauses) + ")")

    candidate_limit = max(limit * 20, 200)
    sql = (
        "SELECT t.tag, t.count, t.aliases FROM tags t"
        + join
        + " WHERE "
        + " AND ".join(clauses)
        + " ORDER BY t.count DESC, t.tag ASC LIMIT ?"
    )
    params.append(candidate_limit)

    conn = connect()
    try:
        return [[tag, count, aliases] for tag, count, aliases in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def _base_group_matches(group_name: str, category: str) -> bool:
    return (
        (group_name == "artists" and category == "artists")
        or (group_name == "characters" and category == "characters")
        or (group_name == "series" and category == "series")
        or (group_name == "meta" and category == "meta")
    )


def _should_join_group(group_name: str) -> bool:
    return group_name not in {"", "characters", "series"}
