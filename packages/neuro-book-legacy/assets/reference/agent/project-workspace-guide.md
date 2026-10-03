# Project Workspace Guide

This document is shared context for agent profiles. It only covers the minimum Project Workspace file model that agents need before using file tools.

For detailed directory protocol, read `reference/content/project-structure.md`.
For writing workflow, read `reference/agent/novel-writing-workflow.md`.
For Plot System, read `reference/plot/system.md` and `reference/plot/agent-spec.md`.

## Workspace Paths

Project-bound Agent sessions use the Current Project Workspace as the shared File Scope for file tools and bash. Use Project-relative paths directly:

- Use `lorebook/...`.
- Use `manual/...`.
- Use `manuscript/...`.
- Use `simulation/...`.
- Use `reference/...`.

The Project Slug is a single directory name such as `my-novel`. Project-level APIs use the Project Path `workspace/{project-slug}`. File tools may access any known absolute filesystem path directly. When accessing another managed Project and its Project identity matters, use a Project File Address such as `workspace/other-novel/lorebook/...`; this formal address preserves the target Project open gate, History and Context Access semantics and is not a cwd compatibility alias.

Tool inputs and profile initial values often need different path shapes:

| Situation | Preferred path |
| --- | --- |
| File tools from current Project File Scope | `manuscript/001-volume/001-chapter/index.md` |
| Content node tool target | `lorebook/character/hero/` |
| Explicit cross-project file | `workspace/{project}/lorebook/character/hero/index.md` |
| Known filesystem target outside the File Scope | an absolute OS path |
| Plot `projectPath` | `workspace/{project}` |
| Plot stored chapter path | `manuscript/001-volume/001-chapter/` |
| Human-facing explanation | readable project or chapter name first, path only when useful |

See the [NeuroBook terminology specification](../../../docs/specs/foundation/terminology.md) for canonical workspace terms.

The cwd is only the base for relative paths, not an access boundary. An absolute path outside the current Project is treated as an external filesystem address and does not acquire managed Project identity by physical-location guessing. Use `workspace/{project}/...` when the operation should participate in that Project's lifecycle and bookkeeping.

## Basic Project Tree

Common Project Workspace paths:

| Path | Purpose |
| --- | --- |
| `{project}/AGENTS.md` | Project-level collaboration instructions. |
| `{project}/agents/` | Profile-scoped context memory, generated recommendations and profile-specific project guidance. |
| `{project}/project.yaml` | Project Workspace manifest with kind, title, summary and an optional relative cover image. |
| `{project}/lorebook/` | Stable canon, prototypes, rules and reusable AI instructions. |
| `{project}/manual/` | Project handbooks for quickstart, player guide, rules guide, GM guide and quick reference. |
| `{project}/manuscript/` | Manuscript, volumes, chapters, drafts and chapter-local notes. |
| `{project}/simulation/` | World simulation, subjects, entities and run artifacts. |
| `{project}/reference/` | External raw materials and import archives. |
| `{project}/upload/` | Uploaded intake files awaiting organization. |
| `{project}/.nbook/` | Project config, Project SQLite and project control files. |
| `{project}/.agent/` | Temporary plans, caches and execution notes. |

The optional `project.yaml` `cover` value must point to a PNG, JPEG or WebP file inside ordinary Project content, such as `assets/cover.webp`. Do not use URLs, absolute paths, parent traversal, `.nbook/` or `.git/`.

Top-level sketch:

```text
{project}/
|-- AGENTS.md
|-- agents/
|-- project.yaml
|-- lorebook/
|-- manual/
|-- manuscript/
|-- simulation/
|-- reference/
|-- upload/
|-- .nbook/
`-- .agent/
```

Keep the boundary simple:

- Stable project knowledge goes to `lorebook/`.
- Play instructions, player-safe handbooks and RP host manuals go to `manual/`.
- Formal prose goes to `manuscript/`.
- Current runtime state goes to `simulation/`.
- Imported or raw source material goes to `reference/`.
- Uploaded intake files can land in `upload/` before curation.
- Project config and database files stay under `.nbook/`.

## Content Node Basics

`lorebook/` and `manuscript/` use content nodes. A content node is a directory whose `index.md` is the entry body.

Rules:

- `lorebook/**/index.md` and `manuscript/**/index.md` represent their containing directory.
- Files under content roots that are not `index.md` are ordinary files unless a tool explicitly treats them otherwise.
- A directory content node may contain child directories, notes, drafts or references.
- Do not create both `foo.md` and `foo/index.md` for the same stem in one content root.
- `index.md` stores stable text, frontmatter refs and retrieval config.
- Optional `state.md` remains compatible for content nodes, but the long-term direction is to keep lorebook mostly stateless and move runtime state into `simulation/`.

Creation and validation:

```bash
workspace node new lorebook/character/hero --type character --title "Hero"
workspace node state lorebook/character/hero/
workspace node validate lorebook/character/hero/
```

After moving or renaming content nodes, enumerate affected `index.md` files and run `workspace node validate --stdin`.

## Content References

Content-node references split into inline refs and structured refs.

Inline refs are ordinary Markdown links in body text. Use them for appearance, mention, scene location and ordinary relatedness. Inside body text and Project-bound tool calls, prefer Project-relative paths such as `lorebook/location/capital/`; Markdown-relative links and authorized absolute paths are supported where their caller contract allows them.

Structured refs are `frontmatter.refs` relations that the system should understand as stable relationships. Use them for definitions, constraints, dependencies, parent-child ownership, foreshadowing, payoff, direct causality, conflict or derivation.

Content-node frontmatter `retrieval.trigger` explains when a node is relevant for task-driven recall. Do not pass retrieval `reason`, `use`, `risk` or `note` directly to writer; caller should judge the candidates and pass only selected content-node paths.

Profile-scoped context lives in `{project}/agents/{profile}/context.md`, `{project}/agents/{profile}/memory.md` and `{project}/agents/{profile}/generated.md`. A profile only reads its own context files. Program-private access state stays in `{project}/.nbook/context-access/{profile}.json` and is not an Agent context entry.

## Common Directories

### Manuscript

`manuscript/` is the writing area for prose, volumes, chapters, drafts and chapter-local notes.

Typical structure:

```text
manuscript/
`-- 001-volume/
    |-- index.md
    `-- 001-chapter/
        |-- index.md
        `-- notes.md
```

