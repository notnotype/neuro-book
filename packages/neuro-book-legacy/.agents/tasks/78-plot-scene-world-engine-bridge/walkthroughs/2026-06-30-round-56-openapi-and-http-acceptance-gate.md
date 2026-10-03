# 2026-06-30 Round 56 - OpenAPI And HTTP Acceptance Gate

## Scope

本轮将 OpenAPI explicit path 和 brief HTTP route 的验收门槛写清楚。目标是让 Slice 2 / Slice 3 的完成证据可检查，而不是只看 route handler 能跑。

本轮不修改业务代码。

## Evidence

当前 OpenAPI 生成器：

- `RouteMetaEntry` 没有 `path?: string`。
- `generate-spec.ts` 的 `buildPath(file, _entry)` 忽略 entry，只从 file 推导路径。
- `projects/plot/[...segments].ts` 当前只能在 route map 中登记一个 GET operation。
- 当前登记的是 world-context，且 path 会从 catch-all file 推导，不是 `/api/projects/plot/scenes/{sceneId}/world-context`。

当前 Plot HTTP handler：

- `GET /api/projects/plot/chapter?projectPath=...&chapterPath=...`
- `GET /api/projects/plot/scenes/:sceneId/world-context?projectPath=...`
- `requireChapterPathQuery()` 只做 trim/非空。
- 业务归一化和存在性校验在 `PlotScopeGuard.assertChapterPath()`。

## Slice 2 Acceptance

OpenAPI explicit path 的完成标准：

1. `RouteMetaEntry` 增加 `path?: string`。
2. `buildPath(file, entry)` 优先返回 `entry.path`。
3. route map 为 world-context 显式声明：
   - `path: "/api/projects/plot/scenes/{sceneId}/world-context"`
4. world-context operation 的 OpenAPI 参数包含：
   - path param `sceneId`
   - query param `projectPath`
5. 新增或更新测试证明：
   - generated spec 中存在 `/api/projects/plot/scenes/{sceneId}/world-context`。
   - 不再把它作为 `/api/projects/plot/{...segments}` 暴露。

## Slice 3 HTTP Acceptance

`get_chapter_writer_brief` route 的完成标准：

1. HTTP route：
   - `GET /api/projects/plot/chapter-writer-brief?projectPath=...&chapterPath=...`
2. route map：
   - `file: "projects/plot/[...segments].ts"`
   - `method: "get"`
   - `path: "/api/projects/plot/chapter-writer-brief"`
   - `queryParams` 包含 required `projectPath` 和 required `chapterPath`
   - `responseBody: ChapterWriterBriefDtoSchema`
3. handler：
   - match `segments === ["chapter-writer-brief"]`
   - 复用 `requireProjectPathQuery()`
   - 复用或抽出 `requireChapterPathQuery()`
   - 调 `plotFacade.getChapterWriterBrief(projectPath, chapterPath)`
4. service：
   - 返回 normalized `chapterPath`
   - 业务错误由 service/guard 抛出，不在 handler 重复校验。

## OpenAPI Collision Test

必须证明两个 catch-all GET operation 不互相覆盖：

- `/api/projects/plot/scenes/{sceneId}/world-context`
- `/api/projects/plot/chapter-writer-brief`

建议测试断言：

```ts
const spec = generateOpenAPISpec();
expect(spec.paths["/api/projects/plot/scenes/{sceneId}/world-context"].get).toBeDefined();
expect(spec.paths["/api/projects/plot/chapter-writer-brief"].get).toBeDefined();
expect(spec.paths["/api/projects/plot/{...segments}"]).toBeUndefined();
```

如果 OpenAPI 生成器仍无法正确提取 explicit path param，应先修 `extractPathParams()` 对 `{sceneId}` 的支持；当前实现已支持普通 `{name}`，所以主要缺口是 catch-all file 不应参与 path 推导。

## Result

OpenAPI 和 HTTP 验收必须分开：HTTP 能跑只证明 runtime route；OpenAPI explicit path 证明 API 合同不会被 catch-all 覆盖。`get_chapter_writer_brief` 合格落地前，必须先让 world-context 和 brief 两个 GET operation 在 generated spec 中拥有独立路径。

