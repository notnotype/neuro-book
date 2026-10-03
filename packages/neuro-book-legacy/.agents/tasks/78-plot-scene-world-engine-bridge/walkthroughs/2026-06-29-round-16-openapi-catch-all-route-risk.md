# 2026-06-29 Round 16 - OpenAPI Catch-all Route Risk

## Scope

本轮专门检查 `get_chapter_writer_brief` 若新增 HTTP route 时，OpenAPI route-map 是否能正确表达 `server/api/projects/plot/[...segments].ts` 下的多个语义 GET route。

本轮不改业务代码。

## Current Evidence

当前 `RouteMetaEntry` 只有：

- `file`
- `method`
- `tags`
- `summary`
- `requestBody`
- `responseBody`
- `queryParams`

没有 `path`、`pathPattern` 或 `operationId` override。

`server/openapi/generate-spec.ts` 的 `buildPath(file, entry)` 实际只从 `file` 推导路径：

- 只移除 `.(get|post|put|patch|delete).ts` 后缀。
- 只把 `[param]` 转成 `{param}`。
- 不处理 `[...segments]`。
- 不处理没有 method suffix 的 catch-all 文件。

因此当前这条 route-map：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    summary: "Get a story scene's filtered World Engine context via /projects/plot/scenes/:sceneId/world-context",
}
```

按现有生成逻辑无法表达真实路径：

```text
/api/projects/plot/scenes/{sceneId}/world-context
```

它更可能被生成成类似：

```text
/api/projects/plot/[...segments].ts
```

同时，`buildOpenAPISpec()` 对相同 path + method 的写入是：

```ts
paths[path][entry.method] = operation;
```

如果未来为同一个 catch-all file 再加一个 GET entry，且仍无法区分真实 path，后面的 entry 会覆盖前面的 operation。

## Risk

直接在 `route-map.ts` 里新增第二条：

```ts
file: "projects/plot/[...segments].ts",
method: "get",
summary: "Get chapter writer brief"
```

风险有两个：

1. 真实 OpenAPI path 仍然不对。
2. 同 file / method 的多个 GET 语义可能互相覆盖，最终 spec 只剩一个。

这会让 `get_chapter_writer_brief` 的 HTTP 合同看起来登记了，实际文档和客户端生成都不可信。

## Options

| 方案 | 做法 | 优点 | 风险 | 判断 |
| --- | --- | --- | --- | --- |
| A. 暂不登记 OpenAPI | route-map 不加 brief route。 | 最快。 | API 合同缺失，后续工具/客户端文档不可查。 | 不推荐。 |
| B. 新建实体 route 文件 | 新增 `projects/plot/chapter-writer-brief.get.ts` 转调 facade。 | 复用现有 OpenAPI 推导，无需改 generator。 | 与 catch-all handler 重叠，Plot API 路由分散。 | 可作为短期救急，不推荐长期。 |
| C. 给 `RouteMetaEntry` 增加显式 path override | `path: "/api/projects/plot/scenes/{sceneId}/world-context"`，新增 brief route 用 `path: "/api/projects/plot/chapter-writer-brief"`。 | 最小系统性修复；catch-all 多语义 route 都能登记。 | 需要改 generator 和测试。 | 推荐。 |

## Recommended Fix

采用 **C：RouteMetaEntry 显式 path override**。

建议接口：

```ts
export interface RouteMetaEntry {
    file: string;
    method: "get" | "post" | "put" | "patch" | "delete";
    path?: string;
    tags: string[];
    summary: string;
    requestBody?: z.ZodType | null;
    responseBody?: z.ZodType | null;
    queryParams?: z.ZodObject<any> | null;
}
```

`buildPath()` 先看 `entry.path`：

```ts
function buildPath(file: string, entry: RouteMetaEntry): string {
    if (entry.path) return entry.path;
    // existing inferred path fallback
}
```

然后把现有 world-context route 改成：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "/api/projects/plot/scenes/{sceneId}/world-context",
    tags: ["Plot Scenes"],
    summary: "Get a story scene's filtered World Engine context",
    queryParams: ProjectRagProjectQuerySchema,
    responseBody: SceneWorldContextDtoSchema,
}
```

未来 brief route 登记为：

```ts
{
    file: "projects/plot/[...segments].ts",
    method: "get",
    path: "/api/projects/plot/chapter-writer-brief",
    tags: ["Plot Briefs"],
    summary: "Get a chapter writer brief assembled from Plot scenes and World Engine context",
    queryParams: ChapterWriterBriefQuerySchema,
    responseBody: ChapterWriterBriefDtoSchema,
}
```

## Tests Needed

新增或扩展 OpenAPI 测试：

- `generateOpenAPISpec()` 生成 `/api/projects/plot/scenes/{sceneId}/world-context`。
- `generateOpenAPISpec()` 生成 `/api/projects/plot/chapter-writer-brief`。
- 两个 path 都存在 GET operation，且 response schema 不互相覆盖。
- 没有显式 `path` 的旧 route 仍按文件名推导。

## Result

`get_chapter_writer_brief` 进入实现前，应先修 OpenAPI route-map 的 catch-all 表达能力。否则 HTTP route 可以工作，但 spec 会错误或被覆盖，后续工具文档和客户端生成都会留下隐性问题。

