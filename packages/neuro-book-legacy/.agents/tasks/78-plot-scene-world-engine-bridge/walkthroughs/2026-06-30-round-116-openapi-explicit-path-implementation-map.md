# Round 116: OpenAPI Explicit Path Implementation Map

## Scope

本轮把 Slice 2 `OpenAPI Explicit Path` 从原则压到当前源码的实现地图。目标是后续实现时同时覆盖 runtime `/_openapi.json` 和 route-local `defineRouteMeta`，避免只修一个消费者。没有改业务代码、没有运行测试。

## Current Evidence

当前 `server/openapi/route-map.ts`：

- `RouteMetaEntry` 只有 `file/method/tags/summary/requestBody/responseBody/queryParams`。
- 没有 `path?: string`。
- 没有 `emitRouteMeta?: boolean`。
- `projects/plot/[...segments].ts` 当前只有一个 GET entry，summary 指向 Scene World Context。

当前 `server/openapi/generate-spec.ts`：

- `buildPath(file, _entry)` 忽略 entry。
- catch-all route 会生成 `/api/projects/plot/{...segments}` 或近似无效 path，而不是真实 logical endpoint。
- `paths[path][entry.method] = operation` 没有 duplicate guard；同一 path/method 后写会覆盖先写。

当前 `scripts/build/generate-openapi-meta.ts`：

- 对 `routeMetaMap` 每个 entry 都向物理 route file 注入 `defineRouteMeta`。
- 同一 file 多个 entry 会多次 replace 同一 marker，最终 last-wins。
- route-local metadata 没有 path params；它只表达 operation 摘要，不是 catch-all 多 operation 真相源。

当前 `server/api/projects/plot/[...segments].ts`：

- `GET /projects/plot/scenes/:sceneId/world-context` 已存在。
- `GET /projects/plot/chapter` 已存在，通过 query `chapterPath` 返回 chapter plot。
- 未来 `GET /projects/plot/chapter-writer-brief` 可以作为同一 catch-all file 的新 logical endpoint。

## Required Interface Changes

### `RouteMetaEntry`

新增：

```ts
path?: string;
emitRouteMeta?: boolean;
```

语义：

- `path` 是 OpenAPI public path override，例如 `/api/projects/plot/scenes/{sceneId}/world-context`。
- `emitRouteMeta` 只影响 route-local generator，不影响 canonical `generateOpenAPISpec()`。
- `emitRouteMeta` 默认 `true`，但同一 file 多 entry 时只能有一个 representative。

### `generate-spec.ts`

`buildPath(file, entry)` 优先：

```ts
if (entry.path) return entry.path;
```

同时添加 duplicate guard：

- 同一 `path + method` 重复时直接 throw。
- 不允许后写静默覆盖先写。

Path params 从 final path 提取。这样 explicit path 的 `{sceneId}` 能进入 parameters。

### `generate-openapi-meta.ts`

按 `file` 分组：

- 对每组筛选 `emitRouteMeta !== false` 的 entries。
- 0 个：跳过该 file，不注入。
- 1 个：注入该 representative entry。
- 多个：throw，要求 route-map 显式选择 representative。

route-local generator 应复用与 `generate-spec.ts` 一致的 path parameter extraction。它仍然不是完整多 operation source，只是物理 route 文件的 representative metadata。

## Route Map Entries

未来应至少有两个 explicit path entry：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "/api/projects/plot/scenes/{sceneId}/world-context",
    tags: ["Plot Scenes"],
    summary: "Get a story scene's filtered World Engine context",
    queryParams: ProjectRagProjectQuerySchema,
    responseBody: SceneWorldContextDtoSchema,
}
```

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "/api/projects/plot/chapter-writer-brief",
    emitRouteMeta: false,
    tags: ["Plot Scenes"],
    summary: "Build a writer-safe chapter brief from Plot scenes and World Engine context",
    queryParams: ChapterWriterBriefQuerySchema,
    responseBody: ChapterWriterBriefDtoSchema,
}
```

`ChapterWriterBriefQuerySchema` 应包含：

- `projectPath`
- `chapterPath`

不要把 `chapterPath` 放进 URL path segment。

## Tests

建议新增或扩展：

- `server/openapi/generate-spec.test.ts`
  - explicit `path` 优先于 file-derived path。
  - path params 从 explicit path 提取。
  - duplicate `path + method` throw。
  - generated spec 同时含 world-context 和 chapter-writer-brief。
- generator pure tests 或脚本级测试
  - 同 file 多 representative throw。
  - `emitRouteMeta: false` 不影响 canonical spec。
  - representative operation 包含 explicit path params。

## Stop Conditions

实现时遇到以下情况应停止：

- 为了 route-local metadata 牺牲 canonical spec 的多 logical operation。
- 继续让同一 physical file 多 entry last-wins。
- 把 `chapterPath` 设计成 URL path segment，导致中文/斜杠路径编码问题。
- brief route 在 OpenAPI 中复用 world-context 的 response schema。

## Conclusion

Slice 2 的 deep Module 是 OpenAPI route map Interface。它必须同时服务 canonical spec 和 route-local representative metadata；只修 `generate-spec.ts` 或只改 route file 的 `defineRouteMeta` 都不算完成。

