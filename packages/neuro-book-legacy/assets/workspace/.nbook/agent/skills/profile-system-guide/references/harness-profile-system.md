# Harness And Profile System Reference

Read this reference when a user asks how Neuro Book's agent harness, TSX profiles, `ProfileTurnPlan`, skills, or user-assets profile overlays actually work. Keep explanations user-friendly, but use the exact terms below when editing files or diagnosing runtime behavior.

## Table Of Contents

- Mental model
- Current architecture
- Session truth
- Invoke lifecycle
- Profile contract
- Settings resolution
- Profile home lifecycle
- ProfileTurnPlan sections
- TSX DSL nodes
- Reminder and Watch state
- Skills and profiles
- User-assets overlay
- Compile, preview, and run
- Common troubleshooting
- Source index

## Mental Model

- Profile: the agent recipe. It defines the agent name/key, creation input, optional output shape, visible tools, and how to prepare context before each run.
- Harness: the runner. It owns sessions, calls the profile, writes pre-loop messages, starts the model/tool loop, streams events, and saves final messages.
- Session: the append-only record. It stores chat messages, visible profile messages, state changes, custom state, compaction, and the current active branch.
- Skill: a workflow note that the agent may read from the skill catalog. A skill is not a profile and does not start an agent by itself.
- user-assets: the editable user overlay under `workspace/.nbook/...`. System baselines live under `assets/workspace/.nbook/...`.
- Workspace Root `.nbook`: `workspace/.nbook/`. It stores Global Config, user agent assets, and user overrides.
- Project Workspace: `workspace/{project}/`. It stores manuscript, lorebook, Project Config, and Project SQLite for one project.

Useful ordinary-user explanation:

> Profile 是 agent 的配方，harness 是照着配方做菜的运行器，session 是每一步留下来的流水账，skill 是一本可按需翻开的操作说明书。

## Current Architecture

Current active stack:

- Active backend: `server/agent`.
- HTTP entry: `/api/agent/sessions/**`.
- Profile roots:
  - system: `assets/workspace/.nbook/agent/profiles`
  - user: `workspace/.nbook/agent/profiles`
- Skill roots:
  - system: `assets/workspace/.nbook/agent/skills`
  - user: `workspace/.nbook/agent/skills`

Neuro Book borrowed Pi's message, event, tool, and append-only session ideas, but it owns its own `NeuroAgentHarness`. Do not tell users that the app simply embeds the Pi coding agent. The current design is Pi-compatible at the message/event level and Neuro-Book-specific at the product harness level.

## Session Truth

The session JSONL append-only tree is the source of truth. Branch switching moves the active leaf; it does not delete old history.

Important entry kinds:

- `message`: model-visible user / assistant / toolResult messages.
- `custom_message`: profile or harness messages. When `visibleToModel: true`, they enter model context and the frontend history.
- `custom`: reduced into `ctx.session.customState`, for example `agent.tasks`, `agent.mode`, `plot.selection`, and `profileState.<profileKey>`.
- `session_update`: title and summary changes.
- `model_change`, `thinking_level_change`, `profile_change`: per-session runtime configuration.
- `compaction`: summarized history and retained tail boundary.
- `invocation_lifecycle`: start/end/error/aborted markers.
- `leaf`: current active branch pointer.

The reducer builds `NeuroSessionContext` with:

- `messages`
- `customState`
- `linkedAgents`
- model, thinking level, profile key, title, summary, agent mode (normal/discuss/plan), workspace root, and other session state

If something should be visible in frontend history and replayable after refresh, it must be written as a session entry. Model-only context is invisible to the stable chat history.

## Invoke Lifecycle

Prompt invocation order:

1. Harness writes `invocation_lifecycle:start`.
2. Harness constructs the pending user message, but does not write it yet.
3. For `continue + resolution`, harness first writes the toolResult resolution.
4. Harness reads and reduces the current session.
5. Harness calls the profile and gets `ProfileTurnPlan`.
6. Harness writes pre-loop profile content in this order:
   - `historyInitMessages`
   - `modelContextAppendingMessages`
   - `appendingMessages`
   - `stateWrites`
