---
name: profile-system-guide
description: Guide users and agents through Neuro Book harness, TSX profiles, ProfileTurnPlan, skills, user-assets overlays, settings forms, profile home resources, profile compile checks, templates, system restore, and safe profile editing.
when_to_use:
  - 用户想创建、修改、诊断或理解 agent/profile/.profile.tsx。
  - 用户问 harness、ProfileTurnPlan、ProfilePrompt、SkillCatalog、user-assets 或系统 profile 覆盖机制是什么。
  - 用户想理解或调整 profile 设置表单（settingsForm）、profile home 资源（人设/文风预设存哪、怎么加）。
  - 用户需要恢复系统版本、新建 profile 模板、编译检查或解释 profile 报错。
---

# Profile System Guide

Use this skill when helping users edit Neuro Book agent profiles. The user may not be a developer. Explain with simple words first, then mention exact file paths and commands only when they are useful.

For harness/profile architecture explanations, read `references/harness-profile-system.md` before answering. Keep `SKILL.md` as the workflow card and use the reference for exact runtime details. The runtime does not have a separate skill-loading tool; agents read this `SKILL.md` entry first, then read referenced files only when needed.

## Plain Explanation

- Profile is an agent recipe. It says who the agent is, which tools it may use, and what context it prepares before each run.
- Harness is the runner. It creates sessions, calls the profile, writes visible messages into the session, streams model/tool events, and saves results.
- Skill is a reusable workflow note. It teaches an agent how to do a kind of task, but it is not a profile and it does not run by itself.
- Settings form is a profile's low-code preference panel. The profile source declares which fields exist (`settingsForm`); the user fills values in the settings UI, and the values are stored in config files, not in the profile source.
- Common runtime settings are available for every profile and are not declared in `settingsForm`. Automatic summarization and the single-file change diff limit belong to this common layer.
- Profile home is a profile's default resource folder (personas, writing style presets, and similar `.md` resources). The profile source declares how to initialize it (`home`); users and agents edit the files inside it.
- User assets are the user's editable Workspace Root `.nbook` overlay. Prefer editing files under `workspace/.nbook/...`. System files under `assets/workspace/.nbook/...` are the built-in baseline.
- Saving a profile source file does not make it runnable. Compile means "turn the saved `.profile.tsx` recipe into the runtime artifact the catalog can load." It does not start a chat session.

## Important Paths

- Workspace Root `.nbook`: `workspace/.nbook/`
- User profiles: `workspace/.nbook/agent/profiles/`
- System profiles: `assets/workspace/.nbook/agent/profiles/`
- User skills: `workspace/.nbook/agent/skills/`
- System skills: `assets/workspace/.nbook/agent/skills/`
- Global profile home (per profile): `workspace/.nbook/agents/{profileKey}/`
- Project profile home (per profile): `{Project Workspace}/agents/{profileKey}/`
- Writer system preset sources: `assets/workspace/.nbook/agent/profiles/builtin/writer.home/{styles,references}/` (user same-path overrides under `workspace/.nbook/...` shadow them by file name)
- Global Config with profile settings values: `workspace/.nbook/config.json` (`agent.profiles.<key>.settings`)
- Global common runtime overrides: `workspace/.nbook/config.json` (`agent.profiles.<key>.summarizer.enabled` and `fileChangeNotice.diffMaxChars`)
- Project Config with profile settings values: `workspace/{project}/.nbook/config.json`
- Profile templates: `assets/workspace/.nbook/agent/profile-templates/`
- Content/project templates (not profile templates): `workspace/.nbook/templates/{content-node-templates,project-directory-templates}/`
- TSX profile authoring docs: `docs/profile-tsx/`
- TSX Profile Workbench task notes: `.agents/tasks/04-tsx-profile-workbench/README.md`
- Settings form task notes: `.agents/tasks/58-agent-profile-settings-low-code/README.md`
- Profile home task notes: `.agents/tasks/60-agent-profile-home/README.md`, `.agents/tasks/68-global-profile-home-resource-preset/README.md`
- Agent migration/runtime notes: `.agents/tasks/02-pi-agent-harness-migration/README.md`
- Workspace terms: `reference/workspace/TERMS.md`
- Detailed reference for this skill: `assets/workspace/.nbook/agent/skills/profile-system-guide/references/harness-profile-system.md`

## Editing Strategy

Prefer guidance before automation:

1. Explain the change in plain language.
2. Show the exact file that should change.
3. Read the current file before editing.
4. Make the smallest TSX change that matches the user's request.
5. Ask the user to use Workbench compile/preview, or use the `profile` CLI when it is available on the Agent runtime PATH.

Use Agent runtime CLI only when it lives under `.nbook/agent/bin` and is on the bash PATH. Do not present repository-root `scripts/` as an Agent runtime contract.

## Common Operations

### Compile a profile

Explain compile in two layers:

