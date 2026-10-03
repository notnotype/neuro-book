# Round 332 - Preview Cancel Edit Busy Guard

## Context

Round 331 已让独立 Preview 的 Mutation Builder 在 `loadingWorld || actionBusy` 中禁用，并补齐大部分函数层 guard。继续检查写入区常用操作时，发现 `取消编辑` 入口还直接调用 `clearSliceEditMode()`。

`clearSliceEditMode()` 也被写入编辑成功、删除当前编辑 slice 后的内部清理复用。内部清理需要能在 `actionBusy` 期间执行；但用户点击“取消编辑”时，如果只靠 fieldset disabled，组件事件绕过后仍可能在 Project / 世界数据回流中重置编辑草稿。

## Changes

- `world-engine.preview.vue`
  - 新增 `requestClearSliceEditMode()` 作为用户点击入口。
  - 该入口在 `previewBuilderDisabled` 时直接返回。
  - `clearSliceEditMode()` 保留为内部清理函数，写入 / 删除成功后的流程仍可调用。
  - Preview Actions 的 `@clear-slice-edit-mode` 改为调用 `requestClearSliceEditMode`。
- `world-engine-ide-entry.test.ts`
  - 补充静态契约，确认用户取消编辑入口走 busy guard，而不是直接调用内部清理函数。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

本轮只区分用户入口和内部清理，不改变保存编辑成功或删除当前编辑 slice 后退出编辑模式的既有行为。
