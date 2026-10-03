# 2026-06-29 Round 11 - Current State and Profile Contract Baseline

## Scope

本轮重新核对 Round 08 之后的当前 worktree。重点不是继续假设 DTO drift 未修，而是确认现在真正卡住的 profile / tool 合同边界。

本轮不修改业务代码。

## Evidence

读取文件：

- `server/plot/facade/plot.facade.ts`
- `server/agent/profiles/profile-tools.ts`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `server/agent/profiles/simulation-director-profiles.test.ts`
- `reference/agent/profile-routing.md`
- `reference/agent/novel-writing-workflow.md`
- `reference/plot/system.md`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`

验证命令：

```powershell
bun run typecheck
```

结果：失败，但失败位置已经不在 Plot / DTO：

- `assets/workspace/.nbook/agent/skills/llmlint/src/reporter.ts`
- `assets/workspace/.nbook/agent/skills/llmlint/src/rules.ts`

当前报错是 llmlint skill 的类型约束问题，不是 Task 78 的 `StorySceneWorldAnchorInputDto` / `StorySceneWorldAnchorDto` 边界问题。

## Correction Against Round 08

Round 08 记录的 P0 修复点在当前 worktree 已经完成：

```ts
private async parseWorldAnchorDto(projectPath: string, dto?: StorySceneWorldAnchorInputDto): Promise<SceneWorldAnchor>
```

`plot.facade.ts` 也已经 import 了 `StorySceneWorldAnchorInputDto`。因此 Task 78 的 DTO drift 剩余点不应继续作为当前 TODO。

## Current Contract Baseline

### Tool Binding

`server/agent/profiles/profile-tools.ts` 当前 `builtin.plot` 包含：

- `get_plot_tree`
- `get_story_thread`
- `get_story_scene_context`
- `get_scene_world_context`
- `get_chapter_plot`
- `create_story_thread`
- `update_story_thread`
- `create_story_scene`
- `update_story_scene`

还没有：

- `get_chapter_writer_brief`

### leader.default

当前工具：

- 有 `execute_world` readwrite。
- 没有 Plot tools。

当前 prompt / routing 冲突：

- `leader.default.profile.tsx` 仍写“本 leader 不维护旧 Plot / simulation 系统——这些在你这里不存在”。
- `reference/agent/profile-routing.md` 仍写 `leader.default` 不路由到 Plot / simulator / director / RP。

这和 Task 78 当前状态冲突：Plot 已经不是旧状态源，而是 Scene-only 作者结构层；director 也不应被普通写作主链排除。

### director

当前工具：

- 有 Plot tools。
- 有 `get_scene_world_context`。
- 没有 `execute_world`。

当前 prompt / schema 冲突：

- prompt 仍有 `simulator.leader` / `Simulation gate` / `simulator_requests`。
- `DirectorOutputSchema.plot_updates.kind` 仍允许 `"plot"`。
- `DirectorOutputSchema` 仍使用 `simulator_requests` 表达需要世界裁决的问题。

这和 Scene-only Plot + World Engine 主链冲突。普通写作模式下，director 应把未裁决事实退回 leader / World Engine，而不是 simulator。

### writer

当前工具：

- 有 readonly `execute_world`。
- 没有 Plot tools。

当前合同基本合理，但 wording 仍有历史噪音：

- `WriterPayloadSchema.context.threadIds/sceneIds/plotIds` 描述为 `Legacy Plot 兼容字段`。
- writer profile 明确忽略这些字段。

这条边界本身应保留：writer 不直接接 Plot tools。但说明应从“Plot 是 legacy”改成“writer 不通过 payload 直接消费 Plot；上游应把 Plot Scene 编译成 brief message”。

## Current Contradictions

1. `reference/plot/system.md` 写“Writer 写章节时，Leader 应优先用 get_chapter_plot”，但 leader 当前没有 Plot tools。
2. `profile-routing.md` 写 leader 不路由到 director，但 director 是当前唯一正式 Plot specialist。
3. director prompt 仍把未裁决状态交给 simulator，而普通写作状态源已经是 World Engine。
4. `DirectorOutputSchema` 仍暴露 `"plot"` kind，和 `StoryPlot / Plot Beat` 退场不一致。
5. `get_chapter_writer_brief` 还没有工具绑定，Agent 仍要手动串多个 Plot/World Context 工具。

## Updated Next Step

下一阶段不再把 DTO drift 作为 P0。当前更准确的 P0 是：

1. 修正 profile / workflow 文档和 prompt 的职责地图。
2. 把 director 从 simulator gate 改为 World Engine request boundary。
3. 决定 `get_chapter_writer_brief` 落地后先给 director，还是也给 leader 一个只读 brief 工具。

全局 `bun run typecheck` 当前失败需要另行处理 llmlint skill；它不应阻塞 Task 78 的 profile 架构探索判断，但进入实现前要在验证结果里明确说明。

