# Round 133: OpenAPI Explicit Path Implementation Entry

## Scope

本轮继续只读探索 Slice 2 `OpenAPI Explicit Path` 的实际开工入口。Round 125-128 已经确认要加 `path/emitRouteMeta` 和共享 operation builder；本轮重新核对当前 worktree，补齐补丁顺序、测试边界和 stop conditions。没有修改业务代码，没有运行测试。

## Current Evidence

### Route Map Interface

`server/openapi/route-map.ts` 当前 `RouteMetaEntry` 只有：

- `file`
- `method`
- `tags`
- `summary`
- `requestBody`
- `responseBody`
- `queryParams`

仍没有：

- `path?: string`
- `emitRouteMeta?: boolean`

当前 world-context entry 是：

- `file: "projects/plot/[...segments].ts"`
- `method: "get"`
- `summary` 文案中写了 `/projects/plot/scenes/:sceneId/world-context`
- 但机器可读 path 仍只能从 catch-all file 推导

这意味着 `RouteMetaEntry.file` 仍同时承担物理 route file 和 public OpenAPI path 两个角色，是当前 Slice 2 要拆开的 Interface。

### Canonical Spec Adapter

`server/openapi/generate-spec.ts` 当前状态：

- `buildPath(file, _entry)` 忽略 entry。
- path 仍由 file 推导。
- `buildOperation(entry)` 自己生成 path/query/body/response。
- `buildOpenAPISpec()` 不导出，只使用全局 `routeMetaMap`。
- `paths[path][entry.method] = operation` 会 silent overwrite，没有 duplicate guard。
- `generateOpenAPISpec()` 有 cache，不适合直接拿全局 route map 做动态 fixture 测试。

因此 canonical spec 目前不能证明同一个 physical catch-all file 可以表达多个 logical public path。

### Route-local Metadata Adapter

`scripts/build/generate-openapi-meta.ts` 当前状态：

- 自己复制 `zodToJsonSchema()` 和 operation 生成逻辑。
- `generateOpenAPIOperation(entry)` 只生成 query/body/response，不生成 explicit path params。
- `main()` 对每个 entry 都 `injectMeta(entry.file, metaCall)`，同一 file 多 entry 会 last-wins。
- `main()` 无条件执行，无法安全 import 纯函数测试。
- `injectMeta()` 只统计 failed，`main()` 没有设置非零退出码。

这说明 `generate:openapi` 不能作为唯一验收门禁；需要先抽测试友好的纯函数或加 ESM main guard。

### Catch-all Route Metadata

`server/api/projects/plot/[...segments].ts` 当前生成的 `defineRouteMeta`：

- summary 是 world-context。
- parameters 只有 query `projectPath`。
- 没有 path `sceneId`。

这证明只靠 route-local metadata 当前不能表达 `/api/projects/plot/scenes/{sceneId}/world-context` 的完整 Interface。后续加入 `chapter-writer-brief` 后，route-local metadata 也不能表达多个 logical operation；它只能选 representative。

### Extra Route Map File

`scripts/build/openapi-route-map.ts` 只是 re-export `server/openapi/route-map.ts`。它不是新的 truth source，不应单独维护。

## Target Interface

`RouteMetaEntry` 应扩展为：

```ts
export interface RouteMetaEntry {
    file: string;
    method: "get" | "post" | "put" | "patch" | "delete";
    path?: string;
    emitRouteMeta?: boolean;
    tags: string[];
    summary: string;
    requestBody?: z.ZodType | null;
    responseBody?: z.ZodType | null;
    queryParams?: z.ZodObject<any> | null;
}
```

约束：

- `file` 是 physical file，相对 `server/api/`。
- `path` 是 public path，不带 `/api` 前缀或统一由 builder normalize；实现时必须选一种并写入注释。此前 rounds 倾向 `path: "projects/plot/scenes/{sceneId}/world-context"`，由 builder 统一加 `/api/`。
- `emitRouteMeta` 只影响 route-local metadata selector，不影响 canonical spec。

world-context entry 应补：

```ts
path: "projects/plot/scenes/{sceneId}/world-context",
emitRouteMeta: true,
```

future `chapter-writer-brief` entry 应补：

```ts
file: "projects/plot/[...segments].ts",
method: "get",
path: "projects/plot/chapter-writer-brief",
emitRouteMeta: false,
```

这样 canonical spec 使用两个 entry；route-local metadata 只选 world-context 作为 representative，避免同 file 多 operation last-wins。

## Implementation Entry Order

