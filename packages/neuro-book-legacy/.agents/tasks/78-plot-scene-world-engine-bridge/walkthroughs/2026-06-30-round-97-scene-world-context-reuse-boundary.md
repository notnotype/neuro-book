# Round 97: Scene World Context Reuse Boundary

## Scope

本轮继续只读确认 `ChapterWriterBriefService` 应如何复用现有 Scene World Context 逻辑。没有改业务代码、没有运行测试。

## Current Evidence

- `SceneWorldContextService.getSceneWorldContext(projectPath, sceneId)` 是现有 HTTP/API 严格入口：它先 `ensureStory()`、`assertScene()`、`findSceneById()`，再查询 World Engine。
- 该方法在 Scene 缺少完整 `startInstant/endInstant` 时直接抛出 `"Scene 尚未设置完整 World Engine 时间范围"`。
- Scene 没有 subject/location 时返回空 context，且不查询 World Engine。
- Scene 全部 subject 都是占位时返回空 context + `unresolvedSubjectIds`，且不查询 slices/state。
- 正常查询时使用 `listSubjectIdentities()` 先做 calendar-free identity 解析，再用 resolved subjectIds 调 `listSlices({from,to,withPatches:true,subjectMode:"any"})` 与 `queryState({subjectIds,at:endInstant})`。
- `listSubjectIdentities()` 明确不加载 schema/calendar，服务 Plot ↔ World Engine 桥接读取；`formatTime()` 则会加载 calendar。
- `listSlices()` 的 World Engine 查询语义是闭区间 `instant >= from && instant <= to`，且 `subjectMode` 必须和非空 subjectIds 一起提供。
- `scene-world-context.service.test.ts` 已覆盖 subject/location 收窄、缺时间拒绝、无 subject 不查询 World Engine、全部 unresolved 不查询 slices/state。

## Interpretation

`ChapterWriterBriefService` 不能直接逐 Scene 调用现有 `getSceneWorldContext(projectPath, sceneId)` 作为唯一复用点：

1. brief 已经通过 `findChapterScenesForBrief()` 拿到 Scene，若再按 sceneId 调用会重复 `assertScene()` 和 `findSceneById()`。
2. HTTP/API 入口的缺时间语义是抛错；brief 需要聚合为 `needs_world_anchor`，而不是让整章 brief route 失败。
3. brief status 需要区分 `needs_world_anchor` 与 `needs_world_context`，不能靠捕获错误 message 做业务判断。
4. future markdown renderer 需要每个 Scene 的 warning，而不是单个 API error。

更好的复用边界是在 `SceneWorldContextService` 内部增加一个以 Scene 实体为输入的 read helper，例如：

```ts
buildSceneWorldContext(projectPath: string, scene: StoryScene): Promise<SceneWorldContextDto>
```

现有 `getSceneWorldContext(projectPath, sceneId)` 保持 HTTP 严格 Interface：负责 story/scope/scene existence，再调用这个 helper。`ChapterWriterBriefService` 则先用自己的 chapter read model 判断缺少 anchor 的 Scene，只有 anchor 完整时才调用 helper 获取 context。

## Batch Decision

第一版不需要立即抽批量 `getManySceneWorldContexts()` Interface。

原因：

- Chapter 通常只有 1 个 Scene，多 Scene 章节数量有限。
- 当前 World Engine facade 的查询接口以单个时间范围为核心；跨 Scene 批量会引入 slice/time range 合并、subject 去重和结果回填，Interface 会变复杂。
- `ChapterWriterBriefService` 的首要目标是 Locality：把 status precedence、warnings 和 markdown 信息边界集中起来。过早批量化会把性能优化和业务聚合绑在一起。

保留后续加深点：如果真实章节中多 Scene brief 明显重复查询 `listSubjectIdentities()` 或 `formatTime()`，再把 subject identity resolution 抽成可批量复用的内部 Module，或在 `SceneWorldContextService` 内部提供 batch helper。

## Acceptance Impact

Slice 3 实现时应按这个顺序验收：

1. `SceneWorldContextService.getSceneWorldContext()` 的现有 HTTP 严格行为保持不变，现有测试继续覆盖。
2. 新 helper 复用同一套 subject resolution、slice filtering、state query 和 formatted time 语义。
3. `ChapterWriterBriefService` 不捕获 `"Scene 尚未设置完整 World Engine 时间范围"` 这类 message 来判定状态；它应在查询 context 前主动检查 anchor completeness。
4. 缺时间、缺 subject、全部 unresolved、World Context 查询失败分别进入明确 warning/status，而不是变成 HTTP 500 或吞成 ready。
5. 如后续新增 batch helper，必须用 fixture 证明输出与单 Scene context helper 等价。

## Plan Deviation

本轮原计划只判断是否直接复用 `getSceneWorldContext()`。实际结论更细：保留该方法作为 HTTP strict Adapter，新增 Scene 实体级 helper 给 brief service 复用；暂不引入批量 Interface。
