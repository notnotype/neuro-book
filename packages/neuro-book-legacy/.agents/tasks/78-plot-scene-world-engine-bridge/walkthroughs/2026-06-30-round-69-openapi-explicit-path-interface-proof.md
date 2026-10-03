# Round 69: OpenAPI Explicit Path Interface Proof

## Context

本轮继续只读探索 OpenAPI explicit path 切片。目标不是实现代码，而是把 OpenAPI route metadata 作为 Agent-facing / tool-facing Interface 重新取证，避免后续 `get_chapter_writer_brief` route 落地后文档和实际路由继续漂移。

已读取：

- `server/openapi/route-map.ts`
- `server/openapi/generate-spec.ts`
- `server/api/projects/plot/[...segments].ts`
- `server/routes/_openapi.json.get.ts`

## Current Evidence

`RouteMetaEntry` 当前字段只有：

- `file`
- `method`
- `tags`
- `summary`
- `requestBody`
- `responseBody`
- `queryParams`

没有显式 `path?: string`。`generate-spec.ts` 的 `buildPath(file, _entry)` 只从文件名推导：

- 移除 `.get.ts` / `.post.ts` 等后缀。
- 将 `[param]` 转成 `{param}`。
- 移除 `/index`。

这对普通 Nitro file route 足够，但对 `server/api/projects/plot/[...segments].ts` 这种 catch-all Module 不够。当前 route map 里 world-context 只写：

```ts
file: "projects/plot/[...segments].ts"
method: "get"
summary: "Get a story scene's filtered World Engine context via /projects/plot/scenes/:sceneId/world-context"
queryParams: ProjectRagProjectQuerySchema
responseBody: SceneWorldContextDtoSchema
```

同时 `server/api/projects/plot/[...segments].ts` 顶部 auto-generated route meta 只有 `projectPath` query parameter，没有 `sceneId` path parameter。也就是说当前 OpenAPI Interface 无法真实表达：

```text
GET /api/projects/plot/scenes/{sceneId}/world-context?projectPath=...
```

## Interface Problem

OpenAPI 这里不是普通文档，它是 route 的机器可读 Interface。后续 `chapter-writer-brief` 如果继续加在同一个 catch-all file 上，会出现三类风险：

1. **Path 失真**：生成 `/api/projects/plot/{segments}` 或接近 catch-all 的路径，而不是业务公开 path。
2. **Operation 覆盖**：同一 `file + method` 的多个业务语义可能写到同一个 `paths[path].get`。
3. **参数缺失**：world-context 需要 `sceneId` path parameter；brief route 需要 `chapterPath` query parameter。当前 metadata 只能表达 query，不能从 catch-all 内部推导 path params。

## Required Shape

`RouteMetaEntry` 应新增：

```ts
path?: string;
```

语义：

- `path` 是公开 OpenAPI path，必须以 `/api/` 开头。
- 如果 `path` 存在，`buildPath(file, entry)` 直接返回 `entry.path`。
- 如果不存在，沿用旧 file 推导逻辑。

world-context route map entry 应变为：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "/api/projects/plot/scenes/{sceneId}/world-context",
    tags: ["Plot Scenes"],
    summary: "...",
    queryParams: ProjectRagProjectQuerySchema,
    responseBody: SceneWorldContextDtoSchema,
}
```

后续 brief route entry 应为：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "/api/projects/plot/chapter-writer-brief",
    tags: ["Plot Scenes"],
    summary: "Get a chapter writer brief compiled from Plot scenes and World Engine context",
    queryParams: ChapterWriterBriefQuerySchema,
    responseBody: ChapterWriterBriefDtoSchema,
}
```

## Test Surface

建议新增 `server/openapi/generate-spec.test.ts`，直接测 `generateOpenAPISpec()` 输出：

- `paths["/api/projects/plot/scenes/{sceneId}/world-context"].get` 存在。
- world-context operation 有 `sceneId` path param，`required: true`。
- world-context operation 有 `projectPath` query param，`required: true`。
- 不存在 `/api/projects/plot/{segments}`、`/api/projects/plot/{...segments}` 或 `/api/projects/plot/[...segments]`。
- 后续 brief route 加入后，`paths["/api/projects/plot/chapter-writer-brief"].get` 与 world-context 同时存在，互不覆盖。

## Additional Generator Guard

可以考虑在 `buildOpenAPISpec()` 内加 duplicate guard：如果同一个 `path + method` 已存在，应抛出错误。这样后续 route map 误配不会静默覆盖 operation。

这不是必须的第一步，但它能提高 OpenAPI Module 的 Depth：调用者只需要看 spec，不需要知道 catch-all file 内部路由分发规则。

## Conclusion

OpenAPI explicit path 切片的核心不是“让 swagger 好看”，而是把 catch-all route 的业务 Interface 从 file path 推导里抽出来。后续 `get_chapter_writer_brief` 是 Agent-facing 能力，必须先让 OpenAPI spec 能表达两个独立 GET operation，否则工具、文档和真实 route 会继续有三套说法。
