# Skills

A Skill is a **reusable workflow card**: it tells an agent how a certain class of task should be done.

It is not a tool and not a script. An agent sees which Skills are available in the `SkillCatalog` and opens the matching `SKILL.md` with `read` when it needs the procedure — **so a Skill is always Markdown you can open and read, never an invisible black box**.

## Built-in Skills

### Writing Flow (use in order)

| Skill | What it does |
| --- | --- |
| `novel-guide` | **The overview roadmap.** Read it first when you are not sure which skill applies now |
| `novel-idea-exploration` | Idea exploration: genre, rough plot, giving shape to a vague world |
| `novel-setup` | The four project setup phases: project init → worldbook skeleton → character design → World Engine init |
| `novel-writing` | The writing loop controller: story design → sign off and commit → prose / review / revision. The golden opening three chapters are its first-round specialization |
| `novel-writer-execution` | The detailed execution manual for a writer that has received an assignment |

### Always Available

| Skill | What it does |
| --- | --- |
| `novel-genre-research` | Genre and competitor analysis, wired to ranking data |
| `novel-data` | Queries locally cached novel rankings and book details for genre analysis |
| `novel-technique-character-card-workshop` | Heavyweight character building and character sheet curation |
| `llmlint` | Prose style checking and repair, see [llmlint](/en/core/llmlint) |
| `stop-slop` | Strip the AI voice while you write |

### Import Tools

| Skill | What it does |
| --- | --- |
| `novel-import-silly-tavern-card` | SillyTavern character card / worldbook / preset import |
| `novel-import-tomato-reference` | Import external novels from epub or downloader output |

### For Developers

| Skill | What it does |
| --- | --- |
| `profile-system-guide` | A system tour of the Harness, TSX profiles and ProfileTurnPlan |
| `tsx-profile-editing` | Editing TSX profiles, see [Write a Profile from Scratch](/en/profile-tsx/authoring) |
| `skill-creator` / `skill-creator-zh` | Creating and maintaining Skills themselves |

### Legacy

`RP模式` serves the retired RP entry points. It is preserved but currently unusable.

## Where Skills Live

Skills are addressed by directory name, and that directory name is the skill id:

| Layer | Location |
| --- | --- |
| System built-in | Ships with NeuroBook |
| User layer | `.nbook/agent/skills/<id>/SKILL.md` under the Workspace Root |

A user-layer directory replaces the built-in skill of the same name wholesale; the two are never merged file by file.

`SKILL.md` declares `name` and `description` in frontmatter — **the description is what makes an agent think of using it**, so spell out when it applies instead of just naming the feature. To show a Chinese label in the interface, keep `name` as the lowercase English id and put the Chinese name in `metadata.displayName`.

## Runnable Skills

Some Skills ship their own CLI; `llmlint` is one. These are called runnable skills and have a formal package contract: the version in `package.json` is the SemVer source of truth, and the catalog reports the version and the root path. Their `node_modules` does not enter managed assets, and first use goes through a dependency install gate.

## Visible ≠ Usable

A profile can declare an allowlist with `skills.include`. **Seeing it in the catalog does not mean it can be used** — the allowlist is filtered uniformly in the prepare layer. For example, the allowlist of `leader.assets` holds only four asset-editing skills.

## Skill vs. Workflow vs. Tool

| | What it provides | When to use it |
| --- | --- | --- |
| **Tool** | One atomic capability | Read a file, write a slice, call a child agent |
| **Skill** | Knowledge and method | "What steps this kind of task takes and what to watch for" |
| **Workflow** | Fixed execution orchestration | Steps are settled and you need concurrency, loops or a state chart |

Do not build a workflow just to package a block of instructions. That is a Skill's job.

## Keep Reading

- [Agent Tools](/en/agent/tools)
- [Workflows and Jobs](/en/agent/workflow)
- [Skill Package Contract](https://github.com/notnotype/neuro-book/blob/master/reference/agent/skill-package.md)
