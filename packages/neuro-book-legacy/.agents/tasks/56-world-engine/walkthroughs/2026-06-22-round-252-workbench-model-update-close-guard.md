# Round 252: Workbench Model Update Close Guard

## Context

Round 251 给 Workbench 关闭动作补了会话草稿确认，但继续审查关闭路径时发现一个实现缝隙：

- `Dialog` 的 `request-close` 已接入 `requestWorkbenchClose()`。
- 但模板里的 `@update:model-value` 仍直接 `emit("update:modelValue", $event)`。
- 当前常见关闭路径大多走 `request-close`，但如果通用 Dialog 后续通过 v-model 直接发起关闭，仍可能绕过 Workbench 草稿确认。

这个问题不需要改 Dialog 组件，只需要让当前 Workbench 入口统一处理 v-model 更新。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `handleWorkbenchModelUpdate(value)`。
  - 当 `value === false` 时，统一转到 `requestWorkbenchClose()`，复用 Slice Composer / metadata / value 会话草稿确认。
  - 当 `value === true` 时继续向父层透传打开状态。
  - 模板中 `@update:model-value` 改为 `handleWorkbenchModelUpdate`。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确保 `@update:model-value` 不再直接透传关闭。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 存在 metadata / value 草稿时，通过 Workbench 顶部关闭、Esc 或其它 Dialog 关闭路径都应进入统一确认。

## Result

实际结果与计划一致：只补 Workbench 关闭入口的一处绕过风险，不改通用 Dialog、不扩大测试面。
