# Round 125: OpenAPI Explicit Path Current Gap

## Scope

本轮转向 Slice 2 `OpenAPI Explicit Path`，只做代码证据核查和实现前收敛。没有改业务代码，没有运行测试。

## Current Evidence

只读核查结果：

- `server/openapi/route-map.ts`
  - `RouteMetaEntry` 只有 `file/method/tags/summary/requestBody/responseBody/queryParams`。
  - 没有 `path?: string`。
  - 没有 `emitRouteMeta?: boolean`。
  - `projects/plot/[...segments].ts` 目前只有一个 GET entry：world-context。
- `server/openapi/generate-spec.ts`
  - `buildPath(file, _entry)` 明确忽略 entry。
  - catch-all file 会被转换成 `/api/projects/plot/{...segments}`，不是 `/api/projects/plot/scenes/{sceneId}/world-context`。
  - `paths[path][entry.method] = operation` 直接赋值，没有 duplicate `path + method` guard。
- `scripts/build/generate-openapi-meta.ts`
  - 对 `routeMetaMap` 逐 entry 注入 `defineRouteMeta`。
  - 同一个 `file` 多个 entry 时会反复替换同一个 marker block，实际 last-wins。
  - `generateOpenAPIOperation()` 只从 `queryParams` 生成 parameters，没有从 explicit path 提取 path params。
- `server/api/projects/plot/[...segments].ts`
  - route-local `defineRouteMeta` 当前只代表 world-context。
  - handler 实际还承载 `story/tree/workbench/chapter/phases/threads/scenes` 等多个 logical operation。
  - world-context 分支是 `GET scenes/:sceneId/world-context`。

## Architectural Reading

这里的 Module 不是单个 generator，而是两个消费者共享同一个 route metadata Interface：

1. **Canonical OpenAPI Spec Module**
   - 由 `/_openapi.json` 调 `generateOpenAPISpec()` 生成。
   - 它可以、也应该表达同一 catch-all file 下的多个 logical operation。

2. **Route-local Metadata Module**
   - 由 `generate-openapi-meta.ts` 写入 `defineRouteMeta`。
   - Nitro route file 只能拥有一个 operation metadata block。
   - 它不能完整表达 catch-all file 的所有 logical operation，只能做 representative。

当前 `RouteMetaEntry.file` 被迫同时承担“物理 route file”和“公开 OpenAPI path”两种 Interface，导致 Module 变浅：caller 必须知道 catch-all route 的内部 segment 语义，generator 也无法防止覆盖。

## Required Interface Split

`RouteMetaEntry` 应增加：

```ts
interface RouteMetaEntry {
    file: string;
    method: "get" | "post" | "put" | "patch" | "delete";
    /** Public API path under /api, without leading /api. Defaults to file-derived path. */
    path?: string;
    /** Whether this entry may be injected into the physical route file's defineRouteMeta block. Defaults true. */
    emitRouteMeta?: boolean;
    // existing fields...
}
```

规则：

- `file` 继续表示 `server/api` 下的物理文件。
- `path` 表示公开 OpenAPI path，不带 `/api` 前缀，例如 `projects/plot/scenes/{sceneId}/world-context`。
- `buildPath(entry)` 优先用 `entry.path`；没有则保持 file-derived 逻辑。
- canonical spec 使用所有 entry。
- route-local meta 只使用 `emitRouteMeta !== false` 的 entry。
- 同一个 `file` 下多个 `emitRouteMeta` candidate 必须报错，不能 last-wins。

## Stop Condition

如果实现中发现 route-local `defineRouteMeta` 必须完整表达同一 catch-all file 的所有 logical operation，不能靠 last-wins 或合并 JSON 硬塞。应停止并把 canonical spec 作为唯一完整 OpenAPI 真相源，route-local metadata 退化为 representative 摘要。

## Conclusion

Slice 2 的核心不是给 world-context 改一个字符串路径，而是把 `file` 和 public `path` 拆成两个 Interface，并让 canonical spec 与 route-local metadata 各自承担能证明的范围。

