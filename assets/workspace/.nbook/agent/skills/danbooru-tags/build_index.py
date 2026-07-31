#!/usr/bin/env python3
"""
从 Anima base1.0 正式版 CSV 重建标签索引。

只读取：
- anima-1.0.csv

分类码：
- 0: general
- 1: artists（CSV 原始标签已带 @，必须保留）
- 3: series / copyright
- 4: characters
- 5: meta
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, Tuple

from sqlite_index import init_db

HERE = Path(__file__).resolve().parent
SOURCES = [
    HERE / "anima-1.0.csv",
]
OUTPUT_PATH = HERE / "tags_index.json"

CATEGORY_MAP = {
    "0": "general",
    "1": "artists",
    "3": "series",
    "4": "characters",
    "5": "meta",
}


def merge_aliases(left: str, right: str) -> str:
    """合并别名，保持稳定顺序并去重。"""
    seen = set()
    merged = []
    for value in (left, right):
        for item in str(value or "").split(","):
            alias = item.strip()
            if not alias:
                continue
            key = alias.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(alias)
    return ",".join(merged)


def build_index() -> Dict[str, list]:
    merged: Dict[str, Dict[str, Tuple[int, str]]] = defaultdict(dict)

    for source in SOURCES:
        with source.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) < 3:
                    continue

                tag = row[0].strip()
                category_id = row[1].strip()
                if not tag or category_id not in CATEGORY_MAP:
                    continue
                if category_id == "1" and "wildcard" in tag.lower():
                    continue

                try:
                    count = int(row[2])
                except ValueError:
                    continue

                aliases = row[3].strip() if len(row) > 3 else ""
                category = CATEGORY_MAP[category_id]
                current = merged[category].get(tag)
                if current is None:
                    merged[category][tag] = (count, aliases)
                    continue

                current_count, current_aliases = current
                merged[category][tag] = (
                    max(current_count, count),
                    merge_aliases(current_aliases, aliases),
                )

    result = {}
    for category, tag_map in merged.items():
        items = sorted(tag_map.items(), key=lambda kv: (-kv[1][0], kv[0]))
        result[category] = [[tag, count, aliases] for tag, (count, aliases) in items]
    return result


def main() -> None:
    result = build_index()
    OUTPUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    init_db(result)

    print(f"rebuilt {OUTPUT_PATH}")
    print(f"rebuilt {HERE / 'tags_index.sqlite'}")
    for category in ["artists", "general", "characters", "series", "meta"]:
        print(f"{category}: {len(result.get(category, []))}")


if __name__ == "__main__":
    main()
