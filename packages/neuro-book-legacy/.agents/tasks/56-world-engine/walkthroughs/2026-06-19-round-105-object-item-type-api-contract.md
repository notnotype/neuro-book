# Round 105: object itemType API 契约测试

## 背景

第 103 / 104 轮已经在 facade 层补齐 `itemType: object` 的后端契约，并修复开放 object 子路径解析问题。下一步按流程应该进入浏览器用户流验收，但项目规则要求不要自动进行浏览器验证，需要用户明确放行。

本轮先做一个浏览器前的绕道补强：检查 `/api/projects/world-engine/**` HTTP 边界是否也覆盖 object itemType。这样即使后续进入真实浏览器，也能先排除 API body schema、日历字符串时间转换、state/query 和错误传播这几类风险。

## 变更

- 更新 `server/api/projects/world-engine/[...segments].test.ts`：
  - 测试 Project 默认 schema 增加：
    - `badges: collection itemType=object`
    - `notes: list itemType=object`
    - `memories: object itemType=object`
  - 新增 `HTTP 边界支持 object itemType 的写入、删除和查询`：
    - `GET schema` 确认 `badges` 投影包含 `itemType: object`。
    - `POST subjects` 使用日历字符串创建 `erina`。
    - `POST slices` 写入 object collection add / duplicate add / remove、object list append、开放 object 子路径 `memories.second`。
    - 再次 `POST slices` 写入错误的 string object item，断言返回 400 和 `notes 必须是 object`。
    - `POST state/query` 查询 `badges`、`notes`、`memories`，确认 object collection 按 stable JSON 去重/删除，list 和 open-object 子值正常保留。

## 验证

```powershell
bunx vitest run "server/api/projects/world-engine/[...segments].test.ts"
```

结果：1 个测试文件、6 个测试通过。

```powershell
bunx vitest run server/world-engine/world-engine.facade.test.ts
```

结果：1 个测试文件、36 个测试通过。

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- object itemType 现在同时有 facade 层和 HTTP API 层测试覆盖。
- API 边界确认仍使用项目日历字符串，不暴露 raw instant。
- 非 object item 的错误能通过 API 返回明确 400。
- 本轮没有自动做浏览器验证；这是按项目规则选择的绕道，等待用户明确允许后再进入真实浏览器用户流。

## 后续

- 用户放行后，进入浏览器验收：新建 Project，跑 object collection/list/open-object 的写入、删除、查询和 re-settle，并评估 Workbench / Preview 的实际好用程度。
