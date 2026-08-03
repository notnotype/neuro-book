#!/usr/bin/env python3
"""
Create a Neuro Book skill skeleton.

Usage:
    init_skill.py <skill-id> [--display-name <text>] [--description <text>]
        [--path <skills-root>] [--resources scripts,references,assets]

The directory name is the skill id and is written verbatim into the frontmatter
`name`. Chinese or otherwise non-ASCII labels go to `--display-name`, which is
emitted as `metadata.displayName`.

Examples:
    init_skill.py plot-helper
    init_skill.py shuangwen-style --display-name 爽文风格
    init_skill.py lore-tools --resources scripts,references
"""

import argparse
import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_RESOURCES = ("scripts", "references", "assets")
DEFAULT_SKILL_ROOT = Path(__file__).resolve().parents[2]
# id 规则：小写字母数字与连字符，不以连字符开头结尾，不含连续连字符。
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

SKILL_TEMPLATE = """---
name: {skill_name}
description: {skill_description}
{metadata_block}---

# {skill_title}

## Purpose

[TODO: Explain what this skill helps with in 1-2 short paragraphs.]

## Workflow

1. [TODO: First action]
2. [TODO: Second action]
3. [TODO: Final action]

## Resource Routing

- Read `references/...` only when deeper detail is needed.
- Run `scripts/...` only when deterministic automation helps.
- Use `assets/...` only when output files or templates are required.

## Notes

- Keep this file concise.
- Put long reference material in `references/`.
- Remove sections that do not help another agent perform the task.
"""

REFERENCE_TEMPLATE = """# Reference Notes

[TODO: Put detailed background, schemas, examples, or long-form guidance here.]
"""

SCRIPT_TEMPLATE = """#!/usr/bin/env python3
\"\"\"
Placeholder helper for {skill_name}.
Replace this file with real automation or delete it.
\"\"\"


def main():
    \"\"\"Run the placeholder helper.\"\"\"
    print("Replace scripts/example.py with a real helper or delete it.")


if __name__ == "__main__":
    main()
"""

ASSET_TEMPLATE = """Placeholder asset file.
Replace this file with a real template, image, sample file, or delete it.
"""


def is_valid_skill_name(value: str) -> bool:
    """Return True when the value is a valid skill id."""
    if not value or len(value) > MAX_SKILL_NAME_LENGTH:
        return False
    return SKILL_NAME_PATTERN.match(value) is not None


def build_metadata_block(display_name: str) -> str:
    """Build the optional frontmatter metadata block."""
    if not display_name:
        return ""
    return f"metadata:\n    displayName: {display_name}\n"


def build_skill_title(skill_name: str, display_name: str) -> str:
    """Build a readable heading, preferring the display name when provided."""
    if display_name:
        return display_name
    if "-" not in skill_name:
        return skill_name
    return " ".join(part.capitalize() for part in skill_name.split("-") if part)


def parse_resources(raw_resources: str) -> list[str]:
    """Parse and validate the requested resource directories."""
    if not raw_resources:
        return []

    resources: list[str] = []
    for item in raw_resources.split(","):
        resource = item.strip()
        if not resource:
            continue
        if resource not in ALLOWED_RESOURCES:
            allowed = ", ".join(ALLOWED_RESOURCES)
            print(f"[ERROR] Unknown resource '{resource}'. Allowed: {allowed}")
            sys.exit(1)
        if resource not in resources:
            resources.append(resource)
    return resources


def write_file(path: Path, content: str, executable: bool = False) -> None:
    """Write a UTF-8 file and optionally mark it executable."""
    path.write_text(content, encoding="utf-8")
    if executable:
        path.chmod(0o755)


def init_skill(skill_name: str, display_name: str, description: str, root_path: Path, resources: list[str]) -> int:
    """Create the skill directory and starter files."""
    skill_dir = root_path / skill_name
    if skill_dir.exists():
        print(f"[ERROR] Skill directory already exists: {skill_dir}")
        return 1

    skill_dir.mkdir(parents=True, exist_ok=False)

    write_file(
        skill_dir / "SKILL.md",
        SKILL_TEMPLATE.format(
            skill_name=skill_name,
            skill_description=description,
            metadata_block=build_metadata_block(display_name),
            skill_title=build_skill_title(skill_name, display_name),
        ),
    )

    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir(exist_ok=True)
        if resource == "references":
            write_file(resource_dir / "overview.md", REFERENCE_TEMPLATE)
        elif resource == "scripts":
            write_file(resource_dir / "example.py", SCRIPT_TEMPLATE.format(skill_name=skill_name), executable=True)
        elif resource == "assets":
            write_file(resource_dir / "placeholder.txt", ASSET_TEMPLATE)

    print(f"[OK] Created skill at {skill_dir}")
    print("Next steps:")
    print("1. Replace the placeholder description in SKILL.md with a concrete trigger description.")
    print("2. Rewrite the body so another agent can follow it directly.")
    if resources:
        print("3. Replace or delete placeholder files in the resource directories.")
        print("4. Run quick_validate.py when shell execution is available.")
    else:
        print("3. Add resource directories only if they are actually needed.")
        print("4. Run quick_validate.py when shell execution is available.")
    return 0


def main() -> int:
    """Parse CLI arguments and create the skill skeleton."""
    parser = argparse.ArgumentParser(description="Create a Neuro Book skill skeleton.")
    parser.add_argument("skill_name", help="Skill id. Becomes both the directory name and frontmatter `name`.")
    parser.add_argument(
        "--display-name",
        default="",
        help="Interface label written to metadata.displayName. Use this for Chinese names.",
    )
    parser.add_argument(
        "--description",
        default="[TODO: Explain what this skill does and when it should be used.]",
        help="Frontmatter description.",
    )
    parser.add_argument(
        "--path",
        default=str(DEFAULT_SKILL_ROOT),
        help="Skill root directory. Defaults to the skills root containing this script.",
    )
    parser.add_argument(
        "--resources",
        default="",
        help="Comma-separated resource directories: scripts,references,assets",
    )
    args = parser.parse_args()

    skill_name = args.skill_name.strip()
    display_name = args.display_name.strip()
    description = args.description.strip()
    root_path = Path(args.path).resolve()
    resources = parse_resources(args.resources)

    if not is_valid_skill_name(skill_name):
        print(
            "[ERROR] skill id must be lowercase letters, digits and hyphens only, "
            "without leading, trailing or consecutive hyphens. "
            "Put Chinese names in --display-name."
        )
        return 1
    if not description:
        print("[ERROR] description cannot be empty.")
        return 1

    return init_skill(skill_name, display_name, description, root_path, resources)


if __name__ == "__main__":
    sys.exit(main())
