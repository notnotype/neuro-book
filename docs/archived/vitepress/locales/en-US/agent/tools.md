# Agent Tools

Agent tools are the capabilities a model can ask to have executed. NeuroBook's tools are designed so an agent can read and write the project inside clear boundaries, call specialized agents, move the world and the story forward, and leave a traceable session record.

Each profile decides what it may use through a tool allowlist. **No profile has every tool** — writer does not get the plot write tools, world.engine does not get the web tools. That is design, not an oversight.

## The Full Tool List

| Group | Tools | Notes |
| --- | --- | --- |
| Files | `read` `write` `edit` `apply_patch` `bash` | Read and write files, run commands |
| Collaboration | `create_agent` `invoke_agent` `get_agent` `get_agent_profile` `get_session` `detach_agent` | Create and call linked agents |
| Control | `request_user_input` `switch_mode` | Ask the user a question, request a mode switch |
| Tasks | `task_create` `task_set_status` | The in-session task list |
| Plot (read) | `get_story_tree` `get_story_thread` `get_story_scene_context` `get_scene_world_context` `get_story_chapter` `get_chapter_writer_brief` `get_story_promise` `get_story_decision` | Omit the id to get a list |
| Plot (write) | `save_story_act` `save_story_chapter` `save_story_thread` `save_story_scene` `save_story_promise` `save_promise_beat` `save_story_decision` | Require an `action` enum, including lifecycle actions |
| World Engine | `execute_world` | A single CodeAct tool, in readonly and readwrite forms |
| Workflow | `run_workflow` `list_workflows` | Trigger and list available workflows |
| Background jobs | `list_jobs` `get_job` `cancel_job` | Long-task lifecycle |
| SQL | `execute_sql` | Only touches the current project's `project.sqlite` |
| Web | `web_search` `web_fetch` | Usually granted only to researcher |
| Topic research | `novel_rankings` `novel_book_detail` | Ranking snapshots and book details, read-only |
| Subject memory | `subject_rag_search` `subject_event_append` `subject_memory_update` | Legacy system, see below |
| Result | `report_result` | Return a structured result |

Every tool must **declare explicitly** at definition time whether it mutates the workspace. Tools declared as mutating (the file writes plus the seven plot write tools: six `save_story_*` plus `save_promise_beat`) are intercepted in read-only mode and require approval — see [Three Modes](/en/agent/modes).

## File Tools

Reach for the file tools first on ordinary file work:

- `read`: read a file's contents.
- `write`: create a file, or rewrite one completely.
- `edit`: make a precise change to an existing file.
- `apply_patch`: Codex-style patches, for a single cohesive patch.
- `bash`: search, build, test, run scripts and the workspace CLI.

The rule is simple: read files with `read`, search with `rg`, change files with `edit` / `write` / `apply_patch`. Do not string together risky shell write commands in place of the file editing tools.

`read`, `write`, `edit`, `apply_patch` and the subject file tools all go through one file authorization path: resolve the file address, check that the target project is open, and verify that the real path has not escaped its own root through a symlink or junction. Cross-project access must use the full `workspace/<project>/<relative-path>` address.

`bash` is the explicit exception: it is a trusted full shell. The system only uses `authorizeProcessCwd()` to confirm the current project is open and the cwd is trusted. It makes no promise to restrict file access inside the command, and discuss / plan mode adds no extra bash approval.

## Agent Collaboration Tools

`leader.default` can create or call linked agents:

- `get_agent_profile`: look at the target profile's capabilities, input/output and tool permissions first.
- `create_agent`: create a new linked session.
- `invoke_agent`: call an existing linked agent.
- `get_agent` / `get_session`: inspect the current linked agent or session metadata.
- `detach_agent`: drop the link without deleting the session.

In practice, do not create an agent for a simple task just for the form of it. Create or reuse a linked agent only when a specialized profile such as writer, retrieval, researcher or an RP actor clearly reduces context pollution or muddled responsibility.

The current contract of the collaboration tools:

