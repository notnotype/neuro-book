---
标签: [state:local, state:inject]
别名: ["标签页", "Tab 栏"]
---

# Tabs

页面或区块级的线性标签栏：把互斥的几个去处排成一行，当前所在的那一项用底部指示线标出。它只画标签栏本身，**不渲染内容面板**——换了选中项要显示什么，由消费方按 `modelValue` 自己决定。

`Tabs` 换去处：选中哪一项，下面就换成哪一块内容。只换看法、内容还是同一份时用 `SegmentedControl`；其余见[同类零件的分工](../../../docs/ui-development-spec.md#42-同类零件的分工)。

## 布局

只有一块：一行标签，外加底边线（`baseline` 为 false 时不画，用在本来就不画线的标题行里，例如工作台平铺的工具区标题行）。标签栏**不换行**，不会撑破父容器，也不会出现第二行。放不下时按 `overflow` 处理：`scroll`（默认）在标签栏内部横向滚动；`adapt` 逐级让位、不滚动——完整标题 → 每个标签最宽 `maxItemWidth`（默认 96px）、标题末尾省略 → 选中的保留标题、其余有图标的只显示图标 → 放不下的收进末尾的“更多 N”下拉。选中的始终在、始终带标题；最后一档里标签带窄到连选中的加“更多”都放不下时，选中的标签再收缩、标题出省略号。放宽一档要多出 16px 余量，宽度在临界值附近抖动时不来回切。各档用一层不可见的测量层量出完整标题、只留图标与“更多”的宽度，取舍是纯函数 `tabs-adapt.ts`。`adapt` 要父级给定宽度（例如 flex 里 `flex: 1 1 auto; min-width: 0`）。选中指示线贴在底边线**上方**，不覆盖边线——标签栏是横向滚动容器，指示线不能越出盒子。

`size` 为 `sm` 时高度与字号都收一档，`md`（默认）为常规控件高度。每个标签内从左到右是可选图标、文字、可选计数徽标；计数徽标用等宽字体，`0` 也会照常显示。三项都排在同一行，不因窄屏折行。

`390×844` 下结构不变：标签栏仍是一行，超出部分横向滚动，指示线与徽标随滚动移动。

## 交互

- 标签填满标签栏的高度，栏本身横向滚动、四周没有余地，焦点画成标签里面的一圈内嵌焦点线，不画外扩光晕。
- 点击一个启用项发出 `update:modelValue`。组件不自己改选中态：**这是受控组件**，父组件不处理该事件时点击没有任何视觉变化。
- 禁用项不可点击、不参与键盘移动，视觉上透明度降低。
- 键盘（焦点在标签栏内即可，事件挂在标签栏容器上）：
  - `ArrowRight` / `ArrowLeft` 在**启用项**之间循环移动，并**同时改变选中项**（自动激活，不是只移动焦点）；移动后焦点跟到新选中的标签上。两端绕回另一端。
  - `Home` 跳到第一个启用项，`End` 跳到最后一个启用项。
  - 当前值不落在任何启用项内时（例如它指向一个禁用项，或指向已被移除的值），`ArrowRight` 落到第一个启用项，`ArrowLeft` 落到最后一个（与 `SegmentedControl` 相同）。
  - 全部标签都禁用时，方向键与 `Home` / `End` 不做任何事。
- 焦点模型是 roving tabindex：只有选中项 `tabindex="0"`，其余（含禁用项）都是 `-1`，整条标签栏只有一个 Tab 停靠点。
- `adapt` 时方向键照样在全部启用项之间移动（含收进“更多”的）：选中的那个会换到标签带里，焦点跟过去。“更多”是标签栏之后的一个按钮（不在 `tablist` 里），打开的下拉列出收起来的标签（图标加全名），选中发 `update:modelValue`。截断与只留图标时标签带 `title` 显示全名，只留图标时 `aria-label` 是全名。

无障碍：容器是 `role="tablist"`，`ariaLabel` 非空时同时设 `aria-label`（默认为空，此时标签栏没有可访问名）；每个标签是 `role="tab"` 并带 `aria-selected`。组件不生成 `id`，也不渲染 `role="tabpanel"` 的内容区：消费方给标签项传 `id` 与 `controls`，组件原样写到标签的 `id` 与 `aria-controls`，内容面板的 `role="tabpanel"`、`aria-labelledby` 与显隐由消费方负责。

## 数据

```ts
/** 一个标签项。value 必须唯一。 */
export type TabsItem = {
    /** 标签身份；与 modelValue 相等即为选中项 */
    value: string;
    /** 标签文字；必填，没有纯图标形态 */
    label: string;
    /** 图标类名（如 i-lucide-star）；默认不显示图标 */
    iconClass?: string;
    /** 尾部计数徽标；可选，传 0 也会显示 */
    count?: number | string;
    /** 禁用：不可点、不可聚焦、键盘跳过；默认 false */
    disabled?: boolean;
    /** 标签元素的 id；默认不设。消费方用它给内容面板写 aria-labelledby */
    id?: string;
    /** 这个标签控制的内容面板 id，写到 aria-controls；默认不设 */
    controls?: string;
    /** 写到这个标签元素上的额外属性（data-*、aria-roledescription 等）；与组件自己管的属性（role、id、aria-selected、aria-controls、tabindex、disabled、type、data-tab-value）同名时以组件为准 */
    attrs?: Readonly<Record<string, string>>;
};

export type TabsSize = "sm" | "md";

type TabsProps = {
    /** 当前选中项的 value；必填、**受控**——组件不修改它，只在交互时发出 update:modelValue */
    modelValue: string;
    /** 标签列表；必填 */
    items: TabsItem[];
    /** 标签栏的可访问名；默认空字符串，为空时不设 aria-label */
    ariaLabel?: string;
    /** 尺寸；默认 "md" */
    size?: TabsSize;
    /** 是否画标签栏下方的底边线；默认 true。选中指示线不受影响 */
    baseline?: boolean;
    /** 放不下时："scroll" 横向滚动（默认）；"adapt" 逐级让位（截断、只留图标、收进“更多”） */
    overflow?: "scroll" | "adapt";
    /** adapt 的截断宽度（px）；默认 96 */
    maxItemWidth?: number;
    /** adapt 的“更多”按钮文字，后面跟收起来的个数；缺省按界面语言取（中文 "更多"） */
    moreLabel?: string;
};

type TabsEmits = {
    /** 点击启用项，或方向键 / Home / End 移动选中项时发出；参数是新的 value */
    (event: "update:modelValue", value: string): void;
};
```

扩展面：组件不提供任何 slot；不 expose 任何方法或属性；未声明的 attribute、`class`、`style` 落到组件根上，不是落到单个标签上：`scroll` 时根就是标签栏（`tablist`），`adapt` 时根是包住标签栏、“更多”与测量层的一层，带 `data-tabs-level`（0 完整、1 截断、2 只留图标、3 收进“更多”），“更多”按钮带 `data-tabs-more`。要给单个标签加属性（例如拖动源的 `data-*` 标记）用标签项的 `attrs`。

## 状态

- 选中：完全由 `modelValue` 决定，组件不做默认选中，也不缓存上一次的值。
- 禁用：该项不可点、不可聚焦、键盘跳过。
- 空列表：渲染一条空的底边线（`baseline` 为 false 时什么也不画），没有任何可聚焦项。
- 组件自持的内部状态：标签栏容器的元素引用（键盘改变选中项后把焦点跟过去）；`adapt` 时还有当前一档与收起来的标签，以及观察宽度变化的 `ResizeObserver`。都不伸出组件之外，随组件销毁释放。

## 不支持

- 不支持内容面板：不渲染 `tabpanel`；关联用的 `id` 与 `aria-controls` 由消费方经标签项传入，组件不生成。
- 不支持换行：标签过多时横向滚动或逐级让位，不做多行排列。
- 不支持往“更多”里拖放：收起来的标签不在标签栏里，拖放的插入位只在看得见的标签之间与末尾。
- 不支持关闭按钮、拖拽重排、溢出菜单（没有 `closable` / `draggable` / 「更多」入口）。拖动由消费方经 `attrs` 写标记自己接，组件不认识拖动。
- 不支持纯图标标签（`label` 必填）与垂直朝向（没有 `orientation`）。

## 注意事项

- **受控**：不在父组件里处理 `update:modelValue` 时，点击与方向键都不会改变选中态。
- **不要把一个禁用项的 `value` 传给 `modelValue`**：那会让所有标签的 `tabindex` 都变成 `-1`，整条标签栏无法用 Tab 键进入。
- **`items` 里的 `value` 必须唯一**：重复值会让多个标签同时呈选中态，键盘移动也会定位到第一个匹配项。
- `count` 的可见性由 `count !== undefined` 判定，传 `0` 会显示「0」；不想要徽标就不要传这个字段。

## 隐藏通道理由

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取“更多”按钮的缺省文字，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `moreLabel` 时以属性为准，不读端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。
