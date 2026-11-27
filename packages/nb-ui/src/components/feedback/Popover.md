---
标签: [state:local, state:inject, env:portal]
---

# Popover

`Popover` 把一个触发器和与之关联的浮层内容组合成可控或非受控的弹出面板。它适合放置轻量补充内容；与只显示说明的 Tooltip 不同，默认内容可以包含可交互控件。触发器和面板由调用方的两个插槽提供；触发器不归调用方渲染时（例如工作台面板头的标题按钮），可以改为锚在调用方给的元素上。

## 布局

触发器留在原位置，面板通过 Portal 渲染在组件树之外，默认从触发器下方、水平居中展开，间距 6px。内容区域有面板材质、圆角和 12px 内边距，最大宽度为视口宽度减 32px；可以选择显示箭头。`contentClass` 可补充面板 class。

## 交互

- 点击触发器切换展开状态；受控模式下状态由父组件更新 `open`，非受控模式由 `defaultOpen` 初始化。打开状态变化时发出 `update:open`。
- `modal` 默认为 `false`；其模态细节和触发器行为由 Reka Popover 原语提供。
- 面板关闭时阻止 Reka 的自动焦点恢复。焦点具体去向及其它关闭来源遵循上游原语，不在本组件保证范围内。
- 定位方向、碰撞避让和对齐由 `side`、`sideOffset`、`avoidCollisions`、`align` 控制；避让缺省以视口为界，给了 `collisionBoundary` 时以那块元素为界（例如编辑区里的浮层不越出编辑区、盖到侧栏上）。

### 锚在外部元素上

给了 `anchor` 时不渲染 `trigger` 插槽，面板贴着这个元素定位。用于触发元素属于别的组件、不能交给原语改写的情况：原语的触发器会给子元素写自己的 `id`、`aria-haspopup`、`aria-expanded` 并叠加点击处理，`anchor` 不碰这个元素的任何属性与事件。

- 开关只由 `open` 决定，打开要调用方自己处理锚点的点击；`aria-haspopup`、`aria-expanded` 也由调用方写。
- 在锚点上按下（包括随之而来的焦点移动）不算点外面，不关闭：调用方的点击处理照常切换，再点一次就是关。
- 按 Escape 关掉后焦点回到锚点；点外面关掉时焦点留在用户点的地方。
- 面板贴着哪块矩形定位可以另给 `reference`（一个 `getBoundingClientRect()`，可以是算出来的虚拟矩形，`contextElement` 写它跟着哪个元素滚动）：锚点很高、贴着整个锚点放不下面板时，调用方改贴锚点里的一小块（例如露在窗口里的第一行）。给了它，定位只看它；焦点还给谁、按在哪里不算点外面，仍看 `anchor`。

## 数据

```ts
interface PopoverProps {
    /** 展开状态；传入时受控，默认 undefined（不指定，由上游非受控状态管理）。 */
    open?: boolean;
    /** 非受控初始展开状态；默认 false。 */
    defaultOpen?: boolean;
    /** 首选展开方向；默认 "bottom"。 */
    side?: "top" | "right" | "bottom" | "left";
    /** 触发器与面板间距，像素；默认 6。 */
    sideOffset?: number;
    /** 沿首选方向的对齐方式；默认 "center"。 */
    align?: "start" | "center" | "end";
    /** 是否避让视口边界并调整位置；默认 true。 */
    avoidCollisions?: boolean;
    /** 是否使用模态交互；默认 false。 */
    modal?: boolean;
    /** 面板附加 class；默认空字符串。 */
    contentClass?: string;
    /** 是否显示定位箭头；默认 false。 */
    arrow?: boolean;
    /** 锚在这个元素上，不用 `trigger` 插槽（见“锚在外部元素上”）；默认不给。传 null 时同样不渲染触发器；锚点还没有时不要打开，面板没有可贴的位置。 */
    anchor?: HTMLElement | null;
    /** 定位用的矩形，代替 `anchor` 的外框（见“锚在外部元素上”）；默认不给，贴着 `anchor`。滚动时会重算，每次都要给出当时的矩形。 */
    reference?: PopoverReference | null;
    /** 避让时以哪块元素为界；缺省 null（视口）。只在 `avoidCollisions` 时起作用。 */
    collisionBoundary?: Element | readonly Element[] | null;
}

interface PopoverReference {
    getBoundingClientRect(): DOMRect;
    /** 它跟着哪个元素滚动、变大小（浮层据此重算位置）。 */
    readonly contextElement?: Element;
}

interface PopoverEmits {
    /** 展开状态变化时发出；受控使用方应据此更新 open。 */
    (event: "update:open", value: boolean): void;
}

interface PopoverSlots {
    /** 触发器内容；作为 Reka PopoverTrigger 的 as-child 子树。给了 `anchor` 时不渲染。 */
    trigger?: () => unknown;
    /** 面板内容。 */
    default?: () => unknown;
}
```

组件不 expose 方法或属性。未声明 attrs 没有稳定的透传合同，不应依赖 Reka 内部节点上的透传位置。

## 状态与边界

`open` 未传时由 Reka 管理当前开合状态，`defaultOpen`（默认 false）只指定非受控初值。禁用、只读、加载、出错和空数据状态没有统一实现，由内容与触发器自行表达。

## 不支持

- 不提供本地业务状态、表单、加载或错误处理。
- 不提供独立的关闭按钮插槽或专用 `close` 事件；关闭方式来自触发器及上游 Popover 交互。

## 上游边界

Reka UI Popover 负责展开状态原语、触发器语义、焦点管理、模态行为、Portal 生命周期和定位/碰撞计算。本组件承诺的扩展只有上述 props、`update:open`、插槽内容、面板样式、可选箭头和窗口内层级；其它键盘行为与具体焦点策略随 Reka UI 版本变化，不作额外承诺。

## 隐藏通道理由

`state:inject`：读取可选的 `NB_POPOVER_Z_INDEX`，使 Dialog 内容树中的面板显示在所属窗口上方；未注入时回退到普通 popover 层级。窗口栈深度由宿主提供，不是每个调用点都应重复传入的数据。

`env:portal`：面板通过 Reka `PopoverPortal` 脱离局部组件树，避免祖先裁剪与 stacking context 遮挡。目标位置由 Reka 管理；目标不可用时的行为遵循 Reka UI。
