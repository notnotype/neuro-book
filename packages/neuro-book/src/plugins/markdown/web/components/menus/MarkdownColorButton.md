---
验证入口: EditorArea
标签: [state:local]
---

# MarkdownColorButton

文字颜色或高亮的按钮（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 1、6）：点了开色板，第一个是“默认”（去掉颜色），选了执行对应的命令并收起。工具栏与选区菜单共用。

`state:local`：色板的开关。

## 不支持

自定义颜色：写进 Markdown 的是字面量，色板之外的颜色暂时只能改源码。
