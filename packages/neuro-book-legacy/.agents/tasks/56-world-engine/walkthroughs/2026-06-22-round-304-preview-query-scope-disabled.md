# Round 304 - Preview Query Scope Disabled

## 背景

独立 `/world-engine.preview` 的 `queryState()` 已经在函数入口要求 `subjectIds` 或 `type` 至少提供一个；为空时会显示 `查询必须提供 subjectIds 或 type`。

但 Query 面板里的 `查询状态` 按钮仍然只看 Project ready / action busy。作者清空查询范围后，按钮仍可点击，点下后才知道缺少查询 scope。

## 实际变更

- `WorldEnginePreviewActions.vue`
  - 新增 `canQueryState`。
  - `查询状态` 按钮现在要求 Project ready、非 busy，并且 `queryForm.subjectIds` 或 `queryForm.type` 至少一个非空。

- `world-engine.preview.vue`
  - 保留 `queryState()` 入口的 `查询必须提供 subjectIds 或 type` 校验，避免事件绕过按钮后直接请求后端。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview Query 按钮绑定 `canQueryState`。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有改变 `state/query` API 语义。
- 本轮没有自动浏览器验证，符合当前约定。
