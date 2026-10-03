# Round 90: OpenAPI Meta Dual Consumer Gap

## Scope

本轮在 Round 89 之后重新按当前 worktree 复查 OpenAPI explicit path 的实现入口。没有修改业务代码；只确认是否存在新的实现约束。

## Evidence

- `server/openapi/route-map.ts` 的 `RouteMetaEntry` 目前只有 `file/method/tags/summary/requestBody/responseBody/queryParams`，没有 `path` override。
- `server/openapi/route-map.ts` 当前只用一条 catch-all entry 表达 `GET /api/projects/plot/scenes/:sceneId/world-context`，实际 file 是 `projects/plot/[...segments].ts`。
- `server/openapi/generate-spec.ts` 的 `buildPath(file, _entry)` 忽略 entry，只从 file 推导 path。因此 catch-all route 在 spec 中只能生成 `/api/projects/plot/[...segments].ts` 对应路径，不能表达 `/api/projects/plot/scenes/{sceneId}/world-context`。
- `scripts/build/generate-openapi-meta.ts` 也直接消费 `RouteMetaEntry`，用于向 route file 注入 `defineRouteMeta({ openAPI })`。它当前只根据 query/body/response 生成 operation，不从真实 path 提取 path params。
- `server/api/projects/plot/[...segments].ts` 当前自动注入的 `defineRouteMeta` 只有 `projectPath` query parameter，没有 `sceneId` path parameter。也就是说，仅修 `generate-spec.ts` 不足以让 route-local OpenAPI metadata 完整。

## Architecture Adjustment

OpenAPI explicit path 不是 `generate-spec.ts` 的局部补丁，而是 `RouteMetaEntry` 的共享 Interface：

- `RouteMetaEntry.path?: string` 应作为 route-map 的机器可读合同。
- `server/openapi/generate-spec.ts` 应优先使用 `entry.path` 生成 spec path，并从该 path 提取 path params。
- `scripts/build/generate-openapi-meta.ts` 也应读取 `entry.path`，把 path params 注入 route-local operation。否则 catch-all route 的 `defineRouteMeta` 会继续缺少 `sceneId/chapterPath` 等参数说明。
- 当同一个 catch-all file/method 需要表达多个真实 operation 时，route-map 可以有多个 entry 指向同一 file，但必须通过 explicit path 区分 operation；spec 生成阶段还需要 duplicate operation guard，禁止同一 `path + method` 静默覆盖。

## Impact On Slice 2

Round 89 的 Slice 2 `OpenAPI Explicit Path` 需要补充为：

1. 在 `RouteMetaEntry` 增加 `path?: string`。
2. `generate-spec.ts` 使用 explicit path，并增加 duplicate `path + method` guard。
3. `generate-openapi-meta.ts` 使用 explicit path 的 path params 生成 operation parameters。
4. `route-map.ts` 为现有 `world-context` entry 写明确 path。
5. 新增 `chapter-writer-brief` entry 时必须使用另一个明确 path，不能复用裸 catch-all path。
6. 测试至少证明：
   - spec 中存在 `/api/projects/plot/scenes/{sceneId}/world-context`；
   - spec 中后续存在 `/api/projects/plot/chapters/writer-brief` 或最终决定的 brief path；
   - 两个 GET operation 不互相覆盖；
   - generated route-local metadata 能包含 explicit path params。

## Conclusion

这不改变四个切片顺序，也不要求提前进入 brief service。它只扩大 Slice 2 的验收范围：OpenAPI explicit path 要覆盖静态 spec 和 route-local `defineRouteMeta` 两个消费者。否则 Agent / 文档 / UI 侧看到的 API metadata 仍可能不完整。
