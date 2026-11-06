---
标签: [state:local, state:inject]
别名: ["主题编辑器的字体分区", "Theme Editor Fonts"]
验证入口: ThemeEditor
---

# ThemeEditorTypography

主题编辑器的“字体”分区（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 9）：欢迎页标题与正文各一个字体栈，写进声明的 `fonts`。

## 布局

一句说明（浏览器列不出本机字体，字体栈要自己写）；欢迎页标题与正文各一块：小标题、一个输入、三个起点按钮（衬线、无衬线、等宽）加“用现有字体”，输入有值时下面显示一行用这个字体栈写的样例。

## 交互

- 输入停手后写入；清空或点“用现有字体”删掉这一项，`fonts` 里没有项时整个字段去掉。
- 起点按钮把对应字体栈整句填进输入。

## 数据

```ts
type Props = {model: ThemeEditorModel};
```

文字取自 `nbook.workbench` 的 `themeEditor.*`，经注入的翻译端口。