7. Harness writes the pending user message.
8. Harness reduces the session again.
9. Harness may compact context if needed.
10. Harness builds final ReAct input from reduced session messages plus `modelContextMessages`.
11. ReAct loop streams assistant/tool events.
12. `message_end` persists assistant and toolResult messages.
13. Profile runtime hooks (for example `settleRun` stages declared through `defineAgentRuntime`) run after the loop.
14. Harness writes lifecycle end/error/aborted.
15. Steer queue drains at safe points before the next model call when possible.
16. Follow-up queue drains after the current loop truly ends, one item at a time.

Frontend effect:

- Appending/profile reminders can appear before the user's message.
- Then the user's message appears.
- Then the live assistant stream appears.
- `System` and plain `ModelContext` do not appear as chat messages.
- `steer` and `followUp` are harness/Composer control-plane operations. Profiles should not pretend to implement those queues in prompt text.

## Profile Contract

Profile modules use TypeBox and `defineAgentProfile`:

```ts
defineAgentProfile({
    manifest, // key/name/description, optional version (positive integer, drives home upgrade)
    initialSchema,
    payloadSchema, // optional per-invocation payload schema
    outputSchema,
    settingsForm, // optional low-code settings form (defineLowCodeForm)
    home, // optional profile home lifecycle (defineProfileHome)
    skills, // optional skill catalog whitelist: {include: ["key-a"]}
    tools,
    toolKeys, // optional execution subset
    context, // recommended
    prepare, // advanced
    runtime, // optional runtime hooks (defineAgentRuntime)
});
```

Rules:

- `context(ctx) => JSX` is the normal authoring path.
- `prepare(ctx) => ProfileTurnPlan` is the low-level override path.
- `context` and `prepare` are mutually exclusive.
- Tools visible to the model come from root `tools`, not from `prepare`.
- `toolKeys` and sidecar `toolKeys` can only reference keys already present in root `tools`.
- `InitialSchema` validates agent/session creation input. It is not the per-turn user prompt.
- `InitialSchema = Type.Object({})` means the agent does not need special creation input.
- `PayloadSchema` validates the optional per-invocation `invoke_agent.input` payload.
- `OutputSchema` describes `report_result.data`. The report protocol is enabled only when root `tools` contains `report_result`.
- `OutputSchema = Type.Object({})` plus `report_result` means the final report has `result` text but no extra structured data fields.
- `OutputSchema` without `report_result` is just metadata until a profile allows that tool.
- `skills.include` filters the prepare-time `ctx.skills` snapshot to the listed keys. All consumers (`<SkillCatalog />`, custom text functions) see the same filtered list. It is catalog visibility only, not file-level permission isolation.

`ctx.runtime.pendingUserMessage` may be available during prompt mode. It lets the profile inspect the current user input before it is written to session. The harness still writes the user message after profile pre-loop writes.

Invocation context:

- `ctx.initial` is profile creation input. It is not the every-turn user prompt and it does not carry browser state.
- `ctx.invocation` may carry one-turn invocation data such as `payload` and current frontend client state.
- `ctx.settings` is the merged settings-form value (defaults -> Global Config -> Project Config). Empty object when the profile has no `settingsForm`.
- `ctx.home` is the profile home facade when a home is declared; project sessions read project-first with global fallback.

## Settings Resolution

`settingsForm` is declared with `defineLowCodeForm({schema, defaults, fields, validate})`:

- Stored values live in config files, keyed by `agent.profiles.<profileKey>.settings`:
  - Global: `workspace/.nbook/config.json`
  - Project: `workspace/{project}/.nbook/config.json`
- Effective value = `defaults` merged with Global settings, then Project settings. Project fields override global fields of the same name.
- The settings dialog's Agent Profile panel renders the form for both scopes; `hasSettingsForm` in the catalog snapshot tells the UI whether a profile has one.
- `validateLowCodeFormValue(form, value, {profileKey, scope, home})` validates a candidate value; save rejects invalid settings, and a corrupted stored value falls back to `defaults` at runtime.
- `resource-preset` fields (`profileHomeResource({directory, extension, template})`) select `.md` resources from the profile home; the form persists only the selected key. First version does not support subdirectories.

## Profile Home Lifecycle

`home: defineProfileHome({init, upgrade, reset})` manages a per-profile default resource directory:

