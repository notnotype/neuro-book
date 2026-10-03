# 2026-06-29 Round 05 - DTO Drift and Subject Resolution Audit

## Scope

本轮继续探索 P1 聚合 writer brief 之前的实现基础。读取 Plot DTO、Facade、Scene service、Scene World Context service、writer payload contract 和现有测试后，发现当前 worktree 已出现一处新的契约漂移。

## Evidence

读取文件：

- `shared/dto/plot.dto.ts`
- `server/plot/assemblers/plot-dto.assembler.ts`
- `server/plot/facade/plot.facade.ts`
- `server/plot/services/scene-world-context.service.ts`
- `server/plot/services/scene.service.ts`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/tools/plot-tools.test.ts`
- `app/components/novel-ide/plot/workbench/WorldEngineContextPanel.vue`

验证命令：

```powershell
bun run typecheck
```

结果：失败。

## Finding 1 - World Anchor DTO 已扩展，但调用方未同步

`shared/dto/plot.dto.ts` 当前把 Scene World Anchor 拆成：

- `StorySceneWorldAnchorInputDtoSchema`
- `StorySceneWorldAnchorSubjectDtoSchema`
- `StorySceneWorldAnchorDtoSchema`

`StorySceneWorldAnchorDtoSchema` 在原字段基础上新增：

- `subjects`
- `locationSubject`
- `unresolvedSubjectIds`

这是合理方向：UI / Agent 不应只看到裸 subjectId；需要知道 subject 是否真的存在于 World Engine。

但前端和部分服务仍在构造旧形态：

```ts
{
    startTime: null,
    endTime: null,
    startInstant: null,
    endInstant: null,
    subjectIds: [],
    locationSubjectId: null,
}
```

typecheck 报错集中在：

- `app/components/novel-ide/plot/NovelPlotPanel.vue`
- `app/components/novel-ide/plot/thread-panel/PlotThreadEditorDialog.vue`
- `app/components/novel-ide/plot/thread-panel/PlotThreadPanelPreviewWorkspace.vue`
- `app/components/novel-ide/plot/workbench/PlotWorkbenchPreviewWorkspace.vue`
- `server/plot/facade/plot.facade.ts`

## Finding 2 - Facade 输入类型应使用 Input DTO，不应要求 resolved 字段

`CreateStorySceneRequestDtoSchema` / `UpdateStorySceneRequestDtoSchema` 使用 `StorySceneWorldAnchorInputDtoSchema`，这是正确的。

但 `PlotFacade.parseWorldAnchorDto()` 当前参数类型仍是 `StorySceneWorldAnchorDto`。这会导致写入请求的 `worldAnchor` 被错误要求携带 `subjects/locationSubject/unresolvedSubjectIds` 这些只读展示字段。

建议修正方向：

- `parseWorldAnchorDto(projectPath, dto?: StorySceneWorldAnchorInputDto)`
- facade import 改为 input DTO 类型
- 输出格式化仍返回 `StorySceneWorldAnchorDto`

## Finding 3 - SceneWorldContextDtoSchema 已新增 unresolvedSubjectIds，但服务未返回

`SceneWorldContextDtoSchema` 当前要求：

- `slices`
- `subjectStates`
- `unresolvedSubjectIds`

但 `SceneWorldContextService.getSceneWorldContext()` 返回：

```ts
{ slices: [], subjectStates: [] }
```

或：

```ts
{ slices: contextSlices, subjectStates: ... }
```

缺少 `unresolvedSubjectIds`。typecheck 对应报错：

- `server/plot/services/scene-world-context.service.ts(38,13)`
- `server/plot/services/scene-world-context.service.ts(67,9)`

## Finding 4 - Assembler 现在只生成 unresolved placeholder，未真正 resolve WorldSubject

`PlotDtoAssembler.toStorySceneWorldAnchorDto()` 会把所有 subject 都标为：

```ts
{ id, name: id, type: "unknown", resolved: false }
```

这符合“纯 assembler 不访问 World Engine”的职责边界，但也说明当前 resolved subject 信息并未真正接入服务层。

这会影响：

- Scene Card 地点显示仍可能是 subjectId，而不是 name。
- Agent brief 如果复用当前 DTO，会看到 unresolved placeholder。
- `get_chapter_writer_brief` 设计需要决定在哪里做 subject resolution。

## Recommended Fix Strategy

### P0 - 先让现有契约恢复类型通过

1. 新建或复用一个 `EMPTY_SCENE_WORLD_ANCHOR` helper，包含完整输出字段：

```ts
{
    startTime: null,
    endTime: null,
    startInstant: null,
    endInstant: null,
    subjectIds: [],
    locationSubjectId: null,
    subjects: [],
    locationSubject: null,
    unresolvedSubjectIds: [],
}
```

2. `PlotFacade.parseWorldAnchorDto()` 改用 input DTO 类型。
3. `SceneWorldContextService` 在所有分支返回 `unresolvedSubjectIds`。
4. 更新相关测试期望。

### P1 - 再设计真实 subject resolution

可选路线：

- 在 `PlotFacade.formatWorldAnchorDto()` 中调用 `worldEngineFacade.listSubjects(projectPath)`，批量 resolve 当前返回 DTO。
- 或新增 `SceneWorldAnchorResolutionService`，专门把 `subjectIds/locationSubjectId` 映射成 `{id,name,type,resolved}`。

推荐第二种，原因：

- Facade 已经承担了大量格式化职责，继续塞 subject resolution 会变胖。
- 后续 `get_chapter_writer_brief`、Workbench、Scene World Context 都需要复用同一套 resolution。

### P2 - 聚合 brief 复用 resolution

`get_chapter_writer_brief` 应直接消费 resolved World Anchor：

- 若 `unresolvedSubjectIds.length > 0`，brief 明确 warning。
- 若时间范围缺失，brief 标记该 Scene 不能查询 World Context。
- 若全部已 resolve，生成 writer 可用的 subject name / id / type 和查询提示。

## Design Impact

这次发现说明 P1 聚合 brief 工具不能只“拼 DTO”。必须先解决 subject resolution 的归属，否则聚合 brief 会把裸 id 和 unresolved placeholder 放大成 Agent 误解。

换句话说，下一阶段真正的技术切片应是：

1. 修复 DTO drift。
2. 抽 subject resolution。
3. 再做 chapter writer brief 聚合。

