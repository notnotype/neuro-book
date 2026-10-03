# 2026-06-29 Round 09 - Scene World Anchor Resolution Service

## Scope

本轮设计 `SceneWorldAnchorResolutionService`。目标是把 `subjectIds/locationSubjectId` 到可展示 subject 的解析从 Facade 私有 helper 中抽成稳定服务，供 Workbench、Scene World Context 和后续 chapter writer brief 复用。

本轮不修改业务代码。

## Current Evidence

当前相关逻辑分散在两处：

- `PlotFacade.formatWorldAnchorDto()`：加载 `worldEngineFacade.listSubjects(projectPath)`，把 `StorySceneWorldAnchorDto.subjectIds/locationSubjectId` 转成 `subjects/locationSubject/unresolvedSubjectIds`。
- `SceneWorldContextService.getSceneWorldContext()`：再次调用 `worldEngineFacade.listSubjects(projectPath)`，拆分 `resolvedSubjectIds/unresolvedSubjectIds`，只对 resolved subjects 查询 slices/state。

这两处职责相近，但输出不同：

- Facade 需要展示 DTO。
- Scene World Context 需要过滤查询参数和 warning。

## Problem

如果继续让每个服务自己 resolve subject，会出现三个风险：

1. Workbench 显示、World Context 查询、writer brief warning 对“unresolved”的定义可能不一致。
2. 每个聚合接口都重复 `listSubjects()`，chapter 多 Scene 时会重复查询。
3. `get_chapter_writer_brief` 若直接拼现有 DTO，可能把 unresolved placeholder 当成可信角色信息传给 Agent。

## Proposed Service

新增：

```text
server/plot/services/scene-world-anchor-resolution.service.ts
```

建议接口：

```ts
type SceneWorldAnchorSubjectResolution = {
    id: string;
    name: string;
    type: string;
    resolved: boolean;
};

type SceneWorldAnchorResolution = {
    subjects: SceneWorldAnchorSubjectResolution[];
    locationSubject: SceneWorldAnchorSubjectResolution | null;
    unresolvedSubjectIds: string[];
    resolvedSubjectIds: string[];
};

class SceneWorldAnchorResolutionService {
    async resolve(projectPath: string, anchor: {
        subjectIds: string[];
        locationSubjectId: string | null;
    }): Promise<SceneWorldAnchorResolution>;

    async resolveMany(projectPath: string, anchors: Array<{
        subjectIds: string[];
        locationSubjectId: string | null;
    }>): Promise<SceneWorldAnchorResolution[]>;
}
```

`resolveMany()` 是关键：chapter brief 会一次处理多个 Scene，应一次加载 subject map，再批量解析，避免 N 次 `listSubjects()`。

## Service Rules

- 只读 World Engine subject catalog。
- 不创建 subject。
- 不校验 Scene 是否应该包含某 subject；只判断 id 是否存在。
- 保留输入顺序并去重。
- `locationSubjectId` 可以同时出现在 `subjectIds` 中；`unresolvedSubjectIds` 去重后只出现一次。
- 未解析 subject 返回 `{id, name: id, type: "unknown", resolved: false}`，方便 UI/Agent 显示但不误判为真实 subject。

## Integration Plan

### P1a - Facade Output Uses Service

把 `PlotFacade.loadWorldSubjectMap()`、`resolveAnchorSubject()`、`formatWorldAnchorDto()` 中的 subject resolution 替换为 service 调用。

保持 `formatWorldAnchorDto()` 仍负责时间格式化：

- 时间：Facade 调 `worldEngineFacade.formatTime()`。
- subject：Resolution service 返回 `subjects/locationSubject/unresolvedSubjectIds`。

### P1b - SceneWorldContext Uses Service

`SceneWorldContextService` 不再直接构造 `subjectNameMap`，改用 service：

- `resolvedSubjectIds` 作为 `listSlices/queryState` 输入。
- `unresolvedSubjectIds` 原样返回。
- subject state name 从 resolution 结果中取。

### P1c - Chapter Brief Reuses Service

`ChapterWriterBriefService` 先调用 `resolveMany()`，再决定：

- unresolved subject 是 warning，不是静默忽略。
- 全部 unresolved 时跳过 World Context 查询，返回 `needs_world_context`。
- 有部分 resolved 时允许查询 resolved subjects，同时保留 warning。

## Dependency Injection

当前 `PlotFacade.createModuleFromExecutor()` 手动组装服务对象。第一版可以直接 new：

```ts
const sceneWorldAnchorResolutionService = new SceneWorldAnchorResolutionService(worldEngineFacade);
```

然后传给：

- `SceneWorldContextService`
- future `ChapterWriterBriefService`

Facade 自己也可使用同一实例格式化 DTO，避免另开路径。

## Tests Needed

新增聚焦测试：

- `resolve()`：subject 和 location 都存在，返回 resolved true 和 name/type。
- `resolve()`：subject 不存在，返回 placeholder 和 unresolved id。
- `resolve()`：subjectIds 与 location 重复，`unresolvedSubjectIds` 去重。
- `resolveMany()`：多个 anchor 只调用一次 `listSubjects()`。
- `SceneWorldContextService`：部分 unresolved 时只查 resolved subjects，并返回 unresolved warning。

## Design Decision

Resolution service 是可取的，但不应抢 P0 typecheck 修复。推荐顺序：

1. P0：修 `parseWorldAnchorDto()` 输入类型。
2. P1：抽 resolution service 并保持外部 DTO 不变。
3. P2：把 chapter writer brief 建在这个 service 上。