- Global home root: `workspace/.nbook/agents/{profileKey}/` (safe-encoded profile id).
- Project home root: `{Project Workspace}/agents/{profileKey}/`.
- Project sessions read layered: project home first, global home fallback. Writes go to the primary layer only. Global Config editing uses the global home only.
- `home.json` records `{profileKey, version, initializedAt, updatedAt}`. Runtime-managed; do not hand-edit.
- Lifecycle: missing/absent metadata triggers `init`; recorded version lower than `manifest.version` triggers `upgrade(ctx, oldVersion, targetVersion)`; explicit reset triggers `reset` (typically `clear()` then re-init).
- Upgrades should use `writeText(..., {mode: "create"})` so existing user files are preserved and only missing defaults are added.
- Example: writer declares `home` and seeds `styles/<key>.md` / `references/<key>.md` from the system preset sources (`assets/workspace/.nbook/agent/profiles/builtin/writer.home/{styles,references}` plus user same-path overrides); leader.default seeds `personas/`.

## ProfileTurnPlan Sections

Current shape:

```ts
type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    modelContextAppendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    stateWrites?: SessionEntryDraft[];
};
```

Section meanings:

- `systemPrompt`: provider-level system prompt. It is not a session message.
- `historyInitMessages`: initial model-visible history. Harness writes it only when the active path has no model-visible message.
- `appendingMessages`: visible pre-loop session messages. This is the normal profile/user layer append channel.
- `modelContextAppendingMessages`: messages produced by `Reminder` inside `ModelContext`. They are written like appending messages and can show in the frontend.
- `modelContextMessages`: model-only messages for the current provider call. They are not persisted and not shown in frontend history.
- `stateWrites`: controlled session state writes. Current profile runtime only allows `custom profileState.<profileKey>` for Reminder/Watch state.

Do not return old fields such as `toolKeys`, `messages`, `contextMessages`, or `dynamicMessages`.

## TSX DSL Nodes

Active core nodes:

- `<ProfilePrompt>`: root node.
- `<System>`: builds `systemPrompt`; accepts string fragments only.
- `<HistorySet>`: first-run initial context.
- `<AppendingSet>`: visible pre-loop session append.
- `<ModelContext>`: model-only context; `Reminder` inside it may still append visible messages.
- `<Message>`: user-style message. `role="system"` is forbidden.
- `<AIMessage>`: assistant example message.
- `<ToolCall>`: child of `AIMessage`.
- `<ToolResult>`: matching tool result example.
- `<Reminder>`: stateful reminder.
- `<Watch>`: observes a value/path and renders when it changes.
- `<If>`: condition false means children are not rendered and do not touch state.
- `<SkillCatalog>`: string fragment with available skills.
- `<ActivatedSkills>`: string fragment for explicitly mentioned skills.
- `<AgentCatalog>`: string fragment with available agent profiles and schema summaries.
- `<SqlSchemaSummary>`: string fragment with database schema summary for SQL guidance.

Convenience string/reminder nodes also exist in the runtime, including `SystemReminder`, `Import`, `LinkedAgentsSummary`, `LinkedAgentsReminder`, `RuntimeLocationReminder`, `WorkspaceFocusReminder`, `TaskReminder`, `ModeReminder`, `ModeAvailabilityReminder`, `ModeSlot`, and `MentionedSkillsReminder`. `<SkillCatalog mode="userAssets" />` switches the default catalog text to the Workspace Root `.nbook` cwd wording for user-assets profiles.

Old name:

- `DynamicSet` is removed. Use `<ModelContext>`.

Placement guidance:

- Put stable identity and behavior in `<System>`.
- Put initial examples/background in `<HistorySet>`.
- Put user-visible runtime reminders in `<AppendingSet>`.
- Put one-run-only model context in `<ModelContext>`.
- Put catalog fragments inside `<Message>`, `<System>`, or another node that accepts string children.
- Do not use `<Message role="system">`.

## Reminder And Watch State

`Reminder` and `Watch` store profile runtime state in:

```text
custom entry key: profileState.<profileKey>
```

Current practical rules:

- `Reminder` can be used in `AppendingSet` or `ModelContext`.
- `Watch` can be used in `AppendingSet` or `ModelContext`.
- `Reminder` may use variable `watchPath`, function `watch`, `watchValue`, and `repeatEveryTurns`.
- `Watch` may use a variable `path`, explicit `value`, children, or `render(change)`.
- `repeatEveryTurns` counts real prompt user messages, not appending messages or harness reminders.
- `If` false does not render children and does not update Reminder/Watch state.

