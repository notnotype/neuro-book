---
name: skill-creator
description: Create or update a Neuro Book skill under .nbook/agent/skills. Use this when you need to design a new skill, refactor an existing skill, tighten trigger descriptions, reorganize bundled resources, or add optional helper scripts and references for the project skill system.
---

# Skill Creator

Create and maintain skills for the Neuro Book repository.

This project follows the [Agent Skills open standard](https://agentskills.io/specification). A skill is a directory whose name is the stable id, with `SKILL.md` at its root. Skills are discovered from the Install Root (`workspace/.nbook/agent/skills/*/SKILL.md`) and, for project-scoped skills, from the current project root. Built-in skills are installed into the Install Root from the packages that ship with NeuroBook; they are not a separate override layer you edit in place.

Only the frontmatter is read up front. The body is loaded with `read` from the catalog location later, and only when the model decides the skill is relevant.

The authoritative contract is `reference/agent/skill-package.md`. Treat it as ground truth while editing skills, and do not design around external conventions that this project does not implement.

## What A Neuro Book Skill Is

Each skill is a folder under the Install Root `workspace/.nbook/agent/skills/<id>`. The folder name is the skill id and must match the frontmatter `name`.

Required file:

```text
<folder>/
└── SKILL.md
```

Optional resources:

```text
<folder>/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

- `scripts/`: executable helpers when deterministic or repetitive work is useful
- `references/`: detailed documentation that should be read only when needed
- `assets/`: templates, images, sample files, or other output resources

Do not create extra process documentation such as `README.md`, `CHANGELOG.md`, or onboarding notes unless the user explicitly asks for them.

## Frontmatter Rules

Minimum:

```yaml
---
name: your-skill-name
description: Explain what the skill does and when it should be used.
---
```

With the optional fields this project supports:

```yaml
---
name: rp-mode
description: Runs the roleplay protocol. Use when the user asks to start RP, play a character, or advance a tick.
when_to_use:
  - 用户要求进入 RP
  - 用户要求推进 tick
metadata:
    displayName: RP 模式
    version: "1.2.0"
    author: your-name
    minAppVersion: "0.8.0"
license: AGPL-3.0-only
compatibility: Requires bun and network access
---
```

Rules:

- `name` is the stable **id**, not a display label. It must be 1–64 characters, lowercase letters, digits and hyphens only, must not start or end with a hyphen, must not contain consecutive hyphens, and **must equal the parent directory name**.
- **Chinese names go in `metadata.displayName`, never in `name`.** The id stays ASCII so it can be used as a directory name, an install identity, and a shell path; the interface still shows the Chinese name.
- `description` is the main trigger hint, so include both capability and usage context.
- `when_to_use` optionally adds trigger scenarios, as a scalar or a YAML list. It supplements `description`; it does not replace it.
- Everything else custom goes under `metadata`, which is a flat string map. Do not invent new top-level keys.
- Prefer short ids because the user may type them in the editor.

Good `description` fields mention:

- what the skill helps with
- which task patterns should trigger it
- any domain, artifact, or workflow constraints that matter

Bad `description` fields are generic labels such as "Helper skill" or "Writing support".

## Creation Workflow

Follow this order unless the user explicitly asks for something narrower.

1. Understand the concrete task the skill should help with.
2. Decide what belongs in `SKILL.md` versus `references/`, `scripts/`, or `assets/`.
3. Create or update the skill folder under `workspace/.nbook/agent/skills` for user changes, or `assets/workspace/.nbook/agent/skills` when explicitly changing the system baseline.
4. Write concise frontmatter and a focused `SKILL.md` body.
5. Add helper resources only when they directly reduce repeated work.
6. Validate the structure manually or with `scripts/quick_validate.py` if shell execution is available.

## How To Decide The Structure

Keep `SKILL.md` short and procedural. Put only the information that another agent needs immediately after the skill is activated.

Use `references/` when:

- the material is long
- only part of it is needed for a given task
- the agent should selectively read deeper material

Use `scripts/` when:

- the same transformation would otherwise be rewritten repeatedly
- a deterministic helper is better than free-form text instructions
- the future shell-enabled workflow should have a ready-made utility

Use `assets/` when:

- the skill needs templates or example output artifacts
- the file should be copied or adapted rather than read into context

## Writing Guidelines

Write the body as instructions for another agent, not for a human reader.

- use imperative wording
- prefer short sections over long essays
- explain decisions that are non-obvious
- link directly to specific `references/...` files when deeper reading is needed
- avoid duplicating the same detail in both `SKILL.md` and `references/`

When a skill supports multiple modes or variants, keep the routing logic in `SKILL.md` and move variant-specific detail into `references/`.

## Default Location

Unless the user asks otherwise, create new skills in:

```text
workspace/.nbook/agent/skills/<folder>
```

If shell execution is available, `scripts/init_skill.py` can generate a starter folder there. If shell execution is not available, create the files manually with the same structure.

## Optional Helper Scripts

This skill includes two helper scripts:

- `scripts/init_skill.py`: generate a new Neuro Book skill skeleton
- `scripts/quick_validate.py`: run lightweight validation against the current project rules

These scripts are optional accelerators. Do not block on them if the environment cannot execute shell commands.

## Manual Validation Checklist

If you cannot run the validator, check these points manually:

- the skill folder lives under `workspace/.nbook/agent/skills`, or under the current project root for a project-scoped skill
- `SKILL.md` exists
- `name` is lowercase letters, digits and hyphens, and equals the folder name
- any Chinese display name is in `metadata.displayName`, not in `name`
- no custom top-level frontmatter keys beyond `when_to_use`; everything else is under `metadata`
- `metadata.version` and `metadata.minAppVersion`, when present, are canonical SemVer
- `description` clearly states when the skill should be used
- `SKILL.md` does not mention outdated Codex-specific paths or metadata files
- optional `references/`, `scripts/`, and `assets/` directories are only present when they are actually useful

## When Updating An Existing Skill

When modifying an existing skill:

- preserve the intent of the original skill unless the user asks to reposition it
- tighten vague trigger descriptions
- remove outdated instructions that no longer match the current repo
- avoid adding speculative structure that the project does not consume yet

If the existing skill contains project-irrelevant residue, remove it instead of explaining around it.
