---
验证入口: EditorGroup
标签: [state:local]
---

# MarkdownBlockTypeMenu

块类型下拉（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 1、6）：工具栏与选区菜单共用。触发按钮 76px 宽，写着当前块的类型（正文、标题 1–3）加一个小箭头；点开是这四项，勾着当前的一种，不能换时（只读、表格单元格、代码块里）项不可选。

## 交互

- 选了一项执行对应的命令；焦点回正文，不回触发按钮（nb-ui 规范“从正在编辑的内容旁打开的菜单”）。关上之后发 `refocus`，宿主需要时再把焦点放回正文。
- Esc、点外面关上时按原语的规则。
- 只读时触发按钮不可用。

## 数据

```ts
type MarkdownBlockTypeMenuProps = {
    editing: EditorEditing;
    menus: EditorMenus;
    readonly: boolean;
    /** 放在选区菜单里；默认 false。为真时下拉开着、焦点在下拉里，选区菜单仍算“焦点在菜单里”而留着。 */
    inSelectionMenu?: boolean;
};

type MarkdownBlockTypeMenuEmits = {
    /** 选了一项、下拉关上之后。 */
    (event: "refocus"): void;
};
```

没有插槽与 expose。

`state:local`：这次关上是不是因为选了一项。
