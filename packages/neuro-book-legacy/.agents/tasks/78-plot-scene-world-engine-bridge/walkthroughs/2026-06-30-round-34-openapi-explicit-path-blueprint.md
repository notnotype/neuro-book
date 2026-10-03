# 2026-06-30 Round 34 - OpenAPI Explicit Path Blueprint

## Scope

本轮把 Round 29 Slice 2 拆成实现 blueprint。目标是先修 OpenAPI route metadata 的 Interface，再新增 `get_chapter_writer_brief` route，避免 catch-all path 互相覆盖。

本轮不修改业务代码。

## Current Evidence

当前真实状态：

- `server/openapi/route-map.ts` 的 `RouteMetaEntry` 只有 `file/method/tags/summary/requestBody/responseBody/queryParams`。
- `server/openapi/generate-spec.ts` 的 `buildPath(file, _entry)` 忽略 entry，只按文件名推导 path。
- `projects/plot/[...segments].ts` 是 catch-all route。
- route-map 当前已经用 `summary` 描述 `/projects/plot/scenes/:sceneId/world-context`，但实际 path 仍会由 catch-all file 推导。

## Target Interface

`RouteMetaEntry` 新增：

```ts
/** Explicit OpenAPI path override, e.g. "/api/projects/plot/scenes/{sceneId}/world-context" */
path?: string;
```

`buildPath()` 规则：

```ts
function buildPath(file: string, entry: RouteMetaEntry): string {
    if (entry.path) return entry.path;
    // existing file-derived path
}
```

## Required Paths

现有 world-context entry 应显式写：

```ts
path: "/api/projects/plot/scenes/{sceneId}/world-context"
```

后续 brief entry 应写：

```ts
path: "/api/projects/plot/chapter-writer-brief"
```

理由：

- `chapterPath` 是 query param，不适合 URL path segment。
- `projectPath` 继续用 query param，与现有 Project Path query 版本 Plot API 一致。

## Files

### `server/openapi/route-map.ts`

改动：

- `RouteMetaEntry` 增加 `path?: string`。
- world-context entry 增加 explicit path。
- 新增 brief route 时也必须带 explicit path。

### `server/openapi/generate-spec.ts`

改动：

- `buildPath(file, entry)` 优先返回 `entry.path`。
- `extractPathParams()` 会从 explicit path 中提取 `{sceneId}`，无需额外机制。

### `scripts/build/generate-openapi-meta.ts`

风险：

- 该脚本的 route meta 注入只生成 operation，不负责 spec path 组装。
- 但它使用 `RouteMetaEntry` 类型；新增字段后应不破坏注入。
- 如果后续生成 route file 内 `defineRouteMeta()` 也需要 path，则应统一复用 path 规则，不要在两个地方各写一套。

## Tests

建议新增或扩展 OpenAPI spec 测试：

```ts
const spec = generateOpenAPISpec();
expect(spec.paths["/api/projects/plot/scenes/{sceneId}/world-context"].get).toBeDefined();
expect(spec.paths["/api/projects/plot/chapter-writer-brief"].get).toBeDefined();
expect(spec.paths["/api/projects/plot/[...segments]"]).toBeUndefined();
```

如果当前测试不直接 export `generateOpenAPISpec()`，可测试公开 route `/_openapi.json` 或拆出 testable builder。

## Failure Modes To Avoid

- 只在 summary 写真实 URL，不改 path。
- 为 brief 单独拆物理 route 文件绕过 catch-all，但留下 plot catch-all route-map 缺陷。
- 让两个 GET operation 落在同一 OpenAPI path/method 下，后者覆盖前者。

## Result

OpenAPI explicit path 是 `get_chapter_writer_brief` 的前置切片。它不是文档美化，而是 route metadata Module 的 Interface 修复；不先做这步，brief route 一加就会继续扩大 catch-all route 的文档债。

