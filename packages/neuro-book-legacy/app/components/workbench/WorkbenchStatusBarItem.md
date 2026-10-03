---
标签: []
别名: ["状态栏项", "Status Bar Item"]
---

# WorkbenchStatusBarItem

工作台状态栏里的**一项**：图标 + 文案 + 角标，按语义变体取色。

它是**纯零件**，并且有一个别的状态栏零件没有的特点：**可点与只读是同一个组件的两种形态**——`clickable` 为真时根节点是 `<button>` 并回传 `click` 事件，为假时根节点是 `<span>`，连按键盘都到不了它。宿主因此不需要为「只读统计项」另找一个组件，也不会给只读项留一个点了没反应的按钮。

## 布局

- 根：`clickable` 为真的 `<button type="button">`，或 `clickable` 为假的 `<span>`；两者都带 `data-status-item-id`、`data-status-variant`、`data-status-active`、`title` 与 `aria-label`。
- 内容从左到右：图标（12×12）→ 文案 → 角标。三者都由插槽可替换（见「数据」）。
- 高 100%——它**填满父级**，状态栏给多高就是多高（产品里那条是 ~22px）；内边距 `--space-2`，字号 `--text-2xs`，单行不换行。
- 文案超出时自己省略号截断（`text-overflow: ellipsis`），不换行、不撑宽父级。
- `390×844` 下同样只是被父级挤窄后截断，自身结构不变。

## 交互

- 点击（`clickable: true`）：发 `click(e)`，没有第二个参数、不带 id——宿主自己知道每个项是谁（它写的 `id` 会落到 `data-status-item-id` 上）。
- 只读（`clickable: false`）：不绑定点击处理，**不发任何事件**；根是 `<span>`，不进 Tab 序列，也不画 `focus-visible`。
- 悬停：可点项才有悬停反馈——`default` 变体走 `--bg-hover` + `--text-main`，四个状态变体各自走对应状态色的 16% 透明叠底。
- 激活（`active`）：文字提到 `--text-main` 并给 `--overlay-item-active` 底色，表示「这一项对应的东西正开着/正生效」。
- 焦点：可点时是原生按钮，`focus-visible` 画 `--focus-ring`。

## 数据

```ts
export type WorkbenchStatusBarItemVariant = "default" | "error" | "warning" | "info" | "success";

type Props = {
    /** 项目唯一标识（透传到 data-status-item-id） */
    id?: string;
    /** 显示文案（默认插槽可替换） */
    label?: string;
    /** 图标 class */
    icon?: string;
    /** 角标或计数 */
    badge?: string | number;
    /** 状态色变体，默认 "default" */
    variant?: WorkbenchStatusBarItemVariant;
    /** 是否可点击，默认 true（false 时根节点是 span、不发事件） */
    clickable?: boolean;
    /** 是否处于激活/选中态，默认 false */
    active?: boolean;
    /** 原生 title 悬停说明 */
    title?: string;
    /** 无障碍标签，缺省按 ariaLabel || label || title 求值 */
    ariaLabel?: string;
};

type Emits = {
    /** 只有 clickable 为真时才可能收到 */
    (event: "click", e: MouseEvent): void;
};

type Slots = {
    /** 替换文案 */
    default?(): unknown;
    /** 替换图标 */
    icon?(): unknown;
    /** 替换角标 */
    badge?(): unknown;
};
```

- 默认值：`variant` = `"default"`，`clickable` = `true`，`active` = `false`，其余可省。
- 角标只有非空（`!== undefined`、`!== null`、`!== ''`）才渲染。
- 扩展面：有 `slots`（三个）；**没有 expose**；`attrs` 透传到根节点（`class`、`data-*` 都能加，`WorkbenchStatusBarFixture` 用它加旋转类）。
- 文案为空且没有默认插槽时不渲染文案节点（角标/纯图标项因此不会多一段空白）。

## 状态

- 默认：文字 `--text-secondary`；角标底色 `--bg-subtle`、文字 `--text-main`。
- 变体：`error` / `warning` / `info` / `success` 分别给文字与角标上对应的 `--status-*` 色（角标底色是同色 20% 叠底）。
- 激活：见「交互」。
- 只读：没有悬停、没有焦点、没有事件——与默认态在视觉上只差可变性与光标。
- 加载中 / 出错：**没有内置形态**。要表达「同步中」这类过程态，宿主换文案或图标（产品里的同步按钮就是这么做的）。

## 不支持

- 不画状态栏容器（左右分组、分隔、贴底都归 `WorkbenchStatusBar`）。
- 不处理溢出与换行：它是被父级排布的一项，压缩与截断都发生在自己身上，它不把宽度让给兄弟。
- 不做 i18n（`label` / `title` / `ariaLabel` 都是已解析文本）。
- 不做右键菜单、不做下拉、不读 store、不发请求。

## 注意事项

- 根节点在 `clickable` 变化时会换标签（`button` ↔ `span`）：宿主如果按 `data-*` 或 ref 定位它，请依赖那三个 `data-status-*` 属性而不是标签名。
- 变体色只表达语义，不代表「能不能点」——`error` 变体同样可以是只读统计。
- 极窄高度下不要给这一项加纵向内边距，它按状态栏的高度契约设计（`height: 100%`）。
