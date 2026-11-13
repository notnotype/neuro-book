---
验证入口: EditorGroup
标签: [state:local, env:clipboard]
---

# MarkdownContextMenu

正文右键菜单（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 20–23）：nb-ui 的 `ContextMenu`。剪贴板的路径见 `clipboard.ts`。

“添加批注”在粘贴那一节之后（输出 20），没有可加批注的选区时置灰，点了发 `comment`，由 `MarkdownMenus` 转给批注层；菜单开着时发 `open`，批注浮层据此不弹。

`state:local`：开关与位置。

## 不支持

粘贴文件或图片（Ctrl+V 照旧）；浏览器自带的右键菜单（拼写建议、翻译）被盖掉。