Guidelines:

- Chapter prose belongs in the chapter `index.md`.
- Chapter-local notes, drafts, lorebook summaries and references can live beside the chapter as ordinary files.
- `lorebook-notes.md` or `lorebook-notes/` are temporary summaries, not replacements for formal lorebook entries.
- When a manuscript path changes, relative Markdown links may break. Validate affected content nodes after path edits.

### Lorebook

`lorebook/` is the stable canon layer for facts, prototypes, rules and reusable AI instructions.

Use lorebook for:

- World facts and rules.
- Character canon and background.
- Locations, factions, items, events and systems.
- Reusable project instructions, such as style boundaries or disclosure rules.

Do not use lorebook for:

- Temporary plot plans.
- Subject private knowledge, current mind state or inventory snapshots.
- Entity holder, hidden activation state, damage or progress.
- Raw imported cards, scripts or low-confidence migration notes.

### Manual

`manual/` is the readable handbook layer for a Project. It can include quickstart instructions, player-facing guides, human GM notes, rules summaries, system module overviews and quick-reference links.

Typical structure:

```text
manual/
|-- index.md
|-- README.md
|-- world-guide.md
|-- rules-guide.md
|-- gm-guide.md
|-- reference.md
`-- player-guide/
    |-- README.md
    |-- character-creation.md
    `-- playable-characters/
        `-- player.md
```

Guidelines:

- Read `manual/README.md` when the user asks how to start or continue an RP Project.
- Read `manual/player-guide/` for player-safe information, character creation and default playable characters.
- Read `manual/gm-guide.md` when acting as or preparing an RP host.
- Read `manual/rules-guide.md` and `manual/reference.md` for adjudication entry points, but verify stable world facts against `lorebook/`.
- Do not write current state, tick logs or hidden subject state into `manual/`; use `simulation/`.
- Do not store raw imports in `manual/`; use `reference/`.

### Simulation

`simulation/` is the world simulation layer. It supports RP, writing-time world evolution, subject reactions, information control and entity state maintenance.

Minimal structure:

```text
simulation/
|-- index.md
|-- subjects/
|   `-- index.md
|-- entities/
|   `-- index.md
`-- runs/
    |-- index.md
    `-- ticks/
        `-- index.md
```

Use `simulation/subjects/` for information-control subjects and `simulation/entities/` for stateful entities. `actor` is a simulator profile type, not a top-level project directory.

### Reference

`reference/` stores external raw materials and import archives, such as SillyTavern cards, Tomato imports, research notes and source excerpts. Do not mix raw external material into `manuscript/` or stable `lorebook/` without an explicit migration step.

## Shell Entry Points

The stable Agent runtime CLI entry is `workspace node ...`, provided by `.nbook/agent/bin` in PATH.

Useful commands:

```bash
workspace project create my-novel --title "Title" --summary "One sentence"
workspace project validate .
workspace project init-db .
workspace node parse lorebook/character/hero/
workspace node validate lorebook/character/hero/
workspace node new lorebook/character/hero --type character --title "Hero" --state
workspace node state lorebook/character/hero/
```

Batch examples:

```bash
rg --files | rg '(^|/)index\.md$' | workspace node parse --stdin --ndjson
rg --files | rg '(^|/)index\.md$' | workspace node validate --stdin
```

Prefer `rg --files` and precise path filters. Do not recursively scan an entire Project Workspace without a reason.

Agent runtime config makes `rg --files` output use `/` paths. Shell examples should use bash syntax and `/` separators for File Scope-relative paths. Do not write unquoted Windows backslash paths like `lorebook\character\hero`, because bash can parse them as `lorebookcharacterhero`.

## Cross References

- [NeuroBook terminology](../../../docs/specs/foundation/terminology.md)
- Project structure: `reference/content/project-structure.md`
- Directory protocol: `reference/content/directory-protocol.md`
- Manual directory: `reference/content/manual.md`
- Content information control: `reference/content/information-control.md`
- Content-node state compatibility: `reference/content/state.md`
- Retrieval: `reference/content/retrieval.md`
- Profile context memory: `reference/agent/profile-context-memory.md`
- Novel writing workflow: `reference/agent/novel-writing-workflow.md`
- Plot System: `reference/plot/system.md`
