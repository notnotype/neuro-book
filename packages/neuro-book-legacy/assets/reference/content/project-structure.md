# Project Structure

This document is the high-level map of a NeuroBook Project Workspace. It stays intentionally thin: first two directory levels, core ownership boundaries and links to detailed contracts.

For the short agent-facing path guide, read `reference/agent/project-workspace-guide.md`.

## First Two Levels

Default Project Workspace sketch:

```text
{project}/
|-- AGENTS.md
|-- project.yaml
|-- agents/
|   |-- index.md
|   |-- simulator.leader/
|   |   |-- index.md
|   |   |-- context.md
|   |   |-- memory.md
|   |   `-- generated.md
|   `-- rp.writer/
|       |-- index.md
|       |-- context.md
|       |-- memory.md
|       `-- generated.md
|-- lorebook/
|   |-- index.md
|   |-- world/
|   |-- character/
|   |-- location/
|   |-- faction/
|   |-- item/
|   |-- event/
|   |-- system/
|   `-- instruction/
|-- manual/
|   |-- index.md
|   |-- README.md
|   |-- world-guide.md
|   |-- rules-guide.md
|   |-- gm-guide.md
|   |-- reference.md
|   `-- player-guide/
|-- manuscript/
|   |-- index.md
|   `-- 001-volume/
|-- simulation/
|   |-- index.md
|   |-- subjects/
|   |   `-- index.md
|   |-- entities/
|   |   `-- index.md
|   `-- runs/
|       |-- index.md
|       `-- ticks/
|           `-- index.md
|-- reference/
|   `-- index.md
|-- upload/
|   `-- index.md
|-- .nbook/
`-- .agent/
```

The top-level directories are extensible, but the default template should stay small. Promote a category only when it becomes a frequent project-specific organizing axis.

## Core Split

| Directory | Purpose | Detailed reference |
| --- | --- | --- |
| `lorebook/` | Mostly stateless canon, prototypes, rules and reusable AI instructions. | [lorebook.md](lorebook.md) |
| `manual/` | Play and RP handbooks: quickstart, player guide, world overview, rules guide, GM guide and quick reference. | [manual.md](manual.md) |
| `manuscript/` | Formal prose, volumes, chapters, drafts and chapter-local notes. | [manuscript.md](manuscript.md) |
| `agents/` | Profile-scoped context memory, generated recommendations and profile-specific project guidance. | [../agent/profile-context-memory.md](../agent/profile-context-memory.md) |
| `simulation/` | World runtime state, subjects, entities and run artifacts. | [simulation.md](simulation.md) |
| `reference/` | External raw materials, import archives and low-confidence migration inputs. | This file |
| `upload/` | Uploaded files and project-local intake material awaiting organization. | This file |
| `.nbook/` | Project config, Project SQLite and control files. | [NeuroBook terminology](../../../docs/specs/foundation/terminology.md) |
| `.agent/` | Temporary execution notes, plans and caches. | Agent docs |

Keep the boundary simple:

- Stable project knowledge goes to `lorebook/`.
- Play instructions, player-safe handbooks and RP host manuals go to `manual/`.
- Profile-specific project guidance and context memory go to `agents/`.
- Formal prose goes to `manuscript/`.
- Current runtime state goes to `simulation/`.
- Imported or raw source material goes to `reference/`.
- Uploaded intake files can land in `upload/` before being curated into `reference/`, `lorebook/`, `manual/` or `manuscript/`.
- Project config and database files stay under `.nbook/`.
- Temporary agent work stays under `.agent/` or a system temp directory.

`reference/silly-tavern/{slug}/` is the standard landing zone for SillyTavern imports. It may contain raw card files, `inspect.json`, unpacked worldbook entries, `card-body/`, `dynamic-worldbook/`, extension archives and `simulation-migration/` reports. These files are evidence and migration material; they are not automatically canon until reviewed into `lorebook/`, `manuscript/` or `simulation/`.

## Root Files

| Path | Purpose |
| --- | --- |
| `project.yaml` | Project identity and lightweight display metadata: kind, title, summary and optional cover. |
| `AGENTS.md` | Project-specific instructions for agents. |
| `.nbook/config.json` | Project-level config overrides. |
| `.nbook/project.sqlite` | Project SQLite for Plot / Story data. |

Do not store story canon in `.nbook/` or `.agent/`.

When `project.yaml` declares `cover`, the value is a portable Project Workspace-relative PNG, JPEG or WebP path. Keep the image with ordinary Project content (for example `assets/cover.webp`); absolute paths, URLs, parent traversal, `.nbook/` and `.git/` are not valid cover locations.

## Detail Ownership

- `lorebook/` rules and type taxonomy live in [lorebook.md](lorebook.md).
- `manual/` handbook and RP play guide rules live in [manual.md](manual.md).
- `agents/` profile context memory lives in [../agent/profile-context-memory.md](../agent/profile-context-memory.md).
- `manuscript/` volume/chapter rules live in [manuscript.md](manuscript.md).
- `simulation/` subjects/entities/runs and simulator profile contracts live in [simulation.md](simulation.md).
- Content node links, refs and validation rules live in [content-references.md](content-references.md).
- Prototype / Entity / Subject information-control rules live in [information-control.md](information-control.md).

## Related References

- Agent path guide: `reference/agent/project-workspace-guide.md`
- Lorebook directory: `reference/content/lorebook.md`
- Manual directory: `reference/content/manual.md`
- Manuscript directory: `reference/content/manuscript.md`
- Simulation directory: `reference/content/simulation.md`
- Content references: `reference/content/content-references.md`
- Information control: `reference/content/information-control.md`
- Content-node state compatibility: `reference/content/state.md`
- Retrieval: `reference/content/retrieval.md`
- Profile context memory: `reference/agent/profile-context-memory.md`
- Plot System: `reference/plot/system.md`
