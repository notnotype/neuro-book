---
标签: [state:local, env:global, env:portal, env:timer]
别名: ["文件树", "File Tree"]
---

# ExplorerTree

资源管理器的虚拟树（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md) 的“焦点”与验收 1、3）：几千行的目录只渲染视口内的行与上下各 10 行余量，焦点行滚出视口也保持挂载。键盘焦点留在树的列表元素上，当前行经 `aria-activedescendant` 指出；按键交给宿主的 `handleKey` 决定，宿主处理了才阻止默认行为，宿主要求开菜单时在焦点行下方发出 `row-context`。正在内联输入的行与焦点行一样保持挂载。nb-ui 的 `FileTree` 单选、行高 32px、没有虚拟化，所以这里另写。

## 布局

占满父容器的高度，自己是滚动容器（视图 `layout: "fill"`），细滚动条、`scrollbar-gutter: stable`。行高取主题的 `--control-h-sm`（能装下 `FormInput` 的 `sm` 与焦点框）：一个隐藏的探针元素量出它，主题或字号变了随之重算，并按滚动锚点换算滚动位置，阅读位置停在同一资源上。视口高度用布局盒测量；视图停放时尺寸为零，不改记住的滚动位置。滚动锚点是首个可见行的地址与行内偏移：前方插入或删除行时阅读位置不跳；内容变短时夹到合法范围。

## 交互

- 点行：选择与打开交给宿主（带 Ctrl/Meta、Shift 修饰）；点展开箭头只展开收起；双击以常驻方式打开；右键交出行与坐标。
- 按下行时把焦点放到树上（不滚动），之后的按键都在树上处理；行里的按钮与输入框的按键不交给 `handleKey`。
- 焦点换了一行（键盘移动）先滚入视口再更新 `aria-activedescendant`；开始内联输入时输入行同样滚入视口。按行 id 的变化触发：前方插入或删除行只改变下标，阅读位置由滚动锚点保持，不被拉回焦点行。
- Shift+F10 与 ContextMenu 键经 `handleKey` 返回要开菜单的行，树按那一行的位置发出 `row-context`。
- 树获得与失去焦点时发出 `focus-change`。
- 拖动（手势在 `web/tree-drag.ts`）：在资源行上按下，鼠标与笔移动 6px、触摸按住 200ms 后经 `startDrag` 问宿主能不能拖；能拖时捕获指针，每帧把指针下的行与它在行里的位置（目录行上中下三段、其余行上下两半）经 `drag-hover` 交出，宿主算出动作后经 `drag` 传回，树按它画落点反馈（nb-ui `DropFeedbackOverlay`：移入画整行、调整顺序画插入线，标签说明动作）；松手时把那一刻的落点经 `drag-drop` 交出，由宿主决定提交与否。滚动或行变了而指针没动时撤下落点，原地松手不提交。Escape、指针取消、失去捕获、窗口失焦、页面隐藏发出 `drag-cancel`；`drag` 变为 null（宿主那边取消了）时手势随之收场。拖动结束吞掉末尾的 click。

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
    /** 树内按键：没处理、处理了，或要在某一行开右键菜单。`page` 是视口能放下的行数。 */
    handleKey: (key: TreeKey, page: number) => "none" | "handled" | {menu: string};
    /** 正在内联输入的行（新建的输入行或改名的资源行）与它的名字、错误文字、是否在提交；默认 null。 */
    editing?: {id: string; name: string; error: string | null; busy: boolean} | null;
    /** 拖动过了门槛：返回 false 时不起拖；默认不能拖。 */
    startDrag?: (id: string) => boolean;
    /** 拖动中最后显示的落点动作（`web/actions/drop.ts` 的 `DropAction`）；不在拖动为 null。 */
    drag?: {action: DropAction} | null;
};

type Emits = {
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    /** 读取失败的目录点了“重试”。 */
    (event: "retry", address: string): void;
    (event: "focus-change", focused: boolean): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
    /** 拖动中指针下的行与位置；null 是不在行上或撤下落点。 */
    (event: "drag-hover", over: {id: string; zone: "before" | "inside" | "after"} | null): void;
    (event: "drag-drop", over: {id: string; zone: "before" | "inside" | "after"} | null): void;
    (event: "drag-cancel"): void;
};
```

- 根元素 `role="tree"`、`aria-multiselectable="true"`、`tabindex="0"`；行的角色与属性见 `ExplorerRow`。
- 没有 slots；expose `focus()`（把焦点放回树，不滚动）。attrs 落在根元素上。

## 隐藏通道理由

- `env:portal`：拖动的落点反馈经 nb-ui `DropFeedbackOverlay` 渲染到 `body`，坐标是视口坐标，要脱离侧栏的裁剪与层叠上下文。
- `env:timer`：触摸按住 200ms 才起拖，用一个计时器；抬起、移动超过容差、取消或卸载时清掉。
- `env:global`：拖动期间在窗口上监听指针移动、松手、Escape、失焦与页面隐藏，并用 `document.elementFromPoint` 找指针下的行：指针捕获在树上，移出树与窗口后的移动与松手只有窗口收得到。拖动结束或组件卸载即拆掉。

## 不支持

不支持变高行；不支持键盘拖动（键盘用剪切粘贴与上移下移达成同样的结果）；拖到视口边缘不自动滚动。
