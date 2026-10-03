# Manual Directory

`manual/` stores human-facing handbooks for play, onboarding and tabletop-style RP operation. It is the readable entry for players, GMs and authors; RP-facing agents may read it to communicate in human tabletop terms.

It is not a content node root. `manual/index.md` may carry directory display frontmatter for the file tree; other files under `manual/` are ordinary Markdown files unless a future tool explicitly says otherwise.

## Default Shape

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
        |-- README.md
        `-- player.md
```

## Files

| Path | Purpose |
| --- | --- |
| `README.md` | Manual entry, reading order, quickstart and the current Project RP entry. |
| `world-guide.md` | Player-safe world overview: tone, regions, major factions, common knowledge and taboos. Link to `lorebook/` for stable canon. |
| `rules-guide.md` | Stable play rules and system-module overview: actions, adjudication principles, failure cost, resources, growth, travel, economy and combat abstraction. |
| `gm-guide.md` | Human GM handbook: first session, scene rhythm, NPC play, companion mode, table tone, spoiler policy and recording boundaries. |
| `reference.md` | GM screen: common rules, quick tables, difficulty, travel, economy, combat flow, spoiler hints and source categories. |
| `player-guide/README.md` | Player handbook. It only contains player-visible information, starting identities, basic actions, character selection or creation and spoiler boundaries. |
| `player-guide/character-creation.md` | Player-safe character creation guide. It explains what can be chosen before play, what world facts may be disclosed during creation, and what hidden truth must remain unrevealed. |
| `player-guide/playable-characters/README.md` | Playable character index. It lists preset characters and explains how to start from one quickly. |
| `player-guide/playable-characters/player.md` | Default playable character sheet. It lets a Project start without manual character creation. |

## Boundary

Use `manual/` for:

- Quickstart instructions and reading order.
- Player-visible handbooks.
- Player-safe character creation guidance.
- Human GM / RP host handbooks.
- Rule summaries and adjudication entry points.
- System module overviews.
- Links to stable lorebook entries that explain the actual canon.

Do not use `manual/` for:

- Stable canon that should be queried as world truth. Put that in `lorebook/`.
- Current run state, tick logs or combat-in-progress state. Put that in `simulation/`.
- Profile-private memory or project guidance. Put that in `agents/{profile}/`.
- Raw imports, card archives or low-confidence migration reports. Put those in `reference/`.
- Formal prose. Put that in `manuscript/`.

`manual/` may summarize canon, but it should link to `lorebook/...` instead of duplicating large source material. If a summary and lorebook canon disagree, `lorebook/` is the source of truth for world facts.

## File Count Policy

The default template should be complete enough to play, but it should not pre-create every tabletop RPG supplement structure.

Rules:

- Keep top-level files grouped by reader task: start, world, rules, GM, quick reference and player.
- Do not split a file just because tabletop books often split that topic.
- Create a subdirectory only when there will be multiple independent entries or a script-managed collection.
- Keep `manual/adventures/`, `manual/random-tables/`, `manual/cheatsheet/` and `manual/combat/` out of the default template until a Project needs them.

## RP Mode

`rp.leader` is the canonical runtime RP host profile name. `manual/gm-guide.md` is the human-facing Project-level handbook for tabletop-style hosting.

`simulator.leader` remains the world simulation and adjudication owner. `rp.leader` may call or hand off to `simulator.leader`, but it should not silently rewrite simulation state itself.

`manual/player-guide/` is player-safe. Hidden truth, unrevealed secrets and private subject state do not belong there.

## CLI-Managed Material

Random tables, cheat-sheet entries and combat modules can later be managed by CLI tools. Until then:

- Describe enabled modules in `manual/rules-guide.md`.
- Link quick-use entries from `manual/reference.md`.
- Store current state and logs in `simulation/`.
- Store stable system truth in `lorebook/system/` or the appropriate lorebook type.
