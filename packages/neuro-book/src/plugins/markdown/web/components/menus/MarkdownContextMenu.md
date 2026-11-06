---
验证入口: EditorGroup
标签: [state:local, env:clipboard]
---

# MarkdownContextMenu

正文右键菜单（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 20–23）：nb-ui 的 `ContextMenu`。剪贴板的路径见 `clipboard.ts`。

`state:local`：开关与位置。

## 不支持

粘贴文件或图片（Ctrl+V 照旧）；浏览器自带的右键菜单（拼写建议、翻译）被盖掉。