- In the Profile Workbench UI, the "编译" button saves the source and runs background compile. A successful compile writes the runtime `.compiled` artifact for that profile.
- In agent-guided user-assets editing, prefer Workbench compile/preview or the Agent runtime `profile` CLI instead of repository-root scripts. The project root `scripts/` directory is for development and deployment, not for the Agent runtime.
- Do not use repository-root profile scripts as the normal Agent-facing workflow.

Useful CLI commands:

- `profile status <fileName-or-key>`: show source, compiled artifact, stale/not compiled/load failed, and sync warning.
- `profile check <fileName-or-key>`: check saved source and profile contract without writing `.compiled`.
- `profile compile <fileName-or-key>`: compile saved disk source and write `.compiled` artifact.
- `profile preview <fileName-or-key>`: dry-run saved source through prepare and show context sections without writing `.compiled`.
- Add `--project <projectPath>` when the profile preview needs a specific Project Workspace context.

Do not ask ordinary users to call the HTTP compile endpoint by hand. Mention it only when debugging the Workbench implementation.

### Restore a user profile to the system version

First explain that this deletes the user's override for that file. Then compare paths:

- User override: `workspace/.nbook/agent/profiles/...`
- System baseline: `assets/workspace/.nbook/agent/profiles/...`

If the user confirms, replace the user file with the matching system file content. If they only want to inspect the system version, read the system file instead of overwriting.

Do not restore by editing the system file. Restoring means removing or replacing the user override so the built-in baseline is visible again.

### Create a new profile from a template

Prefer the existing templates:

- Basic agent template: `assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx`
- Report agent template: `assets/workspace/.nbook/agent/profile-templates/report-agent.profile-template.tsx`

Create the result under `workspace/.nbook/agent/profiles/`. A good default key is `agent.<slug>`, but it is only a recommendation.

After creating the file, ask the user to compile it in the Workbench or run `profile compile`. Use `profile preview` when they want to inspect the prepared context without changing runtime artifacts.

### Explain a compile error

Translate the error into user language:

- Missing `default export`: "这个文件还没有导出真正的 agent 配方。"
- Missing `initialSchema`: "这个 profile 没说创建 agent 时允许传什么配置。普通 agent 可以用空对象 schema。"
- Both `context` and `prepare`: "一个 profile 只能选一种准备上下文的方式。普通情况用 `context()`。"
- Unknown DSL node: "这个 TSX 标签不是当前 ProfilePrompt 支持的节点。"
- Tool key not found: "这个 agent 请求了一个系统里没有注册的工具。"
- `not_compiled`: "这个 profile 还只有源码，没有可运行产物。保存后还需要编译。"
- `compile_stale`: "源码已经改过，但运行产物还是旧的。需要重新编译。"
- `compiled_load_failed`: "编译产物存在，但加载失败。先看编译诊断，再重新编译。"
- `builtin_schema_locked`: "这是系统内置 profile。你可以改提示词和工具权限，但不能把它的创建参数/输出协议改成另一个形状。"

### Explain common settings vs profile settings

- Automatic summarization and the single-file change diff limit appear for every profile. Configure them in the profile settings card; do not add them to a low-code `settingsForm`.
- A profile-level `summarizer` declaration defines execution strategy only. It makes the default enabled, but users may still override the switch. Profiles without a declaration default off and use the system strategy when explicitly enabled.
- `<FileChangeNotice>` only declares `mode`. Its diff budget comes from `agent.profiles.<key>.fileChangeNotice.diffMaxChars`.

## Current Profile Contract

A TSX profile usually contains:

- `profileManifest`: key/name/description, plus optional `version` (positive integer) that drives profile home upgrades.
- `InitialSchema`: creating the agent/session uses this schema. Ordinary agents can use `Type.Object({})`.
- `PayloadSchema`: optional per-invocation payload schema, used only when the profile accepts `invoke_agent.input`.
- `OutputSchema`: report result data shape. Empty object schema means no special data fields.
- `tools`: profile root tool bindings; this controls visible tool schema and maximum tool permission.
- `toolKeys`: optional main-run execution subset of `tools`.
- `settingsForm`: optional low-code settings form (`defineLowCodeForm`). See "Settings Form" below.
- `home`: optional profile home lifecycle (`defineProfileHome`). See "Profile Home" below.
- `skills`: optional skill catalog visibility whitelist, `skills: {include: ["key-a", "key-b"]}`. Prepare-time `ctx.skills` keeps only whitelisted keys. This filters what the model sees in `<SkillCatalog />`; it is not file-level permission isolation.
- `context(ctx)`: recommended user-facing way to prepare prompt/context with TSX DSL.
- `prepare(ctx)`: advanced low-level override that returns `ProfileTurnPlan` directly.

`context` and `prepare` are mutually exclusive.

`InitialSchema` is for creating the agent/session instance. It is not the user's every-turn message. Ordinary agents can use `Type.Object({})`.

`OutputSchema` describes `report_result.data`. Whether an agent can call `report_result` depends on `tools` containing a `report_result` binding, not on the schema existing.

## Settings Form

`settingsForm` is how a profile exposes user preferences without source edits:

