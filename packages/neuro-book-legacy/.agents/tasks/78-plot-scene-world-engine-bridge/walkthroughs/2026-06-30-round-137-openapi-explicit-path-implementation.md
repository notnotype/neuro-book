# Round 137: OpenAPI Explicit Path Implementation

## Scope

本轮完成 Slice 2 `OpenAPI Explicit Path`。目标是把 OpenAPI public path 从 physical route file 中拆出来，让 canonical spec 和 route-local `defineRouteMeta()` 共用同一个 operation builder，并阻止同一 `path + method` 静默覆盖。

本轮修改了 OpenAPI route map、spec builder、metadata generator、Plot catch-all route 的 generated metadata 和聚焦测试。没有进入 Slice 3 `Chapter Writer Brief Module`。

## Files Changed

### OpenAPI Interface / Builder

- `server/openapi/route-map.ts`
  - `RouteMetaEntry` 新增 `path?: string`，表示不带 `/api` 前缀的 public path。
  - `RouteMetaEntry` 新增 `emitRouteMeta?: boolean`，只控制 route-local `defineRouteMeta()` representative，不影响 canonical spec。
  - Plot route-map 从旧的不存在 physical files `novels/[novelId]/plot/**` 迁到真实 `projects/plot/[...segments].ts`，每个 logical operation 都有 explicit `projects/plot/**` path 和 `projectPath` query。
  - `GET /api/projects/plot/scenes/{sceneId}/world-context` 作为 route-local representative，`emitRouteMeta: true`。
  - 其他 Project Plot logical operations `emitRouteMeta: false`，避免同一 catch-all file 多 operation 争抢 route-local metadata。
  - 补入 `GET /api/projects/plot/chapter?projectPath=&chapterPath=` 的 route-map entry。

- `server/openapi/operation-builder.ts`
  - 新增共享 Module，集中实现 public path normalize、path params、query params、request body 和 responses。
  - canonical spec Adapter 与 route-local metadata Adapter 都复用它，避免双份规则 drift。

- `server/openapi/generate-spec.ts`
  - 改为使用共享 operation builder。
  - 导出 `buildOpenAPISpecForRoutes(entries)` 作为测试 seam。
  - 对重复 `path + method` 直接抛错，避免 silent overwrite。

### Route-local Metadata Generator

- `scripts/build/generate-openapi-meta.ts`
  - 改为复用 `buildOpenAPIOperation()`。
  - 新增 `selectRouteMetaRepresentatives(entries)`：按 physical file 分组，0 个 representative 跳过，1 个注入，多个直接失败。
  - 新增 ESM main guard，测试导入时不写 route files。
  - `runGenerateOpenAPIMeta()` 返回 `{injected, failed, selected}`。

- `server/api/projects/plot/[...segments].ts`
  - 通过 `bun run generate:openapi` 重新生成 route-local `defineRouteMeta()`。
  - generated metadata 现在包含 `sceneId` path parameter 和 `projectPath` query parameter。

### Tests

- `server/openapi/generate-spec.test.ts`
  - 覆盖同一 physical file 多 public path。
  - 覆盖 explicit path 的 path/query params。
  - 覆盖 duplicate `path + method` guard。
  - 覆盖当前真实 route map 不再暴露旧 `/api/novels/{novelId}/plot/**`，并暴露 Project Plot explicit paths。

- `server/openapi/generate-openapi-meta.test.ts`
  - 覆盖 route-local representative selector。
  - 覆盖同一 physical file 多 candidate 失败。
  - 覆盖 generated metadata 包含 explicit path params 和 query params。

- `server/api/projects/plot/[...segments].test.ts`
  - 补 `defineRouteMeta` test stub，让 generated metadata 不影响 handler 行为测试。

## Verification

### Focused Tests

命令：

```powershell
bun vitest run server/openapi/generate-spec.test.ts server/openapi/generate-openapi-meta.test.ts "server/api/projects/plot/[...segments].test.ts"
```

结果：

- 3 test files passed。
- 16 tests passed。

### Metadata Generation

命令：

```powershell
bun run generate:openapi
```

结果：

- `Generating OpenAPI meta for 40 route files from 60 route entries...`
- `Done. 40 routes updated, 0 failed.`

第一次运行曾暴露 19 个 failed route files，原因是 route-map 仍登记旧 `novels/[novelId]/plot/**` physical files，但这些文件在当前 Project Plot catch-all 架构中已经不存在。本轮没有用 `emitRouteMeta: false` 掩盖问题，而是把 Plot logical operations 系统性迁到真实 physical file + explicit public path。

### Route-local Metadata Proof

`server/api/projects/plot/[...segments].ts` 顶部 generated metadata 已包含：

- `sceneId` path parameter。
- `projectPath` query parameter。

这证明 route-local representative 也消费了 explicit path，不只是 canonical spec 修复。

## Actual Result / Plan Delta

计划是完成 `RouteMetaEntry.path/emitRouteMeta`、共享 operation builder、canonical duplicate guard、route-local representative selector 和纯函数测试。实际结果符合计划，并额外修正了 route-map 中旧 Novel Plot physical file drift。

该额外修正是必要的系统性修复：如果只给 world-context 加 explicit path，`generate:openapi` 仍会报告旧 Plot route files 缺失，canonical spec 也会继续描述不存在的 `/api/novels/{novelId}/plot/**`。现在 route-map 的 Plot Interface 与真实 `/api/projects/plot/**` handler 对齐。

本轮没有新增 `chapter-writer-brief` route-map entry，因为 Slice 3 DTO/service 尚未落地。后续该 entry 应使用同一个 `projects/plot/[...segments].ts` physical file、explicit `projects/plot/chapter-writer-brief` public path，并标记 `emitRouteMeta: false`。

## Remaining Work

下一步进入 Slice 3 `Chapter Writer Brief Module`：

1. 新增 `ChapterWriterBriefDtoSchema`。
2. 新增 `findChapterScenesForBrief()` read model。
3. 在 `SceneWorldContextService` 增加 Scene entity-level helper。
4. 新增 `ChapterWriterBriefService`，集中 status/warnings/markdown renderer。
5. 通过 facade 和 HTTP route 暴露 `GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=`。

不要跳过 Slice 3 直接绑定 Agent tool。
