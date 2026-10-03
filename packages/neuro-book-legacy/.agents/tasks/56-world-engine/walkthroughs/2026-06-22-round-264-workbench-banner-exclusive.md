# Round 264: Workbench Banner Exclusive

## Context

继续按真实作者操作流检查主 Workbench。保存、删除、同步、Review Queue 定位等动作现在会在顶部显示 `error` 与 `notice` 两条独立 banner。

如果作者先看到一次成功提示，再触发一次失败，旧成功提示可能和新错误提示同时显示。这个问题不影响后端状态，但会让作者误判当前操作到底成功还是失败。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `setWorkbenchError()` / `setWorkbenchNotice()`。
  - 非空错误提示会清掉旧成功提示。
  - 非空成功 / 提示消息会清掉旧错误提示。
  - 主 Dialog 中保存 slice、示例世界、创建 / 同步 subject、删除 slice、Review Queue 定位、subject timeline 提示、Slice Composer 保存等入口改走互斥 helper。
  - 子组件 `@error` / `@notice` 事件也改走 helper，避免直接写入父层 `error` / `notice`。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约，锁住互斥 helper 与子组件事件绑定，防止后续回退成直接赋值。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：先制造一次成功提示，再制造一次保存或删除失败，顶部只应显示当前失败；反向操作时旧错误也会被新成功提示清掉。

## Result

实际结果与本轮计划一致：只收口主 Workbench 顶部提示状态，不改后端、不扩展 API、不新增复杂测试。