- The profile source declares the form with `defineLowCodeForm({schema, defaults, fields, validate})`. Field components include `textarea`, `text`, `radio`, and `resource-preset`.
- Values are NOT stored in the profile source. They live in config files under `agent.profiles.<profileKey>.settings`: Global Config (`workspace/.nbook/config.json`) and Project Config (`workspace/{project}/.nbook/config.json`).
- Effective value merges `defaults` -> Global settings -> Project settings. Project fields override global fields of the same name.
- The user edits values in the settings dialog's "Agent Profile 模型" panel (global and per-project scopes). Do not hand-edit `config.json` for the user; point them to the UI.
- The profile reads merged values through `ctx.settings` during `context()`/`prepare()`.
- Division of work: "change what value is filled in" = settings UI; "change which fields exist" = profile source edit, which requires compile afterward.
- `resource-preset` fields select a `.md` resource from the profile home directory (`profileHomeResource({directory, extension, template})`). Saving the form persists the selected key; creating/editing the resource file happens through the home directory. First version does not support subdirectories inside the resource directory.

## Profile Home

Profile home is a per-profile default resource directory for personas, writing style presets, and similar `.md` assets:

- Declared in the profile source with `home: defineProfileHome({init, upgrade, reset})`.
- Physical locations: global home at `workspace/.nbook/agents/{profileKey}/`; project home at `{Project Workspace}/agents/{profileKey}/`.
- Read is layered for project sessions: project home first, global home as fallback. Writes always go to the current primary layer only.
- `home.json` inside the directory is version metadata maintained by the runtime. Do not hand-edit it.
- `manifest.version` (positive integer) drives lifecycle: first ensure runs `init`; a higher version than recorded runs `upgrade(ctx, oldVersion, targetVersion)`; explicit reset runs `reset`. Upgrades typically use `writeText(..., {mode: "create"})` so user-modified files are preserved and only missing defaults are added.
- Canonical example, "add a writing style preset for writer", two paths:
  1. File path (agent-assisted): write a new `.md` under writer's home `styles/` directory (key format `styles/<preset-key>.md`). Frontmatter must carry `key`, `title`, `label`, `sourcePreset`, `identifier`, `name`, `enabled`, `role`; body is the style instruction text. For references use `references/<key>.md` with `key`, `title`, `label`, `sourceTitle`, `sourceChapters`, `generatedFrom`. Then the user selects it in writer's settings form.
  2. UI path: in the settings dialog, writer's `resource-preset` field supports creating/editing preset resources directly; the form stores the selected key.
- Writer legacy note: writer settings accept both home keys (`styles/<key>.md`) and legacy bare keys; system preset sources come from `assets/workspace/.nbook/agent/profiles/builtin/writer.home/{styles,references}` (plus user same-path overrides) and are seeded into the home on init/upgrade.

## TSX DSL Mental Model

- `<System>` becomes provider-level system prompt. It does not show as a normal chat message.
- `<HistorySet>` is initial model-visible history for an empty session.
- `<AppendingSet>` writes visible messages into the session before the next model run.
- `<ModelContext>` is visible only to the model for the current run, not written into session history.
- `<Message>` creates a user-style context message. Do not use `role="system"`.
- `<Reminder>` and `<Watch>` are dynamic nodes controlled by profile runtime state.
- `<SkillCatalog />`, `<AgentCatalog />`, `<SqlSchemaSummary />`, and `<ActivatedSkills />` are string fragments. Put them inside `<Message>`, `<System>`, or another node that accepts string children.
- `DynamicSet` is an old name. Use `<ModelContext>`.
- `.compiled` is the runtime artifact area, not the editing surface. Do not manually edit files under `.compiled`.

## Answering Users

- Start with the user's goal: "你想让这个 agent 在每轮开始前看到什么、能用什么工具、最后怎么交付结果？"
- Use everyday language first. Then show the TSX node or command.
- When a user says "帮我改 profile", inspect the target file and compile after editing.
- When a user says "帮我加一条全局规则 / 破限 / 置顶提示词", check whether the target profile's settings form already has a top-prompt field. If it does, point the user to the settings UI instead of editing source.
- When a user asks "文风/人设预设放哪、怎么加", answer with the profile home directory and the resource frontmatter contract, or the settings form's resource-preset create path.
- When a user asks "为什么前端看不到这段内容", check whether the content is in `System`, `ModelContext`, or `AppendingSet`.
- When a user asks "为什么 agent 没有这个工具", check root `tools`, `toolKeys` / sidecar `toolKeys`, and the tool registry.
- When a user asks "系统版本更新后为什么没有覆盖我的文件", explain the user-assets overlay and sync state before suggesting restore.

## Safety Rules

- Do not edit system files when a user override is the right place.
- Do not promise that a saved profile is runnable until Workbench compile or `profile compile` passes.
- Do not hide dangerous changes behind jargon. Say plainly if a change can affect all future agents.
- Do not assume the user knows TypeScript. Explain errors in normal language first.
- Do not run unfamiliar third-party `.profile.tsx` as if it were safe. User profiles are trusted local code.
