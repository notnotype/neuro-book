# 2026-06-30 Round 50 - HTTP Route Query Validation Contract

## Scope

本轮把 `get_chapter_writer_brief` 的 HTTP route、query validation 和 OpenAPI path 关系再收口。目标是避免 catch-all `projects/plot/[...segments].ts` 继续污染 OpenAPI 路径，同时保持运行时校验集中在 Plot service。

本轮不修改业务代码。

## Evidence

当前 HTTP 状态：

- `server/api/projects/plot/[...segments].ts` 是 Project Path query 版 Plot API。
- `GET /api/projects/plot/chapter?projectPath=...&chapterPath=...` 已通过 catch-all segments 分发。
- `GET /api/projects/plot/scenes/:sceneId/world-context?projectPath=...` 也通过同一个 catch-all 文件分发。
- route 文件里的 `defineRouteMeta()` 只能描述一个 operation，当前摘要写的是 world-context。

当前 OpenAPI 生成状态：

- `RouteMetaEntry` 只有 `file/method/tags/summary/requestBody/responseBody/queryParams`。
- `generate-spec.ts` 的 `buildPath(file, _entry)` 忽略 entry，只从 route file 推导 path。
- `projects/plot/[...segments].ts` 会被推导成 `/api/projects/plot/{...segments}` 这种无法表达具体 operation 的路径。
- 若继续给同一 catch-all file 添加多个 GET meta，OpenAPI paths 会互相覆盖或生成错误路径。

## Runtime Route Recommendation

新增 brief route 有两个可选实现：

### Option A: 继续放在 catch-all 文件

运行时分发：

```ts
if (method === "GET" && matchSegments(segments, ["chapter-writer-brief"])) {
    return plotFacade.getChapterWriterBrief(projectPath, requireChapterPathQuery(event));
}
```

优点：

- 延续当前 Project Path query 版 Plot API。
- 复用 `requireProjectPathQuery()` 和 `requireChapterPathQuery()`。

缺点：

- 必须先实现 OpenAPI explicit path，否则文档和 schema 会错。

### Option B: 新建实体 route 文件

例如 `server/api/projects/plot/chapter-writer-brief.get.ts`。

优点：

- OpenAPI 可从文件路径自然推导。

缺点：

- Plot API 会出现 catch-all 与实体 route 混用，可能需要确认 Nitro 路由优先级。
- 与当前 `chapter/world-context` catch-all 风格不一致。

本任务推荐 Option A，但前置条件是先做 `RouteMetaEntry.path?: string`。

## Query Validation Contract

HTTP 层只负责基础输入形状：

- `projectPath`：沿用 `requireProjectPathQuery(event)`。
- `chapterPath`：沿用或抽出 `requireChapterPathQuery(event)`，只做 trim/非空。

service 层负责业务校验：

- `PlotScopeGuard.assertChapterPath()` 做 Project Workspace 前缀归一、`manuscript/` 限制、目录尾斜杠、真实 chapter content-node 检查。
- `ChapterWriterBriefService` 只使用 guard 返回的 normalized chapterPath。

不要在 route handler 复制 `manuscript/`、尾斜杠、entryType 判断。否则 HTTP route、Agent tool 和内部 service 会形成多套校验。

## OpenAPI Explicit Path Contract

`RouteMetaEntry` 增加：

```ts
path?: string;
```

`buildPath(file, entry)` 优先使用：

```ts
if (entry.path) return entry.path;
```

然后为 catch-all Plot operations 显式声明：

- `/api/projects/plot/scenes/{sceneId}/world-context`
- `/api/projects/plot/chapter-writer-brief`

对应 query params：

- world-context：`projectPath`。
- chapter-writer-brief：`projectPath` + `chapterPath`。

测试需要证明两者都是 GET，但生成到不同 OpenAPI path，不互相覆盖。

## Result

`get_chapter_writer_brief` 可以继续落在 `projects/plot/[...segments].ts`，但必须先给 OpenAPI route map 增加 explicit `path`。HTTP 层保持轻校验，业务 path 归一化继续由 `PlotScopeGuard.assertChapterPath()` 统一承担。

