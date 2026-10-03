# 2026-06-29 Round 04 - Next Architecture Slices

## Scope

本轮基于 Round 02/03 的发现，提出后续可落地的架构切片。目标是让 Agent 真正“方便地”使用 Plot System 和 World Engine，而不是只在后端具备能力。

## Architecture Layering

### Layer 1 - Data Bridge（已完成）

当前 Task 78 已完成：

- Scene 持久化 `worldAnchor`
- Scene-only Plot 模型
- `StoryPlot` 迁移与删除
- Scene World Context API
- Plot Workbench UI

这个层解决“两个系统能不能连上”。

### Layer 2 - Agent Routing（待修正）

当前缺口：

- `leader.default` 不拥有 Plot tools，且 prompt 仍把 Plot 当旧系统排除。
- `director` 拥有 Plot tools，但 prompt 仍残留 simulator gate。
- `reference/agent/novel-writing-workflow.md` 仍把 Plot System 放入 legacy boundary。

建议切片：

1. 更新 `reference/agent/novel-writing-workflow.md`：Plot 从 legacy 状态源改为 Scene-only 结构层。
2. 更新 `leader.default` prompt：World Engine 是状态源，但 Plot Scene 是作者结构层；需要 Scene 编排时调用 director 或 Plot tools。
3. 更新 `director` prompt：移除 simulator gate，改为 World Engine context gate；未确认事实返回 open_questions，确认后由 leader 写 World Engine。
4. 明确 writer 不直接使用 Plot，但可以接收 Scene-derived brief。

### Layer 3 - Tool Ergonomics（建议新增）

当前 Agent 手动串工具成本较高：

- `get_chapter_plot`
- `get_story_scene_context`
- `get_scene_world_context`
- 可能还要读 lorebook / manuscript

建议新增聚合工具之一：

#### Option 3A：`get_scene_writer_brief`

输入：

- `projectPath`
- `sceneId`

输出：

- Scene summary / purpose / writingTip
- parent Thread summary
- chapter sibling scenes
- worldAnchor
- filtered World Context summary
- recommended writer query hint
- missing fields / warnings

适合：

- 单 Scene 写作。
- director / leader 生成 writer handoff。

#### Option 3B：`get_chapter_writer_brief`

输入：

- `projectPath`
- `chapterPath`

输出：

- chapter scenes in order
- each scene's worldAnchor status
- each scene's world context summary if connected
- missing anchors / missing subjects warnings
- suggested writer brief skeleton

适合：

- “写这一章”的主路径。

推荐：

- 优先 3B。因为 writer 的真实入口是 chapter 文件，用户最常说的是“写这一章”而不是“写这个 scene”。

### Layer 4 - Consistency Checks（建议新增）

需要在服务层或工具层给 Agent 明确 warning：

- Scene 有 `subjectIds` 但缺时间范围：不能查询 World Context。
- Scene 有时间范围但没有 subjects/location：World Context 必然为空。
- `locationSubjectId` 不在 `subjectIds`：当前实现会合并查询，但 UI / Agent brief 应提示地点不算出场角色还是需要加入出场列表。
- Scene summary 描述的关键状态变化没有对应 World Engine patch：这需要后续更强的语义检查，第一版可以只作为人工 checklist。

### Layer 5 - Chapter Override / Writer Brief（后续）

Task 78 已把 Chapter 覆盖定位为 Project SQLite 结构化数据，但尚未落地完整模型。

建议后续设计：

- `ChapterOverride`：POV、tone、ending hook、reader information、do-not-reveal、style note。
- `ChapterSceneOverride`：某 Scene 在本章中的呈现重点、删减、转场说明。
- `WriterBriefService`：合并 ChapterOverride + Scene + Thread + World Context，生成 writer handoff。

这个层不应抢 World Engine 状态源职责；它只负责正文呈现。

## Recommended Implementation Order

### P0 - Documentation / Prompt Reconciliation

不改数据库，先修正 Agent 认知：

- `reference/agent/novel-writing-workflow.md`
- `leader.default.profile.tsx`
- `director.profile.tsx`
- `reference/agent/profile-routing.md`

验收：

- leader.default 不再说 Plot “不存在”。
- director 不再把 simulator 当默认状态裁决入口。
- workflow 明确 Plot 是 Scene-only 作者结构层。

### P1 - Aggregated Brief Tool

新增 `get_chapter_writer_brief` 或同等服务层 API。

验收：

- Agent 不需要手动串 3-5 个 Plot/World tools 才能写一个 chapter brief。
- 输出能明确列出缺失 anchor、无 context、subject 不存在等问题。

### P2 - Director World Context Boundary

二选一：

- 给 director readonly `execute_world`，让它能看当前状态但不能写。
- 或保持 director 只有 Plot tools，要求 leader 在调用 director 前把必要世界状态放进 message。

推荐：

- 先不加 readonly `execute_world`，避免扩大职责；等 P1 brief 工具落地后再评估。

### P3 - Chapter Override

补 Chapter writer-facing 覆盖层，承接 POV / tone / information control 等正文呈现指令。

## Key Decision Needed Later

`leader.default` 是否直接拥有 Plot tools？

两种可行路线：

- **Direct Leader Route**：leader 直接持有 Plot tools。优点是顺手；风险是工具面大。
- **Director Specialist Route**：leader 只通过 director 操作 Plot。优点是职责清楚；风险是多 agent 往返成本高。

当前建议先走 Director Specialist Route，并用 prompt 修正 + 聚合 brief 工具降低成本。

理由：

- `leader.default` 已经拥有 `execute_world` readwrite、file、sql、agent、task 等大量能力。
- Plot 结构编辑是专门能力，交给 director 更容易控制摘要密度和 Scene 粒度。
- 真正的便利性瓶颈不是“leader 少一个工具”，而是缺少“从 Scene/Chapter 到 writer brief”的聚合服务。

