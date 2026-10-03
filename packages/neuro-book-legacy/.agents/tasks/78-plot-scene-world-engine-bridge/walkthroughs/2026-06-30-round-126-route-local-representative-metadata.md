# Round 126: Route-Local Representative Metadata

## Scope

本轮继续 Slice 2，聚焦 `scripts/build/generate-openapi-meta.ts`。没有改业务代码，没有运行测试。

## Current Behavior

当前 generator 主循环是：

```ts
for (const entry of routeMetaMap) {
    const metaCall = generateDefineRouteMetaCall(entry);
    injectMeta(entry.file, metaCall);
}
```

对普通一文件一 operation route 没问题。对 `projects/plot/[...segments].ts` 这种 catch-all route，会出现两个问题：

- 同一物理文件多 entry 时，后一个 entry 替换前一个 marker block，形成 silent last-wins。
- route-local `generateOpenAPIOperation()` 没有 path 信息，无法为 explicit path 生成 `sceneId` 等 path params。

## Representative Rule

Route-local metadata 应采用 representative 规则：

1. 按 `entry.file` 分组。
2. 每个 file 中筛选 `entry.emitRouteMeta !== false`。
3. 如果候选为 0：跳过注入。
4. 如果候选为 1：注入该 representative operation。
5. 如果候选超过 1：直接失败并输出文件名和候选 summary。

这样可以把 silent last-wins 变成显式门禁。

## Path Parameter Rule

`generateOpenAPIOperation(entry)` 应复用和 canonical spec 一致的 path param extraction：

- 如果 entry 有 explicit `path`，从该 path 提取 `{sceneId}`。
- 生成 `{name:"sceneId", in:"path", required:true, schema:{type:"string"}}`。
- 再追加 query params。

world-context representative route-local metadata 应至少包含：

- path param：`sceneId`
- query param：`projectPath`
- response body：`SceneWorldContextDtoSchema`

未来 chapter-writer-brief entry 如果设置 `emitRouteMeta: false`，不会影响 route-local representative，但 canonical spec 仍应包含它。

## Why Not Merge Multiple Operations

把多个 logical operation 合并进一个 `defineRouteMeta` block 会让 route-local Interface 变复杂：

- Nitro 当前读取的是单个 route operation metadata，不是完整 route-map。
- 合并后无法表达同一 method 下的多个 public paths。
- 维护者会误以为 route-local metadata 是完整 truth source。

因此应明确：route-local metadata 是 representative，不是 canonical proof。

## Test Shape

建议给 generator 提取纯函数后测试：

- `selectRouteMetaRepresentatives(entries)`：
  - 单 entry file 返回该 entry。
  - 多 entry file 只有一个 `emitRouteMeta !== false` 时返回该 entry。
  - 多 entry file 多个 emit candidate 时抛错。
  - 全部 `emitRouteMeta === false` 时跳过。
- `generateOpenAPIOperation(entry)`：
  - explicit path 中 `{sceneId}` 进入 parameters。
  - queryParams 中 `projectPath` 仍进入 parameters。

如果当前不想抽太多函数，最低门禁是对 `generate-openapi-meta.ts` 增加按 file 分组的集成式断言，避免 last-wins。

## Conclusion

Slice 2 应把 route-local metadata 从“自动覆盖的副产物”改成“显式选择的 representative”。这能防止 chapter-writer-brief 加入后覆盖 world-context，或反过来覆盖 brief route 的本地文档。

