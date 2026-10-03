# Novel Workflow Emulation Implementation Plan

## User Request

基于 [../31-novel-writing-workflow-emulation/README.md](../31-novel-writing-workflow-emulation/README.md) 和稳定参考 [../../../reference/agent/novel-writing-workflow.md](../../../reference/agent/novel-writing-workflow.md)，新建一个 implementation task，把后续真正改 skill、模板、profile 的实现计划写清楚。

本 task 已进入实现并完成第一版落地。

## Goal

把写作流程的 emulation 设计落地到系统资源中，让 `leader.default` 和后续 Agent 能按标准流程使用：

- 小说 workflow skills 有清晰、可排序的命名和职责。
- 新增 emulation bootstrap skill。
- 世界模拟 skill 拆分/重写为 emulation tick skill。
- Project 模板中的 `simulation/runs` 使用 `report.md + prose.md` tick 结构。
- `leader.default` 明确知道写作模式下何时启动 emulation、何时跳过、如何把结果交给 writer。
- RP 相关 profile / skill / template 与新的 runs 结构不冲突。

## Scope

### In Scope

- 系统 skill 资产：
  - `assets/workspace/.nbook/agent/skills/**`
  - 必要时更新 skill catalog 测试或 fixtures。
- Project directory template：
  - `assets/workspace/.nbook/templates/project-directory-templates/simulation/**`
- Builtin profile prompt：
  - `leader.default`
  - 必要时微调 `leader.rp`、`rp.writer`、`simulator.actor` 对 runs 产物的描述。
- 稳定 reference / task 同步：
  - `reference/agent/novel-writing-workflow.md`
  - `reference/content/directory-protocol.md`
  - `docs/tasks/32-novel-workflow-emulation-implementation/README.md`
  - `PROJECT-STATUS.md`
- 窄测试和 profile compile/check。

### Out Of Scope

- 暂不真实把 `simulation/` 目录重命名为 `emulation/`。
- 暂不新增 runtime workflow 自动生成 `input.md`、`actor-packets.json`、`commits.json`、`tool-log.json`。
- 暂不改变普通 `writer` 的 input schema。
- 暂不让 `writer` 直接读取或维护 `simulation/`。
- 暂不做 GraphRAG 或完整信息控制 schema。

## Implementation Plan

### Phase 1: Skill Naming And Migration Strategy

先决定系统 skill 是“直接重命名目录”还是“新增新目录并保留旧目录一段时间”。

推荐实现：

- 第一版新增英文 key 目录，旧中文目录暂时保留或作为短重定向说明，避免 user-assets 覆盖层和已有 SkillCatalog location 立即失效。
- 新 skill frontmatter `name` 可以保留中文，例如 `小说流程 05：Emulation 初始化`。
- description / when_to_use 使用清晰触发语义，减少模型误选。

计划映射：

| New Skill Directory | Old Skill Directory | Action |
| --- | --- | --- |
| `novel-workflow-01-idea-exploration` | `小说灵感探索流程` | 迁移或复制后保留旧入口重定向。 |
| `novel-workflow-02-project-bootstrap` | `小说初始化流程` | 迁移或复制后保留旧入口重定向。 |
| `novel-workflow-03-lorebook-bootstrap` | `世界书初始化流程` | 迁移或复制后保留旧入口重定向。 |
| `novel-workflow-04-character-design` | `角色设计流程` | 迁移或复制后保留旧入口重定向。 |
| `novel-workflow-05-emulation-bootstrap` | none | 新增。 |
| `novel-workflow-06-emulation-tick` | `世界模拟` | 拆分/重写，旧入口重定向。 |
| `novel-workflow-07-opening-plot-design` | `开局剧情设计` | 迁移或复制后保留旧入口重定向。 |
| `novel-workflow-08-plot-planning` | `剧情规划流程` | 迁移或复制后保留旧入口重定向。 |
| `novel-workflow-09-chapter-writing` | none | 新增普通 writer 调用流程摘要。 |
| `novel-workflow-10-revision` | none | 新增润色修订流程摘要。 |
| `novel-technique-commercial-rhythm` | `爽文` | 迁移为 technique，不属于 workflow 编号。 |
| `novel-import-silly-tavern-card` | `SillyTavern角色卡导入` | 可后续迁移，非本轮必做。 |
| `novel-import-tomato-reference` | `番茄小说导入` | 可后续迁移，非本轮必做。 |

Implemented decision:

- 第一版不删除旧中文 skill 目录；新增英文 workflow / technique skill 目录，旧 `世界模拟` 作为兼容入口提示优先使用 `novel-workflow-06-emulation-tick`。

Follow-up update:

- 2026-06-04：写作 workflow / technique / import skill 已统一为 canonical key。旧中文 workflow 目录、`世界模拟`、`爽文`、`SillyTavern角色卡导入`、`番茄小说导入` 已从当前系统 skill catalog 移除；后续 Agent 应使用 `novel-workflow-*`、`novel-technique-*`、`novel-import-*`。

### Phase 2: Add Emulation Bootstrap Skill

