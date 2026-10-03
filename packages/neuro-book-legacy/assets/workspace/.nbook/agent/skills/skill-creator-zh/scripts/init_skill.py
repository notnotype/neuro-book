#!/usr/bin/env python3
"""
初始化 Neuro Book 风格的 skill 目录。
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

DEFAULT_OUTPUT_PATH = Path("assets") / "agent" / "skills"
ALLOWED_RESOURCES = {"scripts", "references", "assets"}


def normalize_directory_name(directory_name: str) -> str:
    """将目录名规范化为稳定的 slug。"""
    normalized = directory_name.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = normalized.strip("-")
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized


def is_unicode_letter(character: str) -> bool:
    """判断字符是否属于 Unicode 字母。"""
    return unicodedata.category(character).startswith("L")


def is_unicode_number(character: str) -> bool:
    """判断字符是否属于 Unicode 数字。"""
    return unicodedata.category(character).startswith("N")


def is_valid_skill_name(skill_name: str) -> bool:
    """校验 frontmatter 中的 skill 名称是否合法。"""
    if not skill_name or " " in skill_name:
        return False

    first_character = skill_name[0]
    if not (is_unicode_letter(first_character) or first_character in "_-"):
        return False

    for character in skill_name[1:]:
        if is_unicode_letter(character) or is_unicode_number(character) or character in "_-":
            continue
        return False
    return True


def parse_resources(raw_resources: str) -> list[str]:
    """解析并校验资源目录列表。"""
    if not raw_resources.strip():
        return []

    resources = [item.strip() for item in raw_resources.split(",") if item.strip()]
    invalid = sorted({item for item in resources if item not in ALLOWED_RESOURCES})
    if invalid:
        allowed = ", ".join(sorted(ALLOWED_RESOURCES))
        print(f"[ERROR] 未知资源目录：{', '.join(invalid)}")
        print(f"        允许值：{allowed}")
        sys.exit(1)

    deduped: list[str] = []
    seen: set[str] = set()
    for resource in resources:
        if resource in seen:
            continue
        deduped.append(resource)
        seen.add(resource)
    return deduped


def build_skill_template(skill_name: str, description: str) -> str:
    """生成 Neuro Book 当前使用的 SKILL.md 模板。"""
    return f"""---
name: {skill_name}
description: {description}
---

# {skill_name}

## 概述

[TODO: 用 1 到 3 句话说明这个 skill 解决什么问题，以及它对当前项目的价值。]

## 推荐工作流

1. [TODO: 写出最小可执行流程]
2. [TODO: 写出关键判断点]
3. [TODO: 写出交付或验证方式]

## 资源使用

- `scripts/`：[TODO: 如果存在，说明什么时候执行哪些脚本]
- `references/`：[TODO: 如果存在，说明什么时候读取哪些参考资料]
- `assets/`：[TODO: 如果存在，说明哪些资源会被直接复制或修改]

## 注意事项

- [TODO: 写出容易做错的点]
- [TODO: 写出项目特有约束]
"""


def create_resource_directories(skill_dir: Path, resources: list[str]) -> None:
    """创建用户指定的资源目录。"""
    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir(exist_ok=True)
        print(f"[OK] 已创建 {resource_dir.relative_to(skill_dir)}")


def init_skill(
    output_root: Path,
    directory_name: str,
    skill_name: str,
    description: str,
    resources: list[str],
) -> Path:
    """初始化 skill 目录并生成基础文件。"""
    skill_dir = output_root / directory_name
    if skill_dir.exists():
        raise FileExistsError(f"目标目录已存在：{skill_dir}")

    skill_dir.mkdir(parents=True, exist_ok=False)
    skill_md_path = skill_dir / "SKILL.md"
    skill_md_path.write_text(build_skill_template(skill_name, description), encoding="utf-8")

    if resources:
        create_resource_directories(skill_dir, resources)

    return skill_dir


def main() -> None:
    """解析命令行参数并执行初始化。"""
    parser = argparse.ArgumentParser(description="初始化 Neuro Book skill 目录。")
    parser.add_argument("directory_name", help="skill 目录名，默认会规范化为 slug")
    parser.add_argument(
        "--path",
        default=str(DEFAULT_OUTPUT_PATH),
        help="输出目录，默认是 assets/agent/skills",
    )
    parser.add_argument(
        "--name",
        default="",
        help="frontmatter 中的 skill 名称；默认使用 directory_name",
    )
    parser.add_argument(
        "--description",
        default="用于补充这里的 description。请改写成清楚描述用途和触发场景的一句话。",
        help="frontmatter 中的 description",
    )
    parser.add_argument(
        "--resources",
        default="",
        help="可选资源目录，逗号分隔：scripts,references,assets",
    )
    args = parser.parse_args()

    raw_directory_name = args.directory_name.strip()
    if not raw_directory_name:
        print("[ERROR] directory_name 不能为空。")
        sys.exit(1)

    if "/" in raw_directory_name or "\\" in raw_directory_name:
        print("[ERROR] directory_name 不能包含路径分隔符。")
        sys.exit(1)

    normalized_directory_name = normalize_directory_name(raw_directory_name)
    directory_name = normalized_directory_name or raw_directory_name
    if normalized_directory_name and normalized_directory_name != raw_directory_name:
        print(f"[INFO] 目录名已规范化：{raw_directory_name} -> {normalized_directory_name}")

    skill_name = args.name.strip() or directory_name
    if not skill_name:
        print("[ERROR] skill 名称不能为空。")
        sys.exit(1)
    if not is_valid_skill_name(skill_name):
        print("[ERROR] skill 名称不满足 `$技能名` token 规则。")
        sys.exit(1)

    output_root = Path(args.path).resolve()
    resources = parse_resources(args.resources)

    try:
        skill_dir = init_skill(
            output_root=output_root,
            directory_name=directory_name,
            skill_name=skill_name,
            description=args.description.strip(),
            resources=resources,
        )
    except FileExistsError as error:
        print(f"[ERROR] {error}")
        sys.exit(1)
    except OSError as error:
        print(f"[ERROR] 初始化失败：{error}")
        sys.exit(1)

    print(f"[OK] 已创建 skill：{skill_dir}")
    print("[OK] 下一步：补全 SKILL.md，并按需添加 scripts/references/assets 内容。")


if __name__ == "__main__":
    main()