Explain to users:

- Reminder is "show this reminder only when the runtime says it is useful."
- Watch is "notice that a variable path or explicit function value changed, then show related context."

Path guidance:

- `watchPath` and `Watch path` are variable paths such as `client.currentProjectWorkspace`, `global.userPreferences`, `project.affections`, or `session.draftGoal`.
- Use function watches for non-variable facts such as `ctx.session.agentMode` or a custom fingerprint.
- Do not use old roots such as `ctx.workspace` or `ctx.input.studio`.

## Skills And Profiles

Skills are discovered by directory key:

- system first: `assets/workspace/.nbook/agent/skills/<skillKey>/SKILL.md`
- user overlay second: `workspace/.nbook/agent/skills/<skillKey>/SKILL.md`
- same key means the whole user skill directory overrides the system skill directory

Model-visible skill catalog is produced by `<SkillCatalog />`. The current runtime does not expose a separate `skill` tool. The agent should use the catalog `location` and the normal `read` tool to open the relevant `SKILL.md`. If that entry points to references, scripts, templates, or examples, read only the specific relative files needed for the task.

A profile can narrow its own catalog with `skills: {include: [...]}` in `defineAgentProfile`. The prepare-time `ctx.skills` snapshot is filtered before any consumer sees it, so `<SkillCatalog />` and custom catalog text stay consistent. This whitelist controls model visibility only; the file tools can still read any skill directory.

Current runtime discovers profile source files, but it only runs fresh `.compiled` artifacts. Source files are the editing truth, while compiled artifacts are the runtime truth. A loaded profile becomes runnable through its `manifest.key`. Bad, uncompiled, or stale profile files should be fixed through source editing and compile diagnostics; they are not normal runnable catalog items.

## User-Assets Overlay

System baselines:

- profiles: `assets/workspace/.nbook/agent/profiles`
- skills: `assets/workspace/.nbook/agent/skills`
- writer system preset sources: `assets/workspace/.nbook/agent/profiles/builtin/writer.home`
- variable definitions: `assets/workspace/.nbook/agent/variables`
- templates: `assets/workspace/.nbook/templates`

User editable overlay:

- profiles: `workspace/.nbook/agent/profiles`
- skills: `workspace/.nbook/agent/skills`
- global profile home (per profile): `workspace/.nbook/agents/{profileKey}`
- project profile home (per profile): `{Project Workspace}/agents/{profileKey}`
- profile settings values: `workspace/.nbook/config.json` and `workspace/{project}/.nbook/config.json` under `agent.profiles.<key>.settings`
- variable definitions: `workspace/.nbook/agent/variables`
- templates: `workspace/.nbook/templates`

Overlay rules:

- Prefer editing the user path.
- System path is the built-in baseline.
- User profile with the same relative path/key shadows the system profile.
- Builtin profile keys have locked Input/Output schema contracts. User overrides may change implementation and tool list, but should not redefine the builtin schema shape.
- User profiles are trusted local code, not sandboxed plugins.
- System profile sync copies missing files and can update unmodified user copies using sync metadata. If a user file was hand edited or lacks sync state, do not overwrite silently.
- user-assets is not a Project Workspace. Do not put manuscript, lorebook, project plot data, or Project SQLite changes under `workspace/.nbook`.
- Project SQLite lives under `workspace/{project}/.nbook/project.sqlite` and belongs to the Project Workspace.

When explaining restore:

- "恢复系统版本" usually means replace or remove the user override so the system baseline is used again.
- Always say if this will discard the user's custom changes.

## Compile, Preview, And Run

Workbench compile:

- UI saves the source and runs background compile.
- Successful compile writes the profile root `.compiled` artifact and manifest.
- It can also produce prepare preview for the current profile.
- Ordinary users should not be asked to call the HTTP endpoint manually.

Agent runtime CLI:

- `profile status`: shows source/compiled status, stale/not compiled/load failed, and sync warnings.
- `profile check`: validates saved source and contract without writing `.compiled`.
- `profile compile`: compiles saved source from disk and writes `.compiled`.
- `profile preview`: dry-runs saved source through `prepare()` and shows `systemPrompt`, HistorySet, AppendingSet, ModelContext, `stateWrites`, final ReAct messages, and `report_result` schema. It does not write `.compiled`.

