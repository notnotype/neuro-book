#!/usr/bin/env python3
"""
快速校验 Neuro Book skill 目录结构。
"""

import re
import sys
import unicodedata
from pathlib import Path

SKILL_FILE_CANDIDATES = ("SKILL.md", "skill.md")
FORBIDDEN_TERMS = (
    "CODEX_HOME",
    "agents/openai.yaml",
    "generate_openai_yaml.py",
)


def resolve_skill_file(skill_dir: Path) -> Path | None:
    """按当前项目规则解析 skill 文件路径。"""
    for file_name in SKILL_FILE_CANDIDATES:
        candidate = skill_dir / file_name
        if candidate.exists():
            return candidate
    return None


def parse_frontmatter(document_text: str) -> tuple[dict[str, str], str] | tuple[None, str]:
    """读取并解析最小 frontmatter。"""
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", document_text, re.DOTALL)
    if not match:
        return None, "缺少合法的 YAML frontmatter。"

    frontmatter_text = match.group(1)
    body_text = match.group(2)
    metadata: dict[str, str] = {}

    for raw_line in frontmatter_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if ":" not in line:
            return None, f"frontmatter 行格式错误：{raw_line}"
        key, raw_value = line.split(":", 1)
        normalized_key = key.strip()
        value = raw_value.strip()
        if not normalized_key:
            return None, f"frontmatter 键不能为空：{raw_line}"
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1]
        metadata[normalized_key] = value.strip()

    return metadata, body_text


def is_unicode_letter(character: str) -> bool:
    """判断字符是否属于 Unicode 字母。"""
    return unicodedata.category(character).startswith("L")


def is_unicode_number(character: str) -> bool:
    """判断字符是否属于 Unicode 数字。"""
    return unicodedata.category(character).startswith("N")


def is_valid_skill_name(name: str) -> bool:
    """校验当前项目 catalog 使用的 skill 名称规则。"""
    if not name or " " in name:
        return False

    first_character = name[0]
    if not (is_unicode_letter(first_character) or first_character in "_-"):
        return False

    for character in name[1:]:
        if is_unicode_letter(character) or is_unicode_number(character) or character in "_-":
            continue
        return False
    return True


def validate_frontmatter(metadata: dict[str, str]) -> list[str]:
    """校验当前项目认可的 frontmatter。"""
    errors: list[str] = []
    allowed_keys = {"name", "description"}
    unexpected_keys = sorted(set(metadata.keys()) - allowed_keys)
    if unexpected_keys:
        errors.append(f"frontmatter 只允许 name/description，发现多余字段：{', '.join(unexpected_keys)}")

    name = metadata.get("name", "").strip()
    description = metadata.get("description", "").strip()

    if not name:
        errors.append("缺少 name。")
    elif not is_valid_skill_name(name):
        errors.append("name 不满足 `$技能名` token 规则：不能有空格，且只能包含字母、数字、_、-，首字符不能是数字。")

    if not description:
        errors.append("缺少 description。")

    return errors


def validate_forbidden_terms(document_text: str) -> list[str]:
    """检查是否残留当前项目不应继续使用的旧术语。"""
    errors: list[str] = []
    for term in FORBIDDEN_TERMS:
        if term in document_text:
            errors.append(f"文档中残留旧平台术语：{term}")
    return errors


def validate_skill(skill_dir: Path) -> tuple[bool, list[str]]:
    """执行完整的快速校验。"""
    errors: list[str] = []
    skill_file = resolve_skill_file(skill_dir)
    if not skill_file:
        return False, ["未找到 SKILL.md 或 skill.md。"]

    document_text = skill_file.read_text(encoding="utf-8")
    parsed = parse_frontmatter(document_text)
    if parsed[0] is None:
        return False, [parsed[1]]

    metadata, _body_text = parsed
    errors.extend(validate_frontmatter(metadata))
    errors.extend(validate_forbidden_terms(document_text))
    return len(errors) == 0, errors


def main() -> None:
    """解析参数并输出校验结果。"""
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    skill_dir = Path(sys.argv[1]).resolve()
    is_valid, errors = validate_skill(skill_dir)
    if is_valid:
        print("Skill 校验通过。")
        sys.exit(0)

    print("Skill 校验失败：")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)


if __name__ == "__main__":
    main()
