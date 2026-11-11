---
schema: nbook.task/v2
taskId: t17-e2e-open-file-wait
status: planned
updated: 2026-11-10
---

# e2e 打开文件的等待

## 目标与范围

`e2e/markdown-input.e2e.ts`、`e2e/editor-area.e2e.ts` 的打开文件步骤凭一次 `aria-expanded` 决定点不点文件夹，恢复会话时可能把刚展开的收起来，文件没打开；`editor-area` 的“重新打开回到上次的光标”还有按键早于聚焦的问题。都只在负载下偶发。照 `markdown-editing.e2e.ts` 的写法改掉（[`docs/testing/README.md`](../../../../../docs/testing/README.md#测试写法)）。行为合同未变。

另一处（t20 记，2026-11-10）：`markdown-input.e2e.ts` 的“按快捷键打出的粗体、斜体、删除线”打完字紧接着按快捷键，负载 5–16 下失败过 3 次，写回成 `看**粗***斜删*`（关斜体、开删除线两次按键没生效）；单独跑或低负载下都过。先查是按键早于编辑器处理完输入（`keyboard.type` 打中文走 `insertText`），还是产品里存下的格式被冲掉，再决定改测试还是改产品。

又一处（t20 记，2026-11-11）：`markdown-editing.e2e.ts` 的“块菜单：下移、副本、删除”在负载 6 时失败一次，点了“删除”之后文件里那一块还在（写回 `二\n\n二\n一\n` 之类）；单独重跑 3 次都过。

## 当前状态

未开工。

## 下一步

开发者体验并审查 t08 之后再排。