Developer source-tree checks:

- Repository-root `scripts/` are for development and deployment, not the Agent runtime contract.
- Old repository-root profile scripts such as `scripts/compile-profile.ts`, `scripts/check-profile.ts`, and `scripts/profile-compile-cli.ts` have been removed. Do not present them as the normal user-assets Agent workflow.

Run/create session:

- A profile is runnable only when the runtime catalog can load a fresh compiled artifact for it.
- Creating a session uses `/api/agent/sessions` and a `profileKey`.
- "New profile can run immediately" means: after compile passes and the profile contract is correct, the UI or API can create a session with that `profileKey`. It does not mean the Workbench automatically opens a session.

Planned `.compiled` artifact layout:

- system artifacts: `assets/workspace/.nbook/agent/profiles/.compiled/`
- user artifacts: `workspace/.nbook/agent/profiles/.compiled/`
- system artifacts ship with system assets and Docker images
- user artifacts are generated at runtime by Workbench or `profile compile`
- `.agent/workspace/profile-module-cache` is not the runtime contract

Type artifacts:

- Hash or fixed `.types.d.ts` outputs are authoring aids for profile TSX autocomplete.
- Missing or stale type artifacts should not change runtime variable truth.
- Runtime truth is the registry, TypeBox schema validation, `variables.json`, and session JSONL.

## Common Troubleshooting

Saved file but agent still fails:

- Saving only writes the source file.
- Compile/runtime catalog decides whether it can run.
- Use Workbench compile, `profile compile`, or `profile status`.
- Use `profile preview` when the user wants to inspect prepared context without changing runtime artifacts.

- Use `--strict-variables` in profile checks when literal path mistakes should fail fast.

Content does not show in frontend history:

- `<System>` is provider-level only.
- plain `<ModelContext>` is model-only.
- use `<AppendingSet><Message>...</Message></AppendingSet>` when the user should see it in the session.

Agent cannot use a tool:

- Check root `tools`.
- Check `toolKeys` and sidecar `toolKeys`.
- Check the actual tool registry.
- Tools are not returned from `prepare`.

Run error appears in the frontend:

- Harness writes `invocation_lifecycle.errorInfo`.
- Frontend projects it as a Run Error system card.
- If HTTP invoke returns an error and the snapshot does not contain the same run error, frontend may also show a notification as a fallback.

Steer or follow-up is confusing:

- `steer` is queued while a run is active and drains at a safe point before another model call.
- `followUp` is queued for after the current loop ends and starts a fresh loop.
- Idle sessions reject explicit `steer` / `followup`; late or aborting runs also reject new queue items.

History appears only on first turn:

- That is expected for `<HistorySet>`.
- It only writes when the active path has no model-visible message.

User override did not receive system update:

- User assets protect hand-edited files.
- Compare user file with system file.
- Restore explicitly if the user wants the system version.

`report_result` behavior is confusing:

- The tool must be in root `tools` to enable report completion.
- Sidecar structured output must use `report_sidecar_result.data`; validation errors are returned as tool errors so the model can retry.
- `OutputSchema = Type.Object({})` means walkthrough-only report data.
- No `report_result` tool means normal assistant completion is allowed.

## Source Index

Primary implementation files:

- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/profiles/types.ts`
- `server/agent/profiles/define-agent-profile.ts`
- `server/agent/profiles/profile-dsl.ts`
- `server/agent/profiles/profile-home.ts`
- `server/agent/profiles/catalog.ts`
- `server/agent/profiles/profile-http-service.ts`
- `server/low-code-form/`
- `server/agent/session/session-repo.ts`
- `server/agent/session/types.ts`
- `server/agent/skills/skill-catalog.ts`

Primary docs:

- `docs/profile-tsx/`
- `docs/research/pi-agent-harness.md`
- `.agents/tasks/02-pi-agent-harness-migration/README.md`
- `.agents/tasks/04-tsx-profile-workbench/README.md`
- `.agents/tasks/05-leader-profile-v2-adaptation/README.md`
- `.agents/tasks/58-agent-profile-settings-low-code/README.md`
- `.agents/tasks/60-agent-profile-home/README.md`
- `.agents/tasks/68-global-profile-home-resource-preset/README.md`
- `.agents/tasks/archived/user-assets-workspace/README.md`
- `reference/workspace/TERMS.md`
