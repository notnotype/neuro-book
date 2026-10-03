# 2026-06-20 Mutation Editor Draft Queue

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上一轮已经让 value 草稿跨 slice 保留；本轮补齐“别处还有未应用草稿”的可见性，避免用户切到其他 slice 后忘记未应用修改。
- 仍不接真实 API，不改变父页面 `updateMutationValue` 事件合同。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增 `ValueDraftSummary`、`allDirtyValueDrafts`、`otherSliceDirtyDrafts`、`otherSliceDirtyDraftCount` 和 `nextOtherSliceDraft`。
  - 顶栏 dirty chip 从只显示当前 slice，升级为：
    - 当前 slice dirty：`未应用 N`。
    - 其他 slice dirty：`其他 N`。
    - 两者都有：`未应用 N · 其他 M`。
  - `Draft Changes` 提示条会同时显示当前切片和其他切片的未应用 value 数。
  - 当其他 slice 有未应用草稿时，显示 `跳到草稿` 按钮，点击后选择下一个草稿所在 slice。
  - 新增 `valueDraftKeyForSlice()`，让当前 slice 和全量 slice draft 扫描共用同一 key 规则。
- `world-engine-workbench-preview.test.ts`
  - 补充 draft queue、其他切片提示、跳转按钮和 key helper 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `重置 mock` 后展开 Mutation Editor。
  - 将 `slice-world-init` 的第 0 行 value 改为 `跨切片队列草稿`。
  - 选择 `艾莉娜抵达王都` slice 后，Editor 顶栏显示 `其他 1`。
  - `Draft Changes` 显示 `当前切片 0 个 · 其他切片 1 个 · 世界初始化：雨城进入持续暴雨 / world.era`。
  - 点击 `跳到草稿` 后返回 `slice-world-init`，第 0 行 value 仍为 `跨切片队列草稿`，并显示当前 slice dirty。

## Notes

- 浏览器验证中，Playwright 对 `mutation-editor-next-draft-slice` 的 locator click 出现超时；DOM 检查已确认按钮存在且可见，最终通过 visible DOM node 点击完成验证。
- 本轮没有实现跨 slice 一键全部应用；当前 `应用全部 / 还原全部` 仍只作用于当前 slice，避免用户在别的 slice 上误提交隐藏改动。
