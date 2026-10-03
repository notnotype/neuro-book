# Round 267: Route Cancel URL Restore

## Context

继续检查 route/query 触发 Project 切换的取消路径。Round 265 / 266 已经让 World Engine 草稿不会绕过确认、也不会在后续取消时提前丢失，但取消本身还有一个可见状态问题：

- 用户通过地址栏 / 深链 / route query 触发 Project 切换。
- World Engine 草稿确认或普通 workspace 未保存文件对话中选择取消。
- 实际 workspace 保持在旧 Project，但浏览器 URL 已经停在目标 Project query。

这会让作者误以为当前已经切到目标 Project，之后再打开 Workbench 或文件树时容易误判上下文。

## Changes

- `app/pages/index.vue`
  - 新增 `restoreCurrentWorkspaceRoute()`。
  - 如果当前实际 workspace 是 user-assets，取消切换时把 URL 恢复为 `workspace/.nbook`。
  - 如果当前实际 workspace 是普通 Project，取消切换时复用 `normalizeNovelRouteQuery()` 恢复到当前 `currentNovelId`。
  - `syncWorkspaceRoute()` 在 World Engine 草稿确认取消、普通 workspace 未保存文件对话取消两条路径上都会先恢复 URL，再返回。

- `app/utils/world-engine-ide-entry.test.ts`
  - 补充静态契约，要求两个取消分支都调用 `restoreCurrentWorkspaceRoute()`。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：在有 World Engine 草稿或普通文件未保存修改时，通过修改 `?project=` 触发切换并取消，地址栏应回到当前实际 workspace。

## Result

实际结果与本轮计划一致：只修复取消 route/query 切换后的 URL / workspace 不一致，不改 Workbench 草稿模型、不改后端。
