# Round 77: Implementation Entry Test Gradient

## Scope

本轮把“下一步进入实现”拆成测试梯度，明确每个切片最小应该证明什么。目标是避免一上来跑全量测试，也避免只跑一个窄测试就声明大范围完成。

## Current Evidence

- Profile Contract Cleanup 尚未实现：
  - director source 仍有 simulator gate。
  - `DirectorOutputSchema` 仍不 strict。
  - reference 仍把普通写作链路写成绕过 director。
- OpenAPI Explicit Path 尚未实现：
  - `RouteMetaEntry` 无 `path?: string`。
  - `buildPath(file, _entry)` 忽略 entry。
  - catch-all route 当前无法表达两个独立 GET path。
- Chapter Writer Brief Module 尚未实现：
  - 无 `ChapterWriterBriefDtoSchema`。
  - 无 `ChapterWriterBriefService`。
  - `findChapterScenes()` 不包含 brief 所需 thread summary/writingTip 和 Scene writingTip。
- Agent Tool Binding 尚未实现：
  - 无 `get_chapter_writer_brief` runtime tool。
  - 无 global registry binding。
  - 无 typed profile binding。
  - director 未暴露 brief tool。

## Test Gradient

### Slice 1: Profile Contract Cleanup

最小测试：

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director prompt 正断言：Plot/Scene-only、World Engine requests、writer handoff。
  - director prompt 负断言：无 `simulator_requests`、无 `Simulation gate`、无 `simulator.leader`。
  - writer prompt/toolset 断言：writer 不暴露 Plot tools，输入仍是 `message + input.path`。
- schema-only `Value.Check()`
  - valid new output passes。
  - legacy `simulator_requests` fails。
  - legacy `plot_updates.kind = "plot"` fails。
  - root extra fails。
  - plot update item extra fails。

运行范围建议：

- 只跑 profile contract 相关 vitest。
- 不需要跑浏览器。
- 不需要跑全量测试，除非修改牵动 profile DSL/runtime。

### Slice 2: OpenAPI Explicit Path

最小测试：

- `server/openapi/generate-spec.test.ts`
  - explicit `path` 优先于 file 推导。
  - world-context 生成 `/api/projects/plot/scenes/{sceneId}/world-context`。
  - 加入 chapter-writer-brief 后生成 `/api/projects/plot/chapter-writer-brief`。
  - 两个 GET operation 不互相覆盖。

运行范围建议：

- 只跑 OpenAPI spec generator 测试。
- 若 route meta 自动生成器也改动，再跑对应生成器测试。

### Slice 3: Chapter Writer Brief Module

最小测试：

- DTO schema 测试
  - status enum。
  - scenes/threadSummaries/worldContexts/warnings/suggestedBriefMarkdown shape。
- service fixture 测试
  - `needs_plot`：章节无 Scene。
  - `needs_world_anchor`：Scene 缺完整时间范围或 subject。
  - `needs_world_context`：全部 unresolved 或 World Context 查询失败。
  - `ready`：有 Scene、anchor、resolved subjects 和可用 context。
  - markdown 不含 raw patch JSON / 完整 attrs / 伪造 ChapterOverride 字段。
- repository 查询测试或 fixture
  - `findChapterScenesForBrief()` 能拿到 thread summary/writingTip 与 Scene writingTip。

运行范围建议：

- 跑 `server/plot` 相关 service/repository 测试。
- HTTP route 增加后跑对应 integration 测试。

### Slice 4: Agent Tool Binding

最小测试：

- `server/agent/tools/plot-tools.test.ts`
  - `get_chapter_writer_brief` 参数为 `{projectPath, chapterPath}`。
  - tool 不读写 `plot.selection`。
  - details 是 `ChapterWriterBriefDto`。
- `server/agent/tools/index.ts` 相关 registry 测试
  - `createBuiltinTools()` 包含 `get_chapter_writer_brief`。
- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director `rootToolKeys` 包含 brief tool。
  - writer 不包含 brief tool 和 Plot tools。
- `get_agent_profile` harness 测试
  - director `toolKeys` / schema summary 可发现 brief tool。
- compiled artifact 检查
  - active system/user director artifact 包含 brief tool。

运行范围建议：

- 先跑 agent tools/profile tests。
- compiled artifact 需要 build/sync 后用 manifest + artifact 内容检查证明。

## Stop Conditions

实现过程中遇到以下情况应停止并报告：

- 需要让 writer 直接持有 Plot write tools 才能完成 brief。
- 需要把 World Engine state 写入 Plot，形成第二状态源。
- 需要用 `any` / `unknown` 绕过 `DirectorOutputSchema` 或 `ChapterWriterBriefDto` 类型设计。
- user profile shadow 未处理，但验收想声明 runtime 已更新。
- OpenAPI catch-all 只能通过覆盖已有 operation 生成 brief path。

## Conclusion

下一步不需要更多大范围探索。应从 Slice 1 开始，小步实现、小范围测试、每个切片都留下独立证据。只有四个切片和 active compiled runtime 都对齐后，Task 78 的 Agent 易用性目标才有完成证据。

