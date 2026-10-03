# 2026-06-29 Round 19 - Subject Resolution Reuse Strategy

## Scope

本轮检查 Scene World Anchor 的 subject resolution 是否应在实现 `get_chapter_writer_brief` 前先抽成服务。目标是避免 brief 成为第三套 unresolved 规则。

本轮不修改业务代码。

## Current Evidence

当前 subject resolution 分散在三处：

1. `PlotDtoAssembler.toStorySceneWorldAnchorDto()`
   - 从 DB 生成初始 DTO。
   - 默认把所有 subject 标为 unresolved。
   - 解析 `subjectIdsJson` 和去重。
2. `PlotFacade.formatWorldAnchorDto()`
   - 私有方法。
   - 调 `worldEngineFacade.listSubjects()`。
   - 把 `subjectIds/locationSubjectId` 解析成 `{id,name,type,resolved}`。
   - 生成 `unresolvedSubjectIds`。
3. `SceneWorldContextService.getSceneWorldContext()`
   - 自己解析 `subjectIdsJson`。
   - 自己调 `listSubjects()`。
   - 自己算 `resolvedSubjectIds/unresolvedSubjectIds`。

如果新增 `ChapterWriterBriefService`，会自然需要第四套：

- chapter scenes 的 resolved anchors。
- unresolved warning。
- 查询 Scene World Context 前判断哪些 scene 可查。

这会制造长期不一致风险。

## Decision

推荐在 brief v1 前或与 brief v1 同步抽出：

```text
server/plot/services/scene-world-anchor-resolution.service.ts
```

它不应是大抽象，只承担一件事：在当前 Project 的 World Engine subjects 目录下解析 Scene World Anchor。

## Proposed Contract

候选类型：

```ts
type SceneWorldAnchorResolution = {
    anchor: StorySceneWorldAnchorDto;
    resolvedSubjectIds: string[];
    unresolvedSubjectIds: string[];
};
```

候选方法：

```ts
class SceneWorldAnchorResolutionService {
    async resolveDto(projectPath: string, anchor: StorySceneWorldAnchorDto): Promise<SceneWorldAnchorResolution>;
    async resolveManyDto(projectPath: string, anchors: StorySceneWorldAnchorDto[]): Promise<SceneWorldAnchorResolution[]>;
}
```

`resolveManyDto()` 一次 `listSubjects()`，避免一章多 scene 时重复查 World Engine subject 目录。

## What It Should Own

- `subjectIds` 与 `locationSubjectId` 合并去重。
- unresolved subject id 的定义。
- `subjects/locationSubject` DTO 展示对象生成。
- subject name fallback：`subject.name || subject.id`。
- missing subject fallback：`name = id`、`type = "unknown"`、`resolved = false`。

## What It Should Not Own

- 不解析时间字符串；时间 parse/format 仍由 `PlotFacade.parseWorldAnchorDto()` 和 `worldEngineFacade.formatTime()` 处理。
- 不校验写入时 subject 必须存在；占位 subject 是合法状态。
- 不查询 slices / state；那属于 `SceneWorldContextService`。
- 不生成 writer brief warning；那属于 `ChapterWriterBriefService`。

## Integration Plan

### Step 1 - Extract Shared Resolution

把 `PlotFacade` 私有的：

- `loadWorldSubjectMap()`
- `formatWorldAnchorDto()` 中的 subject resolution 部分
- `resolveAnchorSubject()`
- `uniqueSubjectIds()`

迁移进新 service。

`PlotFacade` 仍负责：

- format time。
- 调新 service 补 `subjects/locationSubject/unresolvedSubjectIds`。

### Step 2 - Update SceneWorldContextService

`SceneWorldContextService` 通过新 service 解析 subject：

- 使用 `resolvedSubjectIds` 查询 `listSlices()` / `queryState()`。
- 使用同一套 `unresolvedSubjectIds` 返回 DTO。
- 保持当前行为：全部 unresolved 时返回空 context，不报错。

### Step 3 - Build Brief on Same Service

`ChapterWriterBriefService` 使用 `resolveManyDto()`：

- 一章所有 scene 只查一次 `listSubjects()`。
- warning 与 Workbench / Scene World Context 保持同一 unresolved 语义。

## Test Plan

新增：

```text
server/plot/services/scene-world-anchor-resolution.service.test.ts
```

覆盖：

- resolved subject 返回 name/type/resolved。
- unresolved subject 保留 id/name/type unknown。
- location subject 参与 unresolved 去重。
- subjectIds 保序去重。
- `resolveManyDto()` 只调用一次 `worldEngineFacade.listSubjects()`。

更新：

- `server/plot/assemblers/plot-dto.assembler.test.ts`
  - 保持 assembler 初始 unresolved DTO 行为。
- `server/plot/services/scene-world-context.service.test.ts`
  - 确认 unresolved 语义不变。
- 后续 `chapter-writer-brief.service.test.ts`
  - 直接消费同一 resolution service。

## Tradeoff

这个抽象不是为了形式拆分，而是因为当前已经有两套解析规则，brief 会变成第三套。抽服务能在代码设计上约束后续 Agent / UI / API 对 unresolved subject 的理解一致。

## Result

实现顺序建议调整为：

1. P1 profile/routing/schema 去旧语义。
2. OpenAPI catch-all path override。
3. `SceneWorldAnchorResolutionService` 抽取。
4. `get_chapter_writer_brief` v1。

这样 brief 工具不会建立在重复的 subject resolution 逻辑上。

