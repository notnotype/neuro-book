# Round 103: OpenAPI Meta Representative Flag

## Scope

本轮继续收敛 Slice 2 `OpenAPI Explicit Path` 的实现细节。Round 102 已确认 route-local `defineRouteMeta()` 不能作为同一 catch-all file 多 logical operation 的完整真相源；本轮把 `generate-openapi-meta.ts` 如何选择 representative operation 压成可执行方案。没有改业务代码、没有运行测试。

## Current Constraint

`generate-openapi-meta.ts` 的输出对象是：

```ts
defineRouteMeta({
    openAPI: { ... } as never,
});
```

这个形态是一个 operation 摘要，不是 OpenAPI `paths` map。当前没有证据证明它支持一个物理 route 文件内声明多个公开 path operation。

同时，`routeMetaMap` 需要在 canonical spec 层登记所有 logical operation：

- 当前：`GET /api/projects/plot/scenes/{sceneId}/world-context`
- 后续：`GET /api/projects/plot/chapter-writer-brief`

这两个 operation 都可能继续落在 `server/api/projects/plot/[...segments].ts`。

## Options

| 方案 | 做法 | 优点 | 风险 | 判断 |
| --- | --- | --- | --- | --- |
| A. 按 routeMetaMap 顺序选第一个 | `generate-openapi-meta.ts` group by file 后取 `entries[0]`。 | 改动最少。 | route-local representative 由数组顺序隐式决定；后续重排会改变生成结果。 | 不推荐作为最终方案。 |
| B. 多 entry 时 warning，仍取第一个 | 比 A 多一个提示。 | 避免完全静默。 | warning 容易被忽略，CI 不一定捕捉；仍是隐式选择。 | 可作为临时过渡，不是理想合同。 |
| C. 给 `RouteMetaEntry` 增加 `emitRouteMeta?: boolean` | canonical spec 使用所有 entry；route-local 生成只使用 `emitRouteMeta !== false` 的 entry。同一 file 多个 emit 候选时报错。 | 显式、可测试；避免 last-wins 和顺序耦合。 | `RouteMetaEntry` 多一个仅供 meta generator 使用的字段。 | 推荐。 |
| D. 拆实体 route 文件 | `chapter-writer-brief.get.ts` 独立文件。 | route-local metadata 自然一文件一 operation。 | 与当前 Project Plot catch-all API 风格不一致；可能引入 Nitro route 优先级问题。 | 仅作为 stop condition 后备。 |

## Decision

推荐采用 Option C：`emitRouteMeta?: boolean`。

建议接口：

```ts
export interface RouteMetaEntry {
    file: string;
    path?: string;
    method: "get" | "post" | "put" | "patch" | "delete";
    tags: string[];
    summary: string;
    requestBody?: z.ZodType | null;
    responseBody?: z.ZodType | null;
    queryParams?: z.ZodObject<any> | null;
    /** 是否向物理 route 文件注入 route-local defineRouteMeta；默认 true。 */
    emitRouteMeta?: boolean;
}
```

使用规则：

- `generateOpenAPISpec()` 忽略 `emitRouteMeta`，所有 entry 都进入 canonical spec。
- `generate-openapi-meta.ts` 按 `file` 分组。
- 每组内只允许一个 `emitRouteMeta !== false` 的 representative。
- 若同一 file 有多个 candidate，直接报错，要求把 secondary logical operation 标记为 `emitRouteMeta: false` 或拆出实体 route。
- 若同一 file 没有 candidate，可以跳过注入并输出 warning；但 Plot catch-all 应保留 world-context 作为 representative，以便 route-local metadata 至少包含 `sceneId` path param。

示例：

```ts
{
    file: "projects/plot/[...segments].ts",
    path: "/api/projects/plot/scenes/{sceneId}/world-context",
    method: "get",
    tags: ["Plot Scenes"],
    summary: "Get a story scene's filtered World Engine context",
    queryParams: ProjectRagProjectQuerySchema,
    responseBody: SceneWorldContextDtoSchema,
},
{
    file: "projects/plot/[...segments].ts",
    path: "/api/projects/plot/chapter-writer-brief",
    method: "get",
    tags: ["Plot Briefs"],
    summary: "Get a chapter writer brief assembled from Plot scenes and World Engine context",
    queryParams: ChapterWriterBriefQuerySchema,
    responseBody: ChapterWriterBriefDtoSchema,
    emitRouteMeta: false,
}
```

## Test Implications

Slice 2 推荐拆两个测试面：

1. `server/openapi/generate-spec.test.ts`
   - 使用 canonical route map 或 test helper 验证 explicit path。
   - 验证 world-context path params + query params。
   - 后续 brief entry 落地后验证两个 GET operation 都存在且不覆盖。
   - 验证 duplicate `path + method` 报错。

2. `scripts/build/generate-openapi-meta.test.ts` 或等价纯函数测试
   - 测 `emitRouteMeta: false` 的 entry 不参与 route-local representative 选择。
   - 测同一 file 多个 emit candidate 会报错。
   - 测 representative operation 会从 explicit path 提取 path params，并与 query params 合并。
   - 不要求 `defineRouteMeta()` 输出两个 logical operations。

为了测试 duplicate guard 和 grouping 逻辑，建议把当前私有逻辑拆成小的纯函数导出给测试：

- `buildOpenAPISpecFromEntries(entries)`
- `selectRouteMetaRepresentatives(entries)`
- `buildOpenAPIOperation(entry)` 或复用同名函数

这不是新架构层，只是把现有脚本内联逻辑变成可测函数。

## Impact On Implementation Order

Round 103 不改变四个切片顺序：

1. Profile Contract Cleanup
2. OpenAPI Explicit Path
3. Chapter Writer Brief Module
4. Agent Tool Binding

它只把 Slice 2 的实现细节变成明确合同，避免 `chapter-writer-brief` route map entry 加入后触发 route-local metadata 覆盖。

## Conclusion

`emitRouteMeta?: boolean` 是当前最小的系统性约束：canonical spec 继续完整登记所有 logical operation；route-local metadata 明确只选择一个 representative；同一物理 route 多 entry 不再靠数组顺序或最后写入决定生成结果。
