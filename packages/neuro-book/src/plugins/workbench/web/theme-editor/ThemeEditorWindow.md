---
标签: [state:local, state:inject]
别名: ["主题编辑器浮动窗口", "Theme Editor Window"]
验证入口: ThemeEditor
---

# ThemeEditorWindow

主题编辑器的浮动窗口（[`theme/editor.md`](../../../../../../../docs/specs/theme/editor.md) 输出 1）：nb-ui 的 `FloatingWindow`，可拖动、可缩放，窗口开着才挂载主体。窗口不盖住整个工作台，可以拖到一边，让真实的活动栏、侧栏和菜单在旁边实时变化。布局包的应用内浮动（w00026 t09）做完后，浮动改走布局包，这个组件被取代，主体不用改。

## 布局

默认 920×640，最小 360×360，带标题区与关闭按钮，没有页脚；主体内容区去掉内边距，主体自己铺实心面。

## 交互

- 开关由会话里的 `floating` 决定：命令 `nbook.settings.open-theme-editor-floating` 打开；标题区的关闭、`Escape`、主体里的“关闭”都关。
- 关闭窗口时主体卸载，模型随最后一个持有者释放，预览清掉。

## 数据

```ts
type Props = {
    session: ThemeEditorSession;
    themes: () => ReadonlyArray<ThemeEntry>;
};
```