新增 `assets/workspace/.nbook/agent/skills/novel-workflow-05-emulation-bootstrap/SKILL.md`。

职责：

- 检查当前 Project Workspace 是否已有 `simulation/`。
- 根据已有 protagonist、重要 NPC、关键势力或用户指定对象建立最小 `subjects/`。
- 按需创建初始 `entities/`，只实例化有独立状态、隐藏真相、唯一性、损坏、进度或剧情重要性的对象。
- 建立或更新 `simulation/runs/current.md` 和 `simulation/runs/index.md`。
- 创建 `simulation/runs/ticks/000000-initial-state/report.md`，必要时创建空或说明性 `prose.md`。
- 明确不推进下一段剧情，不写章节正文，不把上帝视角 lorebook 直接复制进 subject knowledge。

建议完成标准：

- `simulation/subjects/` 中至少有用户指定或默认主角 subject。
- 初始状态能支撑后续 opening plot design 或 emulation tick。
- 000000 report 说明初始化来源、已创建 subject/entity、未决问题。

### Phase 3: Rewrite World Emulation Tick Skill

把当前 `世界模拟` 的职责收敛成 `novel-workflow-06-emulation-tick`。

职责：

- 明确本 tick 的 trigger、goal、scope、world time before/after。
- 读取必要 lorebook、Plot 和当前 subject/entity state。
- 推演 2-3 条相关因果链。
- 可加入少量随机扰动，但重大随机结果影响主线前需用户确认。
- 产出 `simulation/runs/ticks/{id}-{slug}/report.md`。
- 如果本 tick 需要用户可见正文或试写片段，产出 `prose.md`。
- 提交已裁决的 subject state 和 entity state 更新。
- 把可进入剧情结构的结果整理为 Plot handoff 建议。

`report.md` 推荐章节：

1. Trigger
2. Goal
3. Scope
4. Inputs
5. Prior State
6. Active Subjects
7. Active Entities
8. Hidden Facts
9. Causal Chains
10. Random Disturbances
11. Adjudicated Events
12. Subject Updates
13. Entity Updates
14. Information Boundary
15. Plot Consequences
16. Writer-safe Brief
17. Commits
18. Open Questions
19. Next Hooks

`prose.md` 规则：

- RP Tick：保存 `rp.writer` 输出的完整正文；`rp.leader` 只组装正文链接和元场景。
- 写作设计 Tick：可保存试写片段或场景草稿。
- 正式章节写作：章节正文仍写入 `manuscript/.../index.md`，`prose.md` 可以只放摘要和目标章节链接。

### Phase 4: Update Project Template Runs Shape

修改 `assets/workspace/.nbook/templates/project-directory-templates/simulation/runs/**`。

目标结构：

```text
simulation/runs/
|-- current.md
|-- index.md
`-- ticks/
    `-- 000000-initial-state/
        |-- report.md
        `-- prose.md
