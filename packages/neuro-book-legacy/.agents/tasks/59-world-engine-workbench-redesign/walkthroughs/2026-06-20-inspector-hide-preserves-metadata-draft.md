# 2026-06-20 Inspector Hide Preserves Metadata Draft

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 发现右侧 Inspector 使用 `v-if="inspectorVisible && selectedSlice"`；隐藏 Inspector 会卸载组件，导致未应用 metadata 草稿丢失。
- 本轮改为隐藏时保留 Inspector 实例，让关闭右栏成为纯布局操作，不再丢用户输入。

## Changes

- `world-engine.workbench-preview.vue`
  - Inspector 从 `v-if="inspectorVisible && selectedSlice"` 改为：
    - `v-if="selectedSlice"`：只有没有 selected slice 时才卸载。
    - `v-show="inspectorVisible"`：隐藏右栏时保留组件实例和内部草稿。
- `world-engine-workbench-preview.test.ts`
  - 补充 `v-show="inspectorVisible"` 静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `重置 mock` 后打开 Inspector。
  - 修改当前 slice title 为 `隐藏后保留的标题草稿`，Inspector 显示 `未应用修改`。
  - 点击 `关闭检查器` 后，页面可见文本中不再有 `Slice Context`，但 draft input 仍在 DOM 中挂载。
  - 点击顶栏 `Inspector` 重新打开后，title 仍为 `隐藏后保留的标题草稿`，并继续显示 `未应用修改`。

## Notes

- 浏览器验证中，受限 evaluate 环境不能直接访问 `HTMLInputElement.prototype`；改用 locator fill 完成输入。这是验证脚本绕道，不影响页面实现。
- 当前修复保证“隐藏 / 再打开同一 selected slice”不丢草稿；如果用户在 Inspector 隐藏期间切换 selected slice，Inspector 仍会按现有 watcher 同步到新 slice。后续若要跨 slice 保留 metadata draft，可再引入类似 value draft summary 的父级草稿模型。
