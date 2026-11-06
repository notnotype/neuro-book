---
schema: nbook.task/v2
taskId: t17-e2e-open-file-wait
status: planned
updated: 2026-11-05
---

# e2e 打开文件的等待

## 目标与范围

`e2e/markdown-input.e2e.ts`、`e2e/editor-area.e2e.ts` 的打开文件步骤凭一次 `aria-expanded` 决定点不点文件夹，恢复会话时可能把刚展开的收起来，文件没打开；`editor-area` 的“重新打开回到上次的光标”还有按键早于聚焦的问题。都只在负载下偶发。照 `markdown-editing.e2e.ts` 的写法改掉（[`docs/testing/README.md`](../../../../../docs/testing/README.md#测试写法)）。行为合同未变。

## 当前状态

未开工。

## 下一步

开发者体验并审查 t08 之后再排。
