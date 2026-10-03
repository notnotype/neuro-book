# Round 102: OpenAPI Route-local Multi-operation Ceiling

## Scope

本轮只读复核 Slice 2 `OpenAPI Explicit Path` 的双消费者约束。重点是确认 `generate-openapi-meta.ts` 在同一个物理 catch-all route 文件承载多个 logical operation 时的行为边界。没有改业务代码、没有运行测试。

## Current Evidence

`server/openapi/route-map.ts`:

- `RouteMetaEntry` 仍只有 `file/method/tags/summary/requestBody/responseBody/queryParams`，没有 `path?: string`。
- 当前 world-context 只能登记为 `file: "projects/plot/[...segments].ts"`，真实公开路径只写在 summary 文本里。

`server/openapi/generate-spec.ts`:

- `buildPath(file, _entry)` 仍忽略 entry，只从 file 推导 path。
- `buildOpenAPISpec()` 写入 `paths[path][entry.method] = operation`，没有 duplicate operation guard。

`scripts/build/generate-openapi-meta.ts`:

- 直接遍历 `routeMetaMap`，对每个 entry 调 `injectMeta(entry.file, metaCall)`。
- `injectMeta()` 用同一个 `AUTO-GENERATED` marker 替换 `defineRouteMeta(...)` block。
- 如果未来 `routeMetaMap` 给 `projects/plot/[...segments].ts` 增加第二个 GET entry，脚本会反复替换同一物理文件的同一个 meta block，最终只留下最后一个 entry 的 operation。
- 当前生成的 `server/api/projects/plot/[...segments].ts` route-local metadata 只有 `projectPath` query param，没有 `sceneId` path param。

`server/routes/_openapi.json.get.ts`:

- `/_openapi.json` 直接返回 `generateOpenAPISpec()`。
- 文件注释明确 `_swagger` 和 `_scalar` 读取 `/_openapi.json`。因此 canonical OpenAPI 文档入口是 runtime generated spec，不是每个 route 文件里的 auto-generated `defineRouteMeta()`。

## Problem

Round 90 的“dual-consumer guard”方向正确，但需要再加一个上限说明：

- `generate-spec.ts` 可以通过 `RouteMetaEntry.path?: string` 完整表达同一 catch-all file 下的多个 logical operation。
- 当前 route-local `defineRouteMeta({ openAPI })` 形态只能稳定表达一个物理 route 的一个 operation 摘要。
- 在没有证据证明 Nitro / `defineRouteMeta` 支持一个文件内声明多个公开 path operation 的情况下，不应把“route-local metadata 完整覆盖所有 logical operation”写成 Slice 2 的验收标准。

否则实现时会出现两个坏选择：

1. 继续按 entry 循环写同一个文件，导致最后一个 operation 静默覆盖前一个。
2. 为了让 route-local metadata 也完整表达多个 logical operation，引入一个未知的 `defineRouteMeta` 多 operation 格式，扩大 Slice 2 风险。

## Decision

Slice 2 的 canonical proof 应是 `generateOpenAPISpec()`：

- 它必须生成 `/api/projects/plot/scenes/{sceneId}/world-context`。
- 后续 brief route 落地后，它必须生成 `/api/projects/plot/chapter-writer-brief`。
- 两个 GET operation 必须位于不同 path，且 duplicate `path + method` 直接失败，不能静默覆盖。

`generate-openapi-meta.ts` 的职责收窄为 route-local best-effort metadata：

- 仍应读取 explicit `entry.path`，把 representative operation 的 path params 注入 `parameters`，解决当前 world-context 缺 `sceneId` 的问题。
- 必须消除“同一文件多 entry 时最后一个覆盖前一个”的静默行为。
- 推荐按 `entry.file` 分组后生成一次；如果同一文件有多个 entry，选择一个 deterministic representative，并输出 warning，或要求 entry 显式标记 route-local representative。不要继续在循环中重复替换同一个文件。
- 不要用 route-local `defineRouteMeta()` 证明同一 catch-all file 的所有 logical operation 都已登记；这个证明应来自 `/_openapi.json` / `generateOpenAPISpec()`。

## Updated Slice 2 Patch Surface

1. `RouteMetaEntry`
   - 增加 `path?: string`，注释为公开 OpenAPI path override。
   - path 必须以 `/api/` 开头，使用 `{param}` 表达 path params。

2. `generate-spec.ts`
   - `buildPath(file, entry)` 优先返回 `entry.path`。
   - 写入 `paths[path][method]` 前增加 duplicate guard，错误信息包含 `method/path/file/summary`。
   - path params 继续由最终 path 提取。

3. `route-map.ts`
   - world-context entry 增加 `path: "/api/projects/plot/scenes/{sceneId}/world-context"`。
   - future chapter-writer-brief entry 使用 `path: "/api/projects/plot/chapter-writer-brief"`。
   - brief query schema 包含 `projectPath` 与 `chapterPath`，不要把 `chapterPath` 放进 URL path segment。

4. `generate-openapi-meta.ts`
   - 复用 explicit path 的 path param extraction，把 representative operation 的 path params 与 query params 合并。
   - 按 file 分组，避免多 entry 反复替换同一 auto-generated block。
   - 对同一 file 多 logical operations 明确 warning 或 representative 规则，不能静默 last-wins。

5. Tests
   - 新增 `server/openapi/generate-spec.test.ts`：验证 explicit path、path/query params、无 catch-all leaked path、duplicate guard。
   - 如测试 meta generator，重点验证 representative route-local metadata 包含 explicit path params，以及同 file 多 entry 不会 last-wins 静默覆盖。
   - 不要求 route-local `defineRouteMeta()` 在同一物理 catch-all 文件内完整列出 world-context 与 chapter-writer-brief 两个 logical operation。

## Stop Condition

如果实现时发现项目必须依赖 route-local `defineRouteMeta()` 而不是 `/_openapi.json` 来展示完整 API 文档，应停下重新评估：

- 要么把 `chapter-writer-brief` 拆成实体 route 文件；
- 要么确认并测试 `defineRouteMeta` 支持多 operation / multi path 的官方格式；
- 不要用手写多块 `defineRouteMeta()` 或重复 auto-generated block 绕过。

## Conclusion

这不改变四切片顺序，也不要求提前实现 brief service。它修正的是 Slice 2 的验收边界：canonical OpenAPI spec 必须完整表达 catch-all logical routes；route-local metadata 需要消除 silent overwrite 并补齐 representative path params，但不要被提升成多 operation 真相源。