```

移除或停止推荐这些手写示例：

- `user-input.md`
- `gm-scratch.md`
- `writer-brief.md`
- `subjects/*.result.json`

注意：

- 这些文件不是永远禁止，只是不作为第一版 Agent 手写模板。
- 后续 workflow/runtime 可自动生成机械产物。

### Phase 5: Update Leader Prompt Contract

更新 `leader.default` prompt / imported reference，使其知道：

- 写作模式按标准流程走，但可以跳步。
- emulation 只在剧情推进、状态变化、角色/势力/地点自然反应、写后状态提交时启动。
- 普通写章不要强行跑 emulation。
- `leader.default` 可以维护 `simulation/`，但要把它视为世界状态 commit。
- `writer` 不维护 `simulation/`；leader 把 emulation 结果转成 Plot、constraints、writer-safe brief 或 selected lorebookEntries。

可选同步：

- `leader.rp` prompt 中 runs 写入建议改为 `report.md + prose.md`。
- `rp.writer` 描述中明确正文可由 GM 要求写到 `runs/ticks/{id}-{slug}/prose.md`。

### Phase 6: Tests And Verification

建议新增或更新测试：

- Skill catalog 测试：
  - 新 workflow skill 可被扫描。
  - 旧中文 skill 如保留重定向，不破坏 catalog。
- Project template 测试：
  - 默认 Project 模板包含 `simulation/runs/current.md`、`index.md`、`ticks/000000-initial-state/report.md`、`prose.md`。
  - 不再断言旧 `user-input.md` / `gm-scratch.md` / `writer-brief.md` 示例存在。
- Profile prompt 测试：
  - `leader.default` prompt 或 imported reference 包含 emulation decision / writer boundary。
  - `leader.rp` 仍知道 `prose.md` 是用户可见正文文件。

建议命令：

```bash
bun run test server/agent/skills/skill-catalog.test.ts
bun run test server/workspace-files/workspace-files.test.ts
bun run test server/agent/profiles/rp-profiles.test.ts
bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system
bun scripts/build/profile.ts check builtin/leader.rp.profile.tsx --system
```

如果 profile 源码或系统 skill metadata 变更导致 stale：

```bash
bun run profile:metadata
bun scripts/build/profile.ts compile --all
```

## Risks

- 直接重命名 skill 目录可能让 user-assets 覆盖层、旧会话 skill location 和同步状态产生漂移。第一版建议保留旧入口重定向。
- `emulation` 概念和当前 `simulation/` 目录名可能让 Agent 混淆；文档和 prompt 必须反复强调当前目录仍是 `simulation/`。
- 如果 `leader.default` 太积极地启动 emulation，会让简单写作任务变重；prompt 中应强调“按需启动”。
- 如果 `writer` 被允许直接浏览 `simulation/`，信息控制会变脏；第一版继续禁止。
- Tick `report.md` 如果过长，后续读取成本会上升；但比大量碎文件更适合第一版手工维护。

## Acceptance Criteria

- 新 workflow skill 命名和职责在系统 skill 资产中可见。
- `novel-workflow-05-emulation-bootstrap` 能指导 Agent 初始化运行态，但不推进剧情。
- `novel-workflow-06-emulation-tick` 能指导 Agent 产出 `report.md + prose.md`，并提交 subject/entity 状态。
- 默认 Project 模板的 runs 示例使用 `report.md + prose.md`。
- `leader.default` 的写作流程清楚知道 emulation 决策点和 writer 边界。
- 稳定 reference、task walkthrough 和 `PROJECT-STATUS.md` 与实现保持一致。
- 窄测试和 profile check 通过，或明确记录未通过的既有 unrelated 错误。

## Files To Change

预计会触及：

- `assets/workspace/.nbook/agent/skills/**`
- `assets/workspace/.nbook/templates/project-directory-templates/simulation/runs/**`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- 可选：`assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile.tsx`
- 可选：`assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile.tsx`
- 相关测试文件
- `reference/agent/novel-writing-workflow.md`
- `reference/content/directory-protocol.md`
- `PROJECT-STATUS.md`

## Implementation Summary

已完成：

- 新增系统 skill：
  - `novel-workflow-05-emulation-bootstrap`
  - `novel-workflow-06-emulation-tick`
  - `novel-workflow-09-chapter-writing`
  - `novel-workflow-10-revision`
  - `novel-technique-commercial-rhythm`
- 2026-06-04 更新：旧中文 workflow / technique / import skill 目录已移除，当前系统 catalog 只保留 canonical key；`RP模式` 仍作为 RP 专用 skill 保留。
- 默认 Project 模板 `simulation/runs` 改为：
  - `current.md`
  - `index.md`
  - `ticks/000000-initial-state/report.md`
  - `ticks/000000-initial-state/prose.md`
- 停止在默认模板中推荐手写 `user-input.md`、`gm-scratch.md`、`writer-brief.md`、`subjects/*.result.json`。
- `leader.default` 通过 `reference/agent/leader-default.md` 获得写作 emulation 决策点和 writer 边界。
- `leader.rp` / `rp.writer` prompt 明确 runs tick 优先使用 `report.md + prose.md`，用户可见正文落到 `prose.md`。
- `reference/agent/novel-writing-workflow.md` 和 `reference/content/directory-protocol.md` 已同步为实现态。

## Files Changed

2026-06-06 update: `simulation/simulator.md` / `simulation/writer.md` 已被后续 profile context V2 取代；当前默认 Project 模板把 simulation guidance 放在 `agent-context/simulator.leader/context.md`，`agent-context/rp.writer/context.md` 只作为可选写作偏好来源，由上级整理进 writer brief；`simulation/` 只保留 runtime state 与 runs。

- `assets/workspace/.nbook/agent/skills/novel-workflow-05-emulation-bootstrap/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-06-emulation-tick/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-01-idea-exploration/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-02-project-bootstrap/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-03-lorebook-bootstrap/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-04-character-design/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-07-opening-plot-design/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-08-plot-planning/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-10-revision/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-technique-commercial-rhythm/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-import-tomato-reference/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/SKILL.md`
- `assets/workspace/.nbook/agent/skills/RP模式/SKILL.md`
- `assets/workspace/.nbook/templates/project-directory-templates/simulation/runs/**`
- `assets/workspace/.nbook/templates/project-directory-templates/agent-context/simulator.leader/context.md`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile.tsx`
- `reference/agent/leader-default.md`
- `reference/agent/novel-writing-workflow.md`
- `reference/content/directory-protocol.md`
- `server/agent/skills/skill-catalog.test.ts`
- `server/workspace-files/workspace-files.test.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `server/agent/profiles/rp-profiles.test.ts`
- `PROJECT-STATUS.md`

## Verification

已通过：

```bash
bun run test server/agent/skills/skill-catalog.test.ts server/workspace-files/workspace-files.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/rp-profiles.test.ts
bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system
bun scripts/build/profile.ts check builtin/leader.rp.profile.tsx --system
bun scripts/build/profile.ts check builtin/rp.writer.profile.tsx --system
```

实现中修改了 builtin profile 源码，因此已同步运行：

```bash
bun run profile:metadata
bun scripts/build/profile.ts compile --all --system
```
