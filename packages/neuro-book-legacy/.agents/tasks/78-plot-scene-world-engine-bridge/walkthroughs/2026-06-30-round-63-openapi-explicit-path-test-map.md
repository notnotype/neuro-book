# 2026-06-30 Round 63 - OpenAPI Explicit Path Test Map

## Scope

本轮只审计 OpenAPI explicit path 的实现与测试落点。目标是把 Slice 2 从“应该加 `path?: string`”推进到可执行验收地图。

本轮不修改业务代码。

## Evidence

当前 `server/openapi/route-map.ts`：

- `RouteMetaEntry` 只有 `file/method/tags/summary/requestBody/responseBody/queryParams`。
- `projects/plot/[...segments].ts` 的 world-context entry 只登记了 catch-all file。
- 没有显式公开 path，无法表达同一 catch-all file 下的多个 GET operation。

当前 `server/openapi/generate-spec.ts`：

- `buildPath(file, _entry)` 忽略 entry，只从文件名推导 path。
- `extractPathParams()` 已支持普通 `{sceneId}` 形式的 path param。
- `generateOpenAPISpec()` 带进程内 cache；测试应避免在同一进程动态改 `routeMetaMap` 后期待 cache 自动刷新。

当前 `server/api/projects/plot/[...segments].ts`：

- runtime 已分发 `GET scenes/:sceneId/world-context`。
- 文件头部 `defineRouteMeta()` 只描述 world-context 一个 operation，且属于生成结果，不应作为手工修复点。

当前测试：

- 没有明显的 `server/openapi/*.test.ts`。
- `server/api/projects/plot/[...segments].test.ts` 覆盖 runtime HTTP world-context，但不证明 generated OpenAPI path 正确。

## Required Implementation Shape

推荐实现仍是一个小的 OpenAPI metadata Module 修复：

1. `RouteMetaEntry` 增加 `path?: string`，含注释说明它是公开 OpenAPI path override。
2. `buildPath(file, entry)` 优先返回 `entry.path`；没有时保持当前文件名推导。
3. world-context route map entry 增加：
   - `path: "/api/projects/plot/scenes/{sceneId}/world-context"`
4. 后续 chapter-writer-brief route map entry 增加：
   - `path: "/api/projects/plot/chapter-writer-brief"`
5. 如需同步 route 文件头部 meta，使用现有生成链更新，不手改 auto-generated block。

## Test Map

新增 `server/openapi/generate-spec.test.ts`，直接调用 `generateOpenAPISpec()`。

最小断言：

```ts
const spec = generateOpenAPISpec() as {
    paths: Record<string, Record<string, {parameters?: Array<{name: string; in: string; required?: boolean}>}>>;
};

const worldContext = spec.paths["/api/projects/plot/scenes/{sceneId}/world-context"]?.get;
expect(worldContext).toBeDefined();
expect(worldContext?.parameters).toEqual(expect.arrayContaining([
    expect.objectContaining({name: "sceneId", in: "path", required: true}),
    expect.objectContaining({name: "projectPath", in: "query", required: true}),
]));
expect(spec.paths["/api/projects/plot/{segments}"]).toBeUndefined();
expect(spec.paths["/api/projects/plot/{...segments}"]).toBeUndefined();
```

等 `chapter-writer-brief` route map entry 落地后，同一测试追加：

```ts
expect(spec.paths["/api/projects/plot/chapter-writer-brief"]?.get).toBeDefined();
expect(spec.paths["/api/projects/plot/scenes/{sceneId}/world-context"]?.get)
    .not.toBe(spec.paths["/api/projects/plot/chapter-writer-brief"]?.get);
```

## Acceptance Gate

OpenAPI explicit path 完成时必须能证明：

- generated spec 存在 `/api/projects/plot/scenes/{sceneId}/world-context`。
- world-context operation 同时有 `sceneId` path param 和 `projectPath` query param。
- generated spec 不再把 catch-all route 暴露成 `/api/projects/plot/{segments}` 或等价错误路径。
- 加入 `chapter-writer-brief` 后，两个 GET operation 落在两个不同 path 下，不会互相覆盖。

## Result

Slice 2 的关键不是新增 route，而是修复 route metadata Interface。HTTP runtime 能跑只能证明 handler 分发；OpenAPI spec 正确才证明 Agent / 文档 / 客户端看到的公开合同没有继续被 catch-all 文件名污染。

