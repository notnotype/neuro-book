---
标签: [state:local, state:inject]
别名: ["主题编辑器的对比度检查分区", "Theme Editor Contrast"]
验证入口: ThemeEditor
---

# ThemeEditorContrast

主题编辑器的“对比度检查”分区（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 14）：两套明暗里每个文字类颜色各一行，用它真实的颜色画样张，旁边写比值与等级。

## 布局

顶部一句说明和一行总数（有不合格项时红字“N 项不合格”，没有时绿字“没有不合格的项”）。下面是“亮色”“暗色”两组，每组标题旁写这一组的不合格数或“全部合格”。

每行从左到右：样张、变量名与“落在哪个底色上最差”、比值、等级、（不合格时）“去修改”。样张是一块用该文字色在该底色上写“Aa 示例文字”的色块，颜色由行内样式给，不取编辑器自己的 token：文字色与底色都是被编辑的取值。不合格的行排在组内最前并加红色描边，其余保持检查表里的顺序。放不下时从变量名开始换行。

## 交互

- 等级：低于 4.5 是“不合格”，4.5 到 7 是 AA，7 以上是 AAA；读不懂的写法（`color-mix()` 之类）或缺底色没有比值，样张写“–”，只给原因，不算不合格。
- “去修改”：把正在编辑的明暗切到那一行所属的一套、分区切到“配色”，再把光标放进那个变量的色值输入（`[data-color-field]` 里的文本输入）并滚到视野中央；找不到输入时只停在配色分区。

## 数据

```ts
type Props = {model: ThemeEditorModel};   // 读 model.contrastByAppearance，改 model.appearance 与 model.section
```

文字取自 `nbook.workbench` 的 `themeEditor.contrast.*`，经注入的翻译端口。
