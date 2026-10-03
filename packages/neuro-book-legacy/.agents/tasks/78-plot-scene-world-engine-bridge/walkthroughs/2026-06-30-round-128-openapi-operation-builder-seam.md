# Round 128: OpenAPI Operation Builder Seam

## Scope

本轮继续 Slice 2 `OpenAPI Explicit Path`，只读复查当前 OpenAPI 生成链路，并把实现顺序压成更小的原子补丁。没有改业务代码，没有运行测试。

## Current Evidence

只读核查结果：

- `server/openapi/route-map.ts`
  - `RouteMetaEntry` 仍只有 `file/method/tags/summary/requestBody/responseBody/queryParams`。
  - `projects/plot/[...segments].ts` 仍只有 world-context 一个 GET entry。
  - `scripts/build/openapi-route-map.ts` 只是 re-export，不是需要修改的 canonical source。
- `server/openapi/generate-spec.ts`
  - `buildPath(file, _entry)` 仍忽略 entry。
  - `buildOperation(entry)` 自己生成 path params 和 query params。
  - `buildOpenAPISpec()` 不导出，只消费全局 `routeMetaMap`。
  - 同 path/method 仍是 `paths[path][entry.method] = operation` 静默覆盖。
- `scripts/build/generate-openapi-meta.ts`
  - 自己复制了一套 `zodToJsonSchema()` 和 operation 生成逻辑。
  - `generateOpenAPIOperation(entry)` 只生成 query/body/response，不生成 explicit path params。
  - `main()` 逐 entry 调 `injectMeta(entry.file, metaCall)`，同一物理 file 多 entry 仍会 last-wins。
  - `main()` 无条件执行，当前 helper 不适合被测试直接 import。
- `package.json`
  - `generate:openapi` 运行 `bun scripts/build/generate-openapi-meta.ts`。
  - 测试框架是 Vitest，可新增窄测试文件。

## Architectural Reading

Slice 2 已经不是单个 `buildPath()` 小补丁。这里有两个 Adapter：

1. `generateOpenAPISpec()`：canonical spec Adapter，输出 `/_openapi.json`。
2. `generate-openapi-meta.ts`：route-local metadata Adapter，把 representative operation 写进 route file。

两个 Adapter 都需要同一套 route metadata Interface：public path、path params、query params、body、response。按 “Two adapters = real seam”，这里应有一个共享的 OpenAPI operation builder Module。否则 implementation 会复制 path extraction 和 parameter ordering，后续 `chapter-writer-brief` 加入时仍可能出现 canonical spec 正确、route-local metadata 漏 path params 的错配。

## Recommended Atomic Patch Order

### 1. RouteMetaEntry Interface

先改 `server/openapi/route-map.ts`：

```ts
export interface RouteMetaEntry {
    file: string;
    method: "get" | "post" | "put" | "patch" | "delete";
    path?: string;
    emitRouteMeta?: boolean;
    // existing fields...
}
```

同时把 world-context entry 改成：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "projects/plot/scenes/{sceneId}/world-context",
    emitRouteMeta: true,
    // existing metadata...
}
```

### 2. Shared Operation Builder Module

新增或抽出一个小 Module，集中这些 Interface 规则：

- `buildPublicApiPath(entry: RouteMetaEntry): string`
- `extractPathParams(path: string)`
- `buildOpenAPIOperation(entry: RouteMetaEntry)`
- `zodToJsonSchema(schema: unknown)`

这个 Module 的 Interface 不应知道 route-local 注入、文件写入或 spec cache。它只把一个 `RouteMetaEntry` 编译成 public path 和 operation。这样 canonical spec 与 route-local metadata 共用同一 implementation，获得 Locality。

### 3. Canonical Spec Builder

在 `server/openapi/generate-spec.ts` 中：

- 导出 `buildOpenAPISpecForRoutes(entries: RouteMetaEntry[])`。
- `generateOpenAPISpec()` 只负责 cache 和调用 `buildOpenAPISpecForRoutes(routeMetaMap)`。
- 在 `buildOpenAPISpecForRoutes()` 内加入 duplicate guard：同一个 public path + method 已存在时直接 throw，错误信息包含 method、path 和两个 summary/file。

这里的测试 surface 是 spec builder 的 Interface，而不是运行 HTTP route。

### 4. Route-local Representative Selector

在 `scripts/build/generate-openapi-meta.ts` 中：

- 增加 `selectRouteMetaRepresentatives(entries: RouteMetaEntry[])`。
- 按 `file` 分组。
- 每组筛选 `emitRouteMeta !== false`。
- 0 个跳过。
- 1 个注入。
- 多个直接 throw，错误列出 file 和 candidate summary。

为了测试 selector 和 operation generation，脚本需要避免 import 即执行 `main()`。可以把纯函数拆到可 import Module，或给当前脚本加 ESM main guard。文件写入仍留在 CLI Adapter 内。

### 5. Tests

最小测试面：

- `server/openapi/generate-spec.test.ts`
  - explicit path 覆盖 catch-all file。
  - world-context path 生成 `/api/projects/plot/scenes/{sceneId}/world-context`。
  - parameters 同时包含 path `sceneId` 和 query `projectPath`。
  - 同一物理 file 可生成多个 public paths。
  - duplicate `path + method` throw。
  - 无 `path` entry 保持 file-derived 旧行为。
- route-local representative selector 测试
  - 单 entry file 正常选中。
  - 同 file 多 entry 且只有一个 `emitRouteMeta !== false` 正常选中。
  - 同 file 多个候选直接 throw。
  - 全部 `emitRouteMeta === false` 跳过。

不建议把 `bun run generate:openapi` 作为唯一门禁。历史文档记录该脚本曾因旧 Plot route-map 条目报告缺失文件但仍退出成功；当前脚本代码也只是统计 failed，没有设置非零退出码。Slice 2 的强证据应来自纯函数测试和生成后对目标 route metadata 的定向检查。

## Stop Conditions

- 如果实现需要让 route-local `defineRouteMeta` 表达同一 catch-all file 的多个 logical operation，应停止。route-local metadata 只能是 representative；canonical spec 才是完整 truth source。
- 如果为了测试 `generate-openapi-meta.ts` 需要真实写入 route files，应停止并先抽纯函数或加 main guard。测试不应依赖修改工作区文件。
- 如果 duplicate guard 破坏了已有 route-map，不能绕过 guard。应先确认冲突是旧 route-map 垃圾条目还是真实 public path 冲突。

## Conclusion

Slice 2 的深 Module 应是“RouteMetaEntry -> public path + OpenAPI operation”的 operation builder。它把 public path、path params 和 query/body/response 规则集中在一个 Interface，canonical spec 与 route-local representative 两个 Adapter 共用 implementation。这样后续 `chapter-writer-brief` 加入时，Agent、文档和 route-local metadata 不会再次分叉。
