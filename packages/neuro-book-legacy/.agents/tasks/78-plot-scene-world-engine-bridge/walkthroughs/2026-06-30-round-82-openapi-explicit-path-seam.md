# Round 82: OpenAPI Explicit Path Seam

## Scope

本轮审查 Slice 2 的 OpenAPI 生成链路。结论是：`RouteMetaEntry.path?: string` 应作为 catch-all route 的明确 Interface，并且 `generate-spec.ts` 需要 duplicate operation guard。否则 `chapter-writer-brief` 会继续被压扁到同一个 `projects/plot/{...segments}` 形态。

## Current Evidence

- `server/openapi/route-map.ts`
  - `RouteMetaEntry` 只有 `file/method/tags/summary/requestBody/responseBody/queryParams`。
  - 当前 Plot Scene World Context 只能登记为 `file: "projects/plot/[...segments].ts"`。
  - summary 文字里写了真实公开路径 `/projects/plot/scenes/:sceneId/world-context`，但机器可读 path 仍由 file 推导。
- `server/openapi/generate-spec.ts`
  - `buildPath(file, _entry)` 明确忽略 entry。
  - `[...segments]` 不会被转成具体业务 path。
  - `buildOpenAPISpec()` 遇到同 path/method 会直接覆盖 `paths[path][entry.method]`，没有 duplicate guard。
- `server/api/projects/plot/[...segments].ts`
  - 文件内 `defineRouteMeta` 当前只描述 world-context。
  - 同一 catch-all handler 实际还承载 story/tree/workbench/chapter/phases/threads/scenes 等多个业务路径。

## Interface Problem

现在 OpenAPI 的 Interface 是“从文件名推导 path”。这个 Interface 对普通 file route 足够，但对 catch-all route 太浅：调用方必须知道 handler 内部 segments 分发逻辑，才能还原真实公开路径。

如果新增 `chapter-writer-brief` 时继续只用同一个 catch-all file，会出现两种风险：

- 两个 GET operation 都生成到同一个 `/api/projects/plot/{...segments}`。
- 后添加的 operation 覆盖先添加的 operation，spec 看起来存在但丢失 world-context 或 brief。

## Deepening Opportunity

把 `RouteMetaEntry` 加深：

```ts
export interface RouteMetaEntry {
    file: string;
    path?: string;
    method: "get" | "post" | "put" | "patch" | "delete";
    // ...
}
```

`buildPath(file, entry)` 的 Interface：

- 如果 `entry.path` 存在，直接返回 `entry.path`。
- `entry.path` 必须是以 `/api/` 开头的公开 path。
- 没有 `entry.path` 时继续使用 file 推导。

`buildOpenAPISpec()` 的 Interface：

- 写入 `paths[path][method]` 前检查是否已存在。
- 重复时抛错，错误信息包含 `method`、`path` 和两个 route entry 来源。

## Acceptance

最小测试应在 `server/openapi/generate-spec.test.ts` 覆盖：

- explicit path 优先于 file 推导。
- `/api/projects/plot/scenes/{sceneId}/world-context` 存在，且带 `sceneId` path param 和 `projectPath` query param。
- `/api/projects/plot/chapter-writer-brief` 存在，且带 `projectPath` / `chapterPath` query param。
- 两个 GET operation 不互相覆盖。
- 重复 `method + path` 会失败，而不是静默覆盖。

## Benefits

- **Leverage**：一个小的 route metadata Interface 支持所有 catch-all route 的真实公开 path。
- **Locality**：OpenAPI path 规则集中在 `generate-spec.ts`，不会散到每个 catch-all handler 的手写 `defineRouteMeta`。
- **Deletion test**：删除 explicit path 后，真实 path 知识会回流到 summary 文本、handler segments 判断和人工审查，说明这个 Interface 值得存在。

## Conclusion

OpenAPI explicit path 不是文档美化，而是 catch-all route 的机器可读 Interface。Slice 2 应先加 `path?: string` 和 duplicate guard，再添加 `chapter-writer-brief` route meta。

