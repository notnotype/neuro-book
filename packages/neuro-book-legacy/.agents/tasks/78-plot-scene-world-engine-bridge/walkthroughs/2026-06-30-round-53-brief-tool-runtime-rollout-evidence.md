# 2026-06-30 Round 53 - Brief Tool Runtime Rollout Evidence

## Scope

本轮核对未来 `get_chapter_writer_brief` 从 service 到 Agent 可用的完整证据链。目标是避免只实现 service 或只改 profile source，导致真实 Agent 仍不能调用。

本轮不修改业务代码。

## Evidence

当前 tool 绑定层：

- `server/agent/tools/plot-tools.ts` 已注册 Plot tools：
  - `get_plot_tree`
  - `get_story_thread`
  - `get_story_scene_context`
  - `get_scene_world_context`
  - `get_chapter_plot`
  - create/update thread/scene
- `server/agent/tools/index.ts` 通过 `createPlotTools()` 构造 runtime registry，再逐个 `requireDefinition()` 导出。
- `server/agent/profiles/profile-tools.ts` 的 `builtin.plot` 是 profile source 的 typed binding 入口。
- `director.profile.tsx` 只通过 `builtin.plot.*` 声明可见工具。

当前缺口：

- 没有 `get_chapter_writer_brief` runtime tool。
- `tools/index.ts` 没有对应 `getChapterWriterBrief` definition。
- `profile-tools.ts` 没有 `builtin.plot.getChapterWriterBrief`。
- director profile toolset 没有 brief tool。
- leader/writer profile 也没有 brief tool，符合第一阶段 Director-only brief。

## Runtime Rollout Chain

后续 Slice 4 `Agent Tool Binding` 必须同时完成四层：

1. **Runtime tool**
   - 在 `plot-tools.ts` 新增 `get_chapter_writer_brief`。
   - 参数只接受 `{projectPath, chapterPath}`。
   - 不依赖 `plot.selection`。
   - 不调用 `appendCustomState()`。
   - 返回 `details` 为 `ChapterWriterBriefDto`，text 为可读 JSON 或简短摘要。

2. **Global registry**
   - 在 `tools/index.ts` 的 `buildAgentTools()` 中加入 `getChapterWriterBrief: requireDefinition(plotTools, "get_chapter_writer_brief")`。
   - 否则 profile source 即使声明该 key，runtime 也找不到工具实现。

3. **Profile binding API**
   - 在 `profile-tools.ts` 的 `builtin.plot` 增加 `getChapterWriterBrief: registeredTool("get_chapter_writer_brief")`。
   - 否则 TSX profile 难以用 typed binding 声明。

4. **Director exposure**
   - 在 `director.profile.tsx` toolset 增加 `builtin.plot.getChapterWriterBrief`。
   - 更新 prompt：director 用 brief tool 编译 writer handoff，但不直接调用 writer。
   - leader/writer 第一阶段不增加该 tool。

## Test Evidence

建议测试分层：

- `server/agent/tools/plot-tools.test.ts`
  - `Value.Check()` 接受 `{projectPath, chapterPath}`。
  - `get_chapter_writer_brief` 不读取/修改 `plot.selection`。
  - tool 调用 facade/service 后返回 `suggestedBriefMarkdown`。

- `server/agent/tools/index` 相关测试或已有 registry 测试
  - `createBuiltinTools()` 包含 key `get_chapter_writer_brief`。

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director `rootToolKeys` 包含 `get_chapter_writer_brief`。
  - director prompt 包含 brief compiler 用法。
  - director 仍不包含 `execute_world`、`write`、`edit`。

- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts`
  - writer 仍不包含 `get_chapter_writer_brief` 和其它 Plot tools。

- `server/agent/profiles/leader-assets-profile.test.ts`
  - leader 第一阶段仍不包含 `get_chapter_writer_brief`。
  - leader prompt 指示通过 director 获取 writer brief。

## Compiled Runtime Gate

源码测试通过仍不足以证明真实 Agent 可用。Task 79 正在改 profile build system，后续最终验收还应确认：

- director source profile 已被编译发布。
- profile build status 不是 stale / failed。
- compiled artifact 中 director `rootToolKeys` 包含 `get_chapter_writer_brief`。

如果当时 profile 编译系统仍在重构，Task 78 可以先用源码测试推进，但最终完成审计必须把 compiled runtime 证据单列，不把“源码已改”当成“Agent 已可用”。

## Result

`get_chapter_writer_brief` 是跨 service、runtime registry、profile binding、director exposure 和 compiled artifact 的功能。后续实现必须同时提供这些证据；缺任意一层都会出现“接口存在但 Agent 调不到”的假完成。

