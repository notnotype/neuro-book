# Round 127: OpenAPI Spec Test Fixture

## Scope

本轮把 Slice 2 的 canonical spec 测试设计写清楚。没有改业务代码，没有运行测试。

## Current Gap

仓库目前没有 `server/openapi/generate-spec.test.ts`。`generateOpenAPISpec()` 只从全局 `routeMetaMap` 构建 spec，内部 `buildOpenAPISpec()` 不导出，导致很难用小 fixture 测 duplicate guard。

## Recommended Refactor

实现 Slice 2 时建议导出一个测试友好的纯函数：

```ts
export function buildOpenAPISpecForRoutes(entries: RouteMetaEntry[]): Record<string, unknown> {
    // current buildOpenAPISpec body, using passed entries
}

export function generateOpenAPISpec(): Record<string, unknown> {
    if (!cachedSpec) {
        cachedSpec = buildOpenAPISpecForRoutes(routeMetaMap);
    }
    return cachedSpec;
}
```

这不是额外 abstraction。它让 route metadata Interface 成为测试面，符合 “Interface is the test surface”。

## Canonical Spec Assertions

新增 `server/openapi/generate-spec.test.ts`，覆盖：

### 1. explicit path overrides catch-all file

Fixture：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "projects/plot/scenes/{sceneId}/world-context",
    tags: ["Plot Scenes"],
    summary: "Scene world context",
    queryParams: z.object({projectPath: z.string()}),
    responseBody: z.object({ok: z.boolean()}),
}
```

断言：

- `paths["/api/projects/plot/scenes/{sceneId}/world-context"].get` 存在。
- `paths["/api/projects/plot/{...segments}"]` 不因该 entry 产生。
- parameters 同时包含 path `sceneId` 和 query `projectPath`。

### 2. duplicate path + method throws

Fixture 两个 entry：

- 同 path：`projects/plot/chapter-writer-brief`
- 同 method：`get`

断言 `buildOpenAPISpecForRoutes(entries)` 抛错，错误信息包含 path 和 method。

### 3. same physical file can have multiple public paths

Fixture 两个 entry 同 file：

- `projects/plot/scenes/{sceneId}/world-context`
- `projects/plot/chapter-writer-brief`

断言两条 public paths 都存在，互不覆盖。

### 4. default file-derived path remains unchanged

Fixture 使用 `hello.get.ts` 或 `novels/[novelId].get.ts`，断言旧路径行为保持。

## Future Chapter Brief Entry

Slice 2 应提前支持未来 entry，即使 Slice 3 还没实现 DTO/service，也要明确目标形状：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "projects/plot/chapter-writer-brief",
    emitRouteMeta: false,
    tags: ["Plot Brief"],
    summary: "Build a scene/world-only chapter writer brief",
    queryParams: z.object({
        projectPath: z.string().trim().min(1),
        chapterPath: z.string().trim().min(1),
    }),
    responseBody: ChapterWriterBriefDtoSchema,
}
```

如果 `ChapterWriterBriefDtoSchema` 还没实现，Slice 2 不必提前添加这个 routeMeta entry；但 `generate-spec.test.ts` 必须用 fixture 证明同 file 多 public path 可行。

## Done Definition

Slice 2 完成后必须能证明：

- world-context canonical path 是 `/api/projects/plot/scenes/{sceneId}/world-context`。
- future chapter-writer-brief path 可与 world-context 共用同一 catch-all file。
- duplicate `path + method` 不会静默覆盖。
- route-local metadata 不会 last-wins。

## Conclusion

Slice 2 的最终证据应是 canonical spec 测试，而不是 route file 里某个 `defineRouteMeta` block 看起来正确。`/_openapi.json` 才是多 logical operation 的完整真相源。

