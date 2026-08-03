#!/usr/bin/env python3
"""
Lightweight validator for Neuro Book skills.

Validates against the Agent Skills open standard (https://agentskills.io/specification)
plus the Neuro Book conventions layered on top of it. See
`reference/agent/skill-package.md` for the authoritative contract.
"""

import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
MAX_COMPATIBILITY_LENGTH = 500

# 标准允许的顶层字段。metadata 是任意 string map，用于承载标准之外的属性。
# when_to_use 是标准之外的既有扩展：NeuroBook SkillCatalog 与 Claude Code 都消费它，
# 现存内置 Skill 也在用，因此容忍在顶层出现。
ALLOWED_TOP_LEVEL_KEYS = {
    "name",
    "description",
    "when_to_use",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
}

SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

# id 规则：小写字母数字与连字符，不以连字符开头结尾，不含连续连字符。
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

FORBIDDEN_TERMS = (
    "CODEX_HOME",
    "~/.codex/skills",
    "agents/openai.yaml",
    "generate_openai_yaml.py",
)


def strip_quotes(value: str) -> str:
    """Remove one matching pair of surrounding quotes."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_frontmatter(content: str) -> tuple[dict[str, object], str] | tuple[None, str]:
    """
    Extract the YAML frontmatter block.

    Supports flat scalar keys, a single nested `metadata` mapping (the only nested
    structure the Agent Skills standard defines), and a block list under `when_to_use`.
    """
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", content, re.DOTALL)
    if not match:
        return None, "Missing or invalid YAML frontmatter"

    frontmatter: dict[str, object] = {}
    metadata: dict[str, str] = {}
    when_to_use_items: list[str] = []
    # 当前正在收集的块：None / "metadata" / "when_to_use"
    open_block: str | None = None

    for raw_line in match.group(1).splitlines():
        if not raw_line.strip():
            continue

        indented = raw_line[:1].isspace()
        line = raw_line.strip()

        if line.startswith("- "):
            if open_block != "when_to_use":
                return None, f"Unexpected list item outside when_to_use: {line}"
            when_to_use_items.append(strip_quotes(line[2:].strip()))
            continue

        if indented:
            if open_block != "metadata":
                return None, f"Unexpected indented frontmatter line: {line}"
            if ":" not in line:
                return None, f"Invalid metadata line: {line}"
            key, raw_value = line.split(":", 1)
            key = key.strip()
            if not key:
                return None, f"Invalid metadata line: {line}"
            metadata[key] = strip_quotes(raw_value.strip())
            continue

        open_block = None
        if ":" not in line:
            return None, f"Invalid frontmatter line: {line}"

        key, raw_value = line.split(":", 1)
        key = key.strip()
        value = raw_value.strip()
        if not key:
            return None, f"Invalid frontmatter line: {line}"

        if key == "metadata":
            if value:
                return None, "metadata must be a nested mapping, not an inline value"
            open_block = "metadata"
            continue

        if key == "when_to_use" and not value:
            open_block = "when_to_use"
            continue

        frontmatter[key] = strip_quotes(value)

    if metadata:
        frontmatter["metadata"] = metadata
    if when_to_use_items:
        frontmatter["when_to_use"] = when_to_use_items

    return frontmatter, ""


def validate_frontmatter(frontmatter: dict[str, object], directory_name: str) -> str:
    """Return an error message, or an empty string when the frontmatter is valid."""
    unexpected_keys = sorted(set(frontmatter.keys()) - ALLOWED_TOP_LEVEL_KEYS)
    if unexpected_keys:
        joined_keys = ", ".join(unexpected_keys)
        return f"Unexpected frontmatter keys: {joined_keys}"

    name = str(frontmatter.get("name", "")).strip()
    if not name:
        return "Missing 'name' in frontmatter"
    if len(name) > MAX_SKILL_NAME_LENGTH:
        return f"name must be at most {MAX_SKILL_NAME_LENGTH} characters"
    if not SKILL_NAME_PATTERN.match(name):
        return (
            "name must be lowercase letters, digits and hyphens only, "
            "without leading, trailing or consecutive hyphens"
        )
    if name != directory_name:
        return f"name '{name}' must match the parent directory name '{directory_name}'"

    description = str(frontmatter.get("description", "")).strip()
    if not description:
        return "Missing 'description' in frontmatter"
    if len(description) > MAX_DESCRIPTION_LENGTH:
        return f"description must be at most {MAX_DESCRIPTION_LENGTH} characters"

    compatibility = str(frontmatter.get("compatibility", "")).strip()
    if len(compatibility) > MAX_COMPATIBILITY_LENGTH:
        return f"compatibility must be at most {MAX_COMPATIBILITY_LENGTH} characters"

    metadata = frontmatter.get("metadata")
    if isinstance(metadata, dict):
        for field in ("version", "minAppVersion"):
            raw = metadata.get(field, "").strip()
            if raw and not SEMVER_PATTERN.match(raw):
                return f"metadata.{field} must be a canonical SemVer string"

    return ""


def validate_skill(skill_path: Path) -> tuple[bool, str]:
    """Validate the skill folder against the current Neuro Book conventions."""
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    content = skill_md.read_text(encoding="utf-8")
    parsed_frontmatter, error = parse_frontmatter(content)
    if parsed_frontmatter is None:
        return False, error

    error = validate_frontmatter(parsed_frontmatter, skill_path.name)
    if error:
        return False, error

    for forbidden_term in FORBIDDEN_TERMS:
        if forbidden_term in content:
            return False, f"Outdated Codex residue found: {forbidden_term}"

    return True, "Skill is valid."


def main() -> int:
    """Parse CLI arguments and run validation."""
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        return 1

    skill_path = Path(sys.argv[1]).resolve()
    is_valid, message = validate_skill(skill_path)
    print(message)
    return 0 if is_valid else 1


if __name__ == "__main__":
    sys.exit(main())
