# 2026-06-20 Mutation Editor Dirty State

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 目标是让底部 Mutation Editor 的 value 草稿状态与右侧 Inspector metadata dirty state 对齐：未修改时明确显示已同步，修改后明确显示未应用，并提供批量应用 / 还原。
- 不接真实 API，不改后端 DTO，不改变父页面 `updateMutationValue` 事件合同。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增 `dirtyMutationRows`、`dirtyValueDraftCount`、`valueDraftErrorCount`、`valueDraftStatusLabel`。
  - 标题栏新增 dirty / synced 状态 chip。
  - 展开态新增 `应用全部` / `还原全部` 批量按钮。
  - 内容区新增 `Draft Changes` 提示条，展示未应用 value 草稿数和解析错误数。
  - mutation 行新增 `dirty` badge，帮助用户定位具体未应用行。
  - 批量应用会先解析所有 dirty value；任一行解析失败时不写入 mock preview，避免半成功半失败。
- `world-engine-workbench-preview.test.ts`
  - 补充 Mutation Editor dirty state、批量动作和提示文案的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- Chrome CDP 交互验证，1366x900：
  - 展开 Mutation Editor 后显示 `已同步`，批量应用按钮禁用。
  - 修改当前 slice 的 mutation value 后显示 `未应用 1`、`Draft Changes`、行级 `dirty` badge，`应用全部` / `还原全部` 可用。
  - 点击 `应用全部` 后写入 mock reducer，顶部 notice 出现 `已更新 mutation`，Editor 回到 `已同步`，dirty 标记消失。
  - 再次修改 value 后点击 `还原全部`，草稿回到当前 mock 值，Editor 回到 `已同步`。

## Notes

- 第一次浏览器脚本选择器过宽，误选到了页面其它 input；随后改为 Mutation Editor section 内作用域验证，最终结果通过。
- 这轮仍是 mock preview 行为，真实 API 保存时机和错误出口留到接入真实 Workbench 时再定。