1. **RouteMetaEntry patch**
   - 增加 `path?: string` 和 `emitRouteMeta?: boolean`。
   - world-context entry 先加 explicit path。
   - 不提前加 brief route entry，除非 Slice 3 DTO 已存在；Slice 2 测试可以用 synthetic entries。

2. **Shared operation builder Module**
   - 建议新增 `server/openapi/operation-builder.ts` 或同级小 Module。
   - 提供：
     - `buildPublicApiPath(entry)`
     - `extractPathParams(path)`
     - `buildOpenAPIOperation(entry)`
     - `zodToJsonSchema(schema)`
   - 该 Module 不处理 cache、不写文件、不知道 `defineRouteMeta`。

3. **Canonical spec Adapter**
   - `generate-spec.ts` 改为复用 operation builder。
   - 导出 `buildOpenAPISpecForRoutes(entries)`。
   - `generateOpenAPISpec()` 只保留 cache + 调用 `buildOpenAPISpecForRoutes(routeMetaMap)`。
   - 增加 duplicate `public path + method` guard，错误信息包含 method/path/file/summary。

4. **Route-local metadata Adapter**
   - `generate-openapi-meta.ts` 复用 operation builder。
   - 新增 `selectRouteMetaRepresentatives(entries)`：
     - 按 `file` 分组。
     - 候选是 `emitRouteMeta !== false`。
     - 0 个跳过。
     - 1 个注入。
     - 多个 throw。
   - 把 `main()` 改成可测试结构：抽纯函数到可 import Module，或加 ESM main guard。
   - 文件写入仍留在 CLI Adapter 内。

5. **Tests**
   - 新增 `server/openapi/generate-spec.test.ts` 或同层 tests。
   - 新增 route-local selector / operation builder 纯函数测试。
   - 不依赖真实写 route files。

## Minimum Test Matrix

### Canonical spec

- 无 `path` entry 保持 file-derived path。
- `path` entry 生成 `/api/projects/plot/scenes/{sceneId}/world-context`。
- world-context operation parameters 同时包含：
  - path `sceneId`
  - query `projectPath`
- 同一 physical file 的 synthetic entries 可以生成两个 public paths。
- duplicate public path + method throw。
- generated spec 不再暴露 `/api/projects/plot/{segments}` 或 `/api/projects/plot/{...segments}` 作为 world-context truth source。

### Operation builder

- `buildPublicApiPath()` 对 `path` 做统一 `/api/` prefix。
- `extractPathParams()` 从 `{sceneId}` 提取 path param。
- query/body/response 与现有 behavior 等价。

### Route-local representative

- 单 file 单 candidate 正常选中。
- 同 file 多 entry，只有一个 `emitRouteMeta !== false` 正常选中。
- 同 file 多个 candidate throw。
- 同 file 全部 `emitRouteMeta === false` 跳过。
- selected operation 含 explicit path params；当前 world-context route-local metadata 应补出 `sceneId`。

## Stop Conditions

- 为了通过测试而让 `defineRouteMeta` 表达同一 catch-all file 的多个 logical operation：停止。route-local metadata 只能是 representative；canonical spec 才是完整 truth source。
- 为了测试 `generate-openapi-meta.ts` 而真实写 route files：停止。先抽纯函数或 main guard。
- duplicate guard 发现已有冲突时，不要 silent overwrite。先判断 route-map 是垃圾条目还是 public path 真冲突。
- `path` 字段既有带 `/api` 又有不带 `/api` 的混用：停止并统一 Interface。
- `generate:openapi` 出现 failed 但仍 exit 0 时，不把它当成通过证据；必须补纯函数测试或改 CLI 失败语义。

## Deep Module Check

Slice 2 的深 Module 是 “RouteMetaEntry -> public path + OpenAPI operation” 的 operation builder。它的 Interface 小，但隐藏了：

- file-derived path 兼容。
- explicit public path override。
- path params extraction。
- query params extraction。
- request/response JSON schema 转换。
- duplicate-sensitive operation assembly。

canonical spec 和 route-local metadata 是两个 Adapter。按 “Two adapters = real seam”，共享 operation builder 不是过度抽象，而是当前已经存在的重复 implementation 的 locality 修复。

## Conclusion

当前 OpenAPI 代码仍未进入 Slice 2 实现状态。下一步真正开工时，不应只改 `buildPath()`；应先明确 `RouteMetaEntry.path/emitRouteMeta` Interface，再抽共享 operation builder，最后分别改 canonical spec Adapter 和 route-local representative Adapter。这样 future `chapter-writer-brief` route 才不会再次被 catch-all path 或 last-wins metadata 覆盖。
