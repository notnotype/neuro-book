# 2026-06-29 Round 08 - DTO Drift Fix Plan

## Scope

本轮重新核对 Round 05 记录的 DTO drift。目标是用当前 worktree 证据确认真实失败面，并把后续修复拆成最小可验证切片。

本轮不修改业务代码，只更新探索记录。

## Evidence

读取文件：

- `shared/dto/plot.dto.ts`
- `server/plot/facade/plot.facade.ts`
- `server/plot/services/scene-world-context.service.ts`
- `app/components/novel-ide/plot/NovelPlotPanel.vue`
- `app/components/novel-ide/plot/thread-panel/PlotThreadEditorDialog.vue`
- `app/components/novel-ide/plot/thread-panel/PlotThreadPanelPreviewWorkspace.vue`
- `app/components/novel-ide/plot/workbench/PlotWorkbenchPreviewWorkspace.vue`

验证命令：

```powershell
bun run typecheck
```

结果：失败。

当前失败只剩两处，均在 `server/plot/facade/plot.facade.ts`：

- `createStoryScene()` 把 `CreateStorySceneRequestDto.worldAnchor` 传给 `parseWorldAnchorDto()`。
- `updateStoryScene()` 把 `UpdateStorySceneRequestDto.worldAnchor` 传给 `parseWorldAnchorDto()`。

失败原因：`parseWorldAnchorDto()` 参数类型仍是 `StorySceneWorldAnchorDto`，但写入请求实际使用 `StorySceneWorldAnchorInputDto`。输出 DTO 多了 `subjects/locationSubject/unresolvedSubjectIds`，输入 DTO 不应该携带这些只读字段。

## Correction Against Round 05

Round 05 的大方向仍成立，但当前 worktree 已经部分修复：

- 前端空 World Anchor helper 已补齐 `subjects/locationSubject/unresolvedSubjectIds`。
- `SceneWorldContextService` 已在所有返回分支带上 `unresolvedSubjectIds`。
- `WorldEngineContextPanel` 已读取并展示 `unresolvedSubjectIds`。
- `PlotDtoAssembler` 和 Facade 输出格式化已经能构造 resolved / unresolved subject 展示。

因此 P0 不是“大面积 DTO drift 修复”，而是一个更小的类型边界修正：把 `parseWorldAnchorDto()` 的输入类型从输出 DTO 切到输入 DTO。

## Minimal Fix Boundary

建议最小补丁只做：

1. `plot.facade.ts` import `StorySceneWorldAnchorInputDto`。
2. `parseWorldAnchorDto(projectPath, dto?: StorySceneWorldAnchorInputDto)`。
3. 不改 DTO schema，不改前端，不改 World Context service。
4. 跑 `bun run typecheck`。

这个补丁是系统性修复，不是 hack：它把“写入输入”和“读取输出”的类型边界恢复为 DTO schema 已经表达的合同。

## Why Not Broaden This Patch

不要在同一个补丁里同时抽 `SceneWorldAnchorResolutionService`，原因：

- 当前 typecheck failure 的根因很小，扩大补丁会混淆验证边界。
- `formatWorldAnchorDto()` 当前已有私有 subject resolution，可继续支撑输出 DTO。
- Resolution service 是下一阶段的架构重构，应该单独验证 Workbench、Scene World Context 和 future brief 的复用收益。

## Regression Tests

P0 修复后建议验证：

```powershell
bun run typecheck
```

若要补聚焦测试，优先选择：

```powershell
bunx vitest run server/agent/tools/plot-tools.test.ts server/plot/services/scene-world-context.service.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"
```

## Design Impact

这轮结论让后续顺序更清楚：

1. 先修 Facade input/output DTO 分界，让类型门恢复。
2. 再抽 subject resolution 服务，减少 Facade 私有 helper 和 Scene World Context 重复查询。
3. 最后做 `get_chapter_writer_brief`，否则 brief 会依赖一个还没稳定归属的 resolution 逻辑。

