# Round 266: Switch Confirm Side Effect

## Context

继续检查 Project 切换时的草稿保护顺序。Round 265 补上了 route/query 切换入口，但继续对账发现 `confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch()` 本身有副作用：

- 作者确认“放弃 World Engine 草稿并切换”后，函数会立刻关闭 Workbench 并清掉草稿标记。
- 随后如果普通 workspace 文件未保存对话里选择“取消”，Project 不会切换。
- 结果是普通文件成功挡住了切换，但 World Engine Workbench 会话草稿已经提前丢失。

这对作者来说会非常反直觉：最后明明取消了 Project 切换，却丢了 World Engine 草稿。

## Changes

- `app/pages/index.vue`
  - `confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch()` 改为纯确认函数，只返回用户是否同意放弃。
  - 不再在确认阶段直接写 `worldEngineWorkbenchOpen = false` 或 `worldEngineWorkbenchHasUnsavedDrafts = false`。
  - 真正切换发生后，`WorldEngineWorkbenchDialog` 会因为 `projectPath` 变化按既有 watcher 重置会话态；如果后续普通文件保存 / 取消阻止切换，则 World Engine 草稿仍保留。

- `app/utils/world-engine-ide-entry.test.ts`
  - 补充静态契约，要求确认函数返回 `action === "discard"`，并禁止回到“确认阶段直接关闭 Workbench + 清标记”的写法。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：同时留下 World Engine 草稿和普通文件未保存修改，切换 Project 时先确认放弃 World Engine 草稿，再在普通文件对话点取消；Project 不应切换，World Engine 草稿应仍在。

## Result

实际结果与本轮计划一致：只修正确认函数副作用，不改变 Workbench 草稿存储模型，不新增后端行为。
