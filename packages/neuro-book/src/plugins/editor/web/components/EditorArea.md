---
标签: [state:local]
别名: ["编辑器区", "Editor Area"]
---

# EditorArea

编辑器槽里的根（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md)）：按编辑器区控制器（`area.ts` 的 `EditorArea`）的组模型，用 nb-ui 的 grid 排列编辑组，每组一个 `EditorGroup`；承载关闭询问与编辑器区内的键位。它是宿主：直接读控制器的状态、调它的动作，不经属性展开；命令由插件的宿主执行，组件只发意图。

## 数据

```ts
type Props = {
    /** 编辑器区控制器：组与标签、文档、绑定、进度、关闭询问。 */
    area: EditorArea;
    locale: DisplayLocale;
    /** 每种编辑器的控件组件（按 `control.ts` 的合同）。 */
    control: (kind: "markdown" | "code") => Component;
};

type Emits = {
    /** 编辑器区有焦点时按下 Ctrl+S、Ctrl+W、Ctrl+\：宿主执行保存、关闭、向右拆分的命令。 */
    intent: ["save" | "close" | "split-right"];
};
```

无 slots、无 expose；attrs 落在根元素。

## 布局与交互

填满父级、自己不滚动。grid 用 `useLayoutExtent` 测量承载盒、`useGridLayout` 落账，拖动分隔条落账后告诉控制器记下会话；组模型原地拆分或关闭组时重算布局。根元素记焦点进出（控制器的 `focused`，即公开键 `nbook.editor/focused`）。控制器的提示（换文档时有未裁决输入）显示在顶部，可关闭。

关闭询问是 nb-ui `Dialog`：标题带文件名，按钮依次是取消、不保存、保存（默认焦点在 Dialog 的规则上）；关闭对话框等于取消。

## 不支持

- 不拖动标签换组、不拖到边缘拆分（另行交付）。
- 不渲染面包屑、编辑器工具栏。
