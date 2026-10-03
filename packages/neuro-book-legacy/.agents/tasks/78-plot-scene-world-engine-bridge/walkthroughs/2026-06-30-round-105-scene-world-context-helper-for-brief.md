# Round 105: Scene World Context Helper For Brief

## Scope

本轮只读复核 `ChapterWriterBriefService` 如何复用 `SceneWorldContextService`。目标是避免 brief v1 逐 Scene 调 HTTP strict 方法并靠异常文案判断 status。没有改业务代码、没有运行测试。

## Current Evidence

`SceneWorldContextService.getSceneWorldContext(projectPath, sceneId)` 当前语义：

- 先 `ensureStory()`。
- 再 `scopeGuard.assertScene(story.id, sceneId)`。
- 再 `sceneRepository.findSceneById(sceneId)`。
- Scene 不存在抛 404。
- Scene 缺 `startInstant/endInstant` 抛 400：`Scene 尚未设置完整 World Engine 时间范围`。
- 没有 subject/location 时返回空 context。
- subject 全部 unresolved 时返回空 context + unresolved ids。
- 有 resolved subject 时查询 `listSlices()` 和 `queryState()`，并格式化 slice time。

这对 HTTP route 是正确的 strict contract，但不适合 brief 聚合：

- brief 需要一次处理一章多个 Scene。
- 某个 Scene 缺 anchor 不应让整个 brief 以 HTTP 400 失败，而应聚合为 `needs_world_anchor`。
- 全部 unresolved 或 World Context 查询失败需要影响 brief status，但不应靠捕获错误 message 分支。
- 已有 `findChapterScenesForBrief()` 后，brief 已经拿到 Scene 实体，不应再为每个 Scene 走 `sceneId -> assertScene -> findSceneById`。

## Decision

保留 `getSceneWorldContext(projectPath, sceneId)` 的 HTTP strict 语义，同时在 `SceneWorldContextService` 内新增 Scene 实体级 helper，供 brief service 复用。

建议形态：

```ts
type SceneWorldContextBuildResult = {
    context: SceneWorldContextDto;
    missingAnchor: boolean;
    warnings: string[];
};

async buildContextForScene(projectPath: string, scene: StoryScene): Promise<SceneWorldContextBuildResult>
```

语义：

- 不做 `ensureStory()`。
- 不做 `assertScene()`。
- 不查询 `findSceneById()`。
- 输入 Scene 实体已经由调用方的 scope/repository 查询保证。
- 如果缺 `startInstant/endInstant`：
  - 返回 `missingAnchor: true`
  - `context: {slices: [], subjectStates: [], unresolvedSubjectIds: []}`
  - warnings 包含“Scene 尚未设置完整 World Engine 时间范围”
- 如果 subject/location 为空：
  - 返回 empty context
  - 不阻断；由 brief status 层决定是否 warning。
- 如果全部 unresolved：
  - 返回 unresolved ids
  - 不查询 slices/state
  - brief status 层可判为 `needs_world_context`。
- 如果 World Engine 查询抛错：
  - 不吞掉错误；由 `ChapterWriterBriefService` 捕获并转成 scene warning / `needs_world_context`。

HTTP strict 方法可以改为：

```ts
const result = await this.buildContextForScene(projectPath, scene);
if (result.missingAnchor) {
    throwPlotBadRequest("Scene 尚未设置完整 World Engine 时间范围");
}
return result.context;
```

这样 HTTP 行为保持不变，brief 不需要复制 subject 收窄逻辑，也不依赖错误文案做业务判断。

## Why Not Batch Yet

本轮不建议先抽 batch World Context helper：

- 当前 World Engine facade 没有“一次查多 Scene 不同时间范围”的稳定接口。
- brief v1 一章内 Scene 数量通常很小，逐 Scene 查询可接受。
- 过早 batch 会把 status/warnings、时间范围、subject 解析和 query fan-out 混在一起，测试面变大。

如果后续真实章节包含大量 Scene，再考虑：

- 批量 subject identity 读取。
- 按相同时间范围合并 slice 查询。
- 对 `formatTime()` 做缓存。

## Test Surface

后续测试应拆开：

- `SceneWorldContextService`：
  - entity helper 对缺 anchor 返回 `missingAnchor` 而不是抛错。
  - HTTP strict 方法仍对缺 anchor 抛 400。
  - 全部 unresolved 不查 slices/state。

- `ChapterWriterBriefService`：
  - 缺 anchor 聚合为 `needs_world_anchor`。
  - 全部 unresolved 或 context 查询错误聚合为 `needs_world_context`。
  - 不通过匹配错误 message 判断 status。

## Conclusion

brief v1 应复用 `SceneWorldContextService` 的内部查询逻辑，而不是复用它的 HTTP strict 方法。最小系统性修复是新增 Scene 实体级 helper：HTTP 继续严格失败，brief 可以把缺失和查询失败变成可读 warnings 与 status。
