# Simulation Directory

`simulation/` stores legacy / RP world runtime state and simulation artifacts. It is **not** the default writing-mode state source.

> **Boundary with World Engine (写作模式状态真相源).** In writing mode, the dynamic world state and timeline source of truth is **World Engine** (see [../world-engine/README.md](../world-engine/README.md)), not `simulation/`. The writing-mode prompt layer does not drive world state through `simulation/` or the legacy simulation workflow. `simulation/subjects/` six-file directories remain in place for RP mode, subject RAG memory and subject-system discovery, but writing-mode skills and the default leader record world state via World Engine tools, not by editing `simulation/`. Treat the legacy simulation workflow and the Plot system as out-of-scope for writing mode; do not route writing-mode world-state changes through them. RP mode and `simulator.leader` continue to use `simulation/` as documented below.

## Default Shape

```text
simulation/
|-- subjects/
|   `-- {subject-id}/
|       |-- subject.md
|       |-- soul.md
|       |-- events.jsonl
|       |-- memory.jsonl
|       |-- mind.md
|       `-- state.md
|-- entities/
|   `-- {entity-id}/
|       |-- entity.md
|       |-- events.md
|       `-- state.md
`-- runs/
    |-- current.md
    |-- index.md
    `-- ticks/
```

`roleplay/` is the old directory name. The current target directory is `simulation/`.

Old directory migration:

```text
roleplay/                 -> simulation/
roleplay/actors/{id}/     -> simulation/subjects/{id}/
roleplay/playthrough/     -> simulation/runs/
roleplay/gm.md            -> manual/gm-guide.md + agents/rp.leader/context.md for user-facing RP hosting
roleplay/gm.md            -> agents/simulator.leader/context.md for world simulation and adjudication rules
```

## Root Files

| Path | Purpose |
| --- | --- |
| `subjects/` | Information-control subjects, such as characters, the player, organizations or faction representatives. |
| `entities/` | Stateful instances, such as unique items, doors, mechanisms, event processes or locations with runtime state. |
| `runs/` | Tick logs, scratch notes, briefs and run artifacts. |

`actor` is a kind of simulator, not a top-level directory. Character-like simulators live under `simulation/subjects/`.

Profile-specific project guidance lives in `agents/`, not in `simulation/`. For example, `rp.leader` reads `agents/rp.leader/context.md`, and `simulator.leader` reads `agents/simulator.leader/context.md`. `rp.writer` does not bind its own context file at profile creation time; upstream coordinators must inject any relevant project guidance into each writer brief.

## Runtime Profiles

Current RP / simulation profile contract:

| Profile | Role | Reads | Writes |
| --- | --- | --- | --- |
| `rp.leader` | RP host and user-facing coordinator. It manages quickstart, table contract, companion-mode conversation, player-safe explanation and handoff to simulation. It may call `simulator.leader` for world adjudication instead of silently rewriting runtime state. | `AGENTS.md`, `manual/README.md`, `manual/player-guide/`, `manual/gm-guide.md`, `agents/rp.leader/context.md`, `agents/rp.leader/memory.md`, and user-approved context. | RP-facing notes only when explicitly requested or approved. Runtime state changes should be handed to `simulator.leader` or written only after clear user authorization and simulation contract review. |
| `simulator.leader` | Legacy / RP world simulator leader. It understands the task or user action, dispatches actor emulators, adjudicates the world, maintains state/entities, builds writer-safe brief and reports the result. | `AGENTS.md`, `agents/simulator.leader/context.md`, recent `simulation/runs/`, subject/entity state, Plot context and god-view lorebook / reference allowed by its context. | Approved subject `state.md`, `simulation/entities/`, necessary `simulation/runs/` and explicit simulation context changes. New subjects/entities should be reported before creation unless the current prompt explicitly grants automatic authority. |
| `simulator.actor` | Single-subject simulator. Its main run Imports `soul.md` (first-person roleplay handbook) as identity and consumes the current actor-facing packet. It never sees `subject.md` (god-view secret file). | Main run sees `soul.md`, actor binding metadata, the current actor-facing packet and any context explicitly injected by its caller. It does not automatically read subject files or query Subject RAG; its root tool set only contains `report_result`. | Main run does not write files. Subject memory maintenance is not automatic; retained memory tools can only be used by a separately authorized external process. |
| `rp.writer` | Tick prose renderer. It turns an upstream writer brief into user-visible prose through a multi-step pass: draft, stop-slop self-review, then write and polish. It keeps the small-cat writer preset and RP storytelling tone. | Profile initial is empty. It only consumes the current writer brief and reads extra paths when the brief explicitly asks it to. | Writes the final prose to the output path given in the writer brief (typically `simulation/runs/ticks/{id}-{slug}/prose.md`). Falls back to assistant-text prose only when the brief omits an output path. |

`simulator.leader` must not hand complete `simulation/`, `lorebook/` or `reference/` to actor / writer. It filters god-view context into actor-facing messages or writer briefs.

`rp.leader` is the only canonical name for the RP host layer. Do not introduce `rp.gm` or revive `leader.rp` as a new contract name. Historical mentions of `leader.rp` refer to an older implementation.

`simulator.leader` remains the simulation runtime owner. It is not a companion host profile, and `rp.leader` is not a replacement for world simulation adjudication.

## Subject To Actor Input

`simulator.actor` input is intentionally narrow:

```ts
type SubjectSimulatorInput = {
    subjectPath: string;
    kind: "player" | "npc";
};
```

