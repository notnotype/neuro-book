# 2026-06-20 Mutation Editor Collapsed Draft Toolbar

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 前几轮已经补齐 value draft dirty state、跨 slice draft queue 和 `清空草稿`；本轮把这些草稿操作延伸到 Mutation Editor 折叠态。
- 目标是让底部面板收起后，用户仍能看到并处理未应用 value 草稿，而不必先展开面板。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 标题栏新增 `mutation-editor-next-draft-toolbar`。
  - 标题栏新增 `mutation-editor-clear-all-drafts-toolbar`。
  - 当其他 slice 有未应用草稿时，折叠态也显示 `跳到草稿`。
  - 当任意 slice 有未应用草稿时，折叠态也显示 `清空草稿`。
  - 展开态的 `Draft Changes` 区块保留原有按钮，标题栏按钮作为始终可达的快捷入口。
- `world-engine-workbench-preview.test.ts`
  - 补充标题栏草稿按钮的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `重置 mock` 后展开 Mutation Editor。
  - 将 `slice-world-init` 的第 0 行 value 改为 `折叠态草稿`。
  - 切到 `艾莉娜抵达王都` 后收起 Mutation Editor。
  - 折叠标题栏显示 `其他 1`、`跳到草稿`、`清空草稿`。
  - 点击 `跳到草稿` 后回到 `slice-world-init`，标题栏显示 `未应用 1` 和 `清空草稿`。
  - 再切到 `艾莉娜抵达王都` 并收起，点击标题栏 `清空草稿` 后，标题栏回到 `已同步`，两个草稿按钮消失。

## Notes

- 浏览器验证中，刷新后的第一次 visible DOM 仍偶发为空；重新读取后页面已完整挂载，继续验证通过。该现象记录为浏览器验证环境时序绕道，不是页面行为问题。
- 当前标题栏按钮只处理 value draft，不处理 Inspector metadata draft；metadata draft 仍在 Inspector 内完成应用 / 还原。
