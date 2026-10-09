---
标签: [state:local]
别名: ["文件树", "File Tree"]
---

# ExplorerTree

资源管理器的虚拟树（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“焦点”与验收 1、3）：几千行的目录只渲染视口内的行与上下各 10 行余量，焦点行滚出视口也保持挂载。键盘焦点留在树的列表元素上，当前行经 `aria-activedescendant` 指出；按键交给宿主的 `handleKey` 决定，宿主说处理了才阻止默认行为。nb-ui 的 `FileTree` 单选、行高 32px、没有虚拟化，所以这里另写。

## 布局

占满父容器的高度，自己是滚动容器（视图 `layout: "fill"`），细滚动条、`scrollbar-gutter: stable`。行高取主题的 `--control-h-sm`（能装下 `FormInput` 的 `sm` 与焦点框）：一个隐藏的探针元素量出它，主题或字号变了随之重算。视口高度用布局盒测量；视图停放时尺寸为零，不改记住的滚动位置。滚动锚点是首个可见行的地址与行内偏移：前方插入或删除行时阅读位置不跳；内容变短时夹到合法范围。

## 交互

- 点行：选择与打开交给宿主（带 Ctrl/Meta、Shift 修饰）；点展开箭头只展开收起；双击以常驻方式打开；右键交出行与坐标。
- 按下行时把焦点放到树上（不滚动），之后的按键都在树上处理；行里的按钮与输入框的按键不交给 `handleKey`。
- 焦点行变了（键盘移动）先滚入视口再更新 `aria-activedescendant`。
- 树获得与失去焦点时发出 `focus-change`，宿主据此维护 `nbook.explorer/treeFocused`。

## 数据

```ts
type Props = {
    rows: ReadonlyArray<Row>;
    /** 选中的行 id。 */
    selected: ReadonlyArray<string>;
    /** 键盘焦点所在的行 id。 */
    focus: string | null;
    locale: DisplayLocale;
    /** 树的可访问名称。 */
    label: string;
    /** 树内按键；返回是否处理了。`page` 是视口能放下的行数。 */
    handleKey: (key: TreeKey, page: number) => boolean;
};

type Emits = {
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    /** 读取失败的目录点了“重试”。 */
    (event: "retry", address: string): void;
    (event: "focus-change", focused: boolean): void;
};
```

- 根元素 `role="tree"`、`aria-multiselectable="true"`、`tabindex="0"`；行的角色与属性见 `ExplorerRow`。
- 没有 slots；expose `focus()`（把焦点放回树，不滚动）。attrs 落在根元素上。

## 不支持

不支持变高行；不处理拖动（随后续切片）；不在树内渲染内联输入（随后续切片）。