`subjectPath` points to the subject directory relative to the current Project Workspace File Scope, such as `simulation/subjects/erina`. `kind` comes from the subject's `subject.md` frontmatter and selects the actor behavior rules (player avatar vs free-acting npc). The profile derives `subject.md`, `soul.md`, `events.jsonl`, `memory.jsonl`, `mind.md` and `state.md` from that directory; `soul.md` is Imported into the actor main run through an explicit Project File Address, while the remaining paths are binding metadata for an external memory flow and are not read automatically. Callers should not pass separate file paths.

## Subjects

`simulation/subjects/{subject-id}/` stores entities that can know, misunderstand, judge, act and hide information. The player character should also be a subject.

详细文件职责与分流规则见 [subjects.md](subjects.md)。

```text
simulation/subjects/{subject-id}/
|-- subject.md
|-- soul.md
|-- events.jsonl
|-- memory.jsonl
|-- mind.md
`-- state.md
```

| File | Purpose |
| --- | --- |
| `subject.md` | God-view secret file. Only `simulator.leader` may read it. Holds hidden truths, author intent and dispatch hints. Never injected into the actor. |
| `soul.md` | First-person roleplay handbook (no frontmatter). Imported directly into the actor main run as the character's identity. Contains only what the character knows about itself; no secrets. |
| `events.jsonl` | Append-only episodic memory. Each line is `{ tick?, time?, text }` and records what the subject experienced, observed, was told, thought, misunderstood or inferred at that time. |
| `memory.jsonl` | Editable stable memory. Each line is `{ topic, aliases?, view }` and records the subject's current view or understanding of a person, place, object, concept, organization or self-related stable constraint. |
| `mind.md` | Current short-term psychology, doubts, judgement, motivation and emotions. |
| `state.md` | Current location, visible condition, inventory summary, relationship pressure and short-term goals. |

## Subject RAG Memory

`events.jsonl` and `memory.jsonl` are the only subject files indexed by the first Subject RAG implementation. `subject.md` and `soul.md` are never indexed: `subject.md` holds god-view secrets and `soul.md` is already Imported into the actor main run. `subject_rag_search` treats `{project}/.nbook/subject-rag.sqlite` as a rebuildable SQLite + sqlite-vec cache; the JSONL files remain the source of truth.

The index is scoped by `subject_path` and `source_type`, so an authorized search caller can only recall the selected subject's own episodic memories and stable views. It does not search lorebook, Project-wide files or other subjects.

The Subject RAG index and memory tools remain available, but there is currently no built-in automatic consumer: invoking `simulator.actor` does not retrieve or persist memory by itself. A future authorized workflow/job may explicitly query memory before invoking the actor and maintain memory after it returns.

Embedding configuration is separate from Pi chat / vision model settings. Global Config owns the OpenAI-compatible embedding service; Project Config may only override embedding model and dimensions.

See [subject-rag-memory.md](subject-rag-memory.md) for the stable tool, index and configuration contract.

## Entities

`simulation/entities/{entity-id}/` stores stateful instances. Instantiation is for state tracking, not information control.

```text
simulation/entities/{entity-id}/
|-- entity.md
|-- events.md
`-- state.md
```

Create an entity when the object has:

- Independent state.
- Hidden truth.
- Unique or near-unique identity.
- Holder-specific differences.
- Damage, activation, progress, location or timer state.
- Major plot importance.

Do not instantiate every ordinary item. Three generic blood potions in an inventory can be an inventory count. A poisoned blood potion should become an entity.

## Runs

`simulation/runs/` stores tick artifacts for world simulation, RP, writing emulation or debugging. It is process record, not canon lorebook and not subject memory.

Recommended compact shape:

```text
simulation/runs/
|-- current.md
|-- index.md
`-- ticks/
    `-- 000001-short-slug/
        |-- report.md
        `-- prose.md
```

| File | Purpose |
| --- | --- |
| `current.md` | Current world time, active scene, active conflicts, recent tick summary and pending next steps. |
| `index.md` | Tick index table: id, title, mode, world time, status and summary. |
| `ticks/{id}-{slug}/report.md` | Background report: trigger, scope, causal chain, adjudicated events, information boundary, state commits, writer-safe brief, open questions and next hooks. |
| `ticks/{id}-{slug}/prose.md` | User-visible prose for an RP tick, writing sample or rendered scene. Formal chapter prose still lives in `manuscript/.../index.md`. |

Rules:

- `runs/` is not named `sessions/`, to avoid confusion with Agent Session.
- Tick directory names should use `000001-short-slug`.
- Subjects do not read full `runs/` by default.
- Results that need to persist should be curated into `simulation/subjects/`, `simulation/entities/`, Plot System or `lorebook/`.
- `report.md` writer brief must contain only writer-safe information.
- `prose.md` stores user-visible prose, not background adjudication.

## Classification Method

For a new concept, classify in this order:

1. Is it stable canon, subject-facing knowledge, entity runtime state, plot plan, run process artifact or raw external material?
2. Stable canon goes to the most fitting `lorebook/` type.
3. Subject-facing knowledge goes to `simulation/subjects/{id}/`. Split by visibility: what the character knows about itself goes to `soul.md`; hidden truths and author intent go to the god-view `subject.md`. See [subjects.md](subjects.md) for file architecture and [../agent/rp-tick/subject-creation-guide.md](../agent/rp-tick/subject-creation-guide.md) for creation flow.
4. Stateful instances go to `simulation/entities/{id}/`.
5. Runtime process goes to `simulation/runs/`.
6. Plot planning goes to Plot System.
7. Raw external material goes to Project Workspace `reference/`.
