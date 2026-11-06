---
标签: [state:local, state:inject]
别名: ["主题编辑器的活动栏与画框分区", "Theme Editor Chrome"]
验证入口: ThemeEditor
---

# ThemeEditorChrome

主题编辑器的“活动栏与画框”分区（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 10）：活动栏的面、前景、当前项与两端装饰，浮层画框的线色。改的是当前明暗的那一套。

## 布局

两块。活动栏：小标题、一个“使用自己的活动栏”开关；打开后是面（颜色或渐变）、前景、当前项、两端装饰四行 `ColorField`。画框：小标题、一句说明、线色一行。

## 交互

- 打开开关：用当前配色的侧栏背景、主文字与强调色补全三个必填项再写入；关掉整个去掉活动栏声明（回到主题包的活动栏）。
- 两端装饰清空就是不画；线色清空就是不画框。
- 活动栏的面可以是渐变，这行取色器只对纯色可用，改渐变直接写在输入里。

## 数据

```ts
type Props = {model: ThemeEditorModel};
```

文字取自 `nbook.workbench` 的 `themeEditor.*`，经注入的翻译端口。