- `get_agent_profile({ profileKey })` returns `creationMode`, `createAgentAllowed`, `InitialSchema`, `PayloadSchema`, `OutputSchema` and `toolKeys`; it does not return profile source code or the report schema.
- `create_agent({ profileKey, initial })` can only create linked sessions whose `creationMode=public`, validated against `InitialSchema`; `initial` must be a real JSON object. `system_only` profiles are created only by internal Harness flows.
- `invoke_agent({ sessionId, mode, message, input, title, model?, background? })` calls an existing session. `message` is a natural language string; `input` is this turn's payload object and is validated against the target `PayloadSchema`. `model` must come from the model list the agent can see, and it overrides this call only — it does not change the session's default model.
- `prompt` / `steer` / `followup` may pass `message` alone or `input` alone; `continue` accepts neither `message` nor `input`.
- The tool body of a synchronous `invoke_agent` is the normalized final text; `details` always provides `{ status, data, finalMessage, sessionId }`, optionally with `stats` / `error`. `finalMessage` prefers `report_result.result` and otherwise falls back to the last assistant text; with no structured result, `data` is `null`.
- `background: true` returns `{ jobId, status: "started", data: null, finalMessage: "", sessionId }` immediately, and the final result flows back in a later message. Once started, end the current turn normally — do not spin on `get_job`.
- When initial / payload / report data validation fails, you get field errors carrying a JSON Pointer. Fix the object at that path; do not stringify the object and retry.

## World Engine Tools

The World Engine has exactly one tool, `execute_world`, a controlled code sandbox whose API falls into four groups: `world.time.*`, `world.subject.*`, `world.search.*` and `world.slice.*`.

**The read/write split is a hard boundary**: leader and `world.engine` run in readwrite mode; **writer runs in readonly mode and never gets `world.slice.write` / `editPatches` / `delete` injected**. The agent writing prose can look world state up but cannot change it.

Inside the sandbox, time converts between text and the internal tick with `world.time.parse` / `format`. A moment can carry only one slice, so several changes at the same moment must merge into a single patch array. See [World Engine](/en/core/world-engine).

## Plot Tools

The read tools all share the `get_story_*` prefix, and **omitting the id puts them in list mode**. The write tools are collapsed into `save_*` plus a required `action` enum — besides create and update, the lifecycle actions (archive, abandon, fulfill, sign off, void) go through action too.

**Hard deletes are not exposed to agents.** The most an agent can do is a soft delete (archive or abandon); deleting data is something you do yourself in the UI.

## SQL

`execute_sql` only touches the `.nbook/project.sqlite` of the current Project Workspace, for structured data such as the plot structure. Prose, the worldbook and ordinary Markdown files must still be read and written through the file tools.

## Subject Memory Tools

The Subject RAG data and its dedicated tools are still here:

- `subject_rag_search`: searches the current subject's `events.jsonl` and `memory.jsonl`. It requires a configured embedding service and fails loudly when there is none — no keyword fallback.
- `subject_event_append`: appends a valid line to `events.jsonl` and marks the matching RAG source dirty.
- `subject_memory_update`: hands this turn's array of subject-facing facts to the `memory.curator` profile, which produces a JSON Patch; the tool layer validates it and writes it back to `memory.jsonl`.

The built-in `simulator.actor` today exposes only `report_result` and never calls these tools by itself; the repository ships no automatic memory consumer. In future this should be wired up by an explicit workflow or job inside a controlled boundary. The tools are still not meant for full project-wide RAG, and an actor must never be allowed to read another subject's private memory. On the subject side, `events.md` / `knowledge.md` are an old contract: the current tools neither read them nor migrate them automatically.

## Skills Are Not Tools

There is no separate `skill` tool. An agent sees the available Skills in the `SkillCatalog` and opens the matching `SKILL.md` with `read` when it wants one.

That keeps a Skill a readable workflow rather than an invisible black-box script.

## Keep Reading

- [Workflows and Jobs](./workflow.md): `run_workflow` and background jobs.
- [Three Modes](./modes.md): how write tools are gated in read-only mode.
- [World Engine](/en/core/world-engine): the model behind `execute_world`.
- [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/leader-default.md)
- [Project Workspace Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/project-workspace-guide.md)
- [Agent Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md)
