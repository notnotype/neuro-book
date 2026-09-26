---
标签: [state:local, env:portal, env:global]
别名: ["引用菜单", "触发候选浮层"]
---

# ReferenceSelectorPopover

输入框或编辑器光标处的候选浮层：上面一行是触发前缀与标题，下面按分组列出候选项（图标、名称、可选提示与说明），把"鼠标选了什么、悬停在哪一项"交回调用方。它自己不管理开合、不读数据、不执行菜单动作——开合、当前高亮项与命令执行都在调用方手里。

它是为**光标处触发菜单**设计的：既能贴着编辑器算出来的光标矩形定位（`anchorRect`，采用视口坐标），也能挂在普通元素下方（`anchorElement`）；普通的 select 下拉只有后一种需求，所以两者不通用。

## 数据

```ts
type FloatingAnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

interface ReferenceSelectorPopoverProps {
    /** 头部显示的前缀（触发符），如 "@"、"/"；必填 */
    prefix: string;
    /** 头部显示的标题；必填 */
    title: string;
    /** 分组列表；必填；每项含 id、可选 title 与 items（items 的 id 在整份列表内唯一） */
    sections: AgentTriggerMenuSection[];
    /** 当前高亮项在**扁平化后**的下标；必填、受控——组件只高亮，不自己改它 */
    activeIndex: number;
    /** 元素锚点；给定时以它所在容器为参照做绝对定位；默认 null */
    anchorElement?: HTMLElement | null;
    /** 光标矩形；给定时面板用视口坐标定位，并接管方向判断；默认 null */
    anchorRect?: FloatingAnchorRect | null;
    /** 渲染目标：字符串选择器或元素；false 表示不脱离组件树；默认 null（落到 body） */
    teleportTarget?: HTMLElement | string | boolean | null;
    /** 展开方向；默认 "auto"（按可用空间选上下），可强制 "up" / "down" */
    direction?: FloatingPanelDirection;
    /** 密度；默认 "normal"；"compact" 用更小的圆角、内边距与字号，并降低宽度上限 */
    density?: "normal" | "compact";
    /** 面板宽度是否对齐锚点元素宽度；默认 false；为 true 时也以锚点元素为定位参照 */
    matchAnchorWidth?: boolean;
}

interface ReferenceSelectorPopoverEmits {
    /** 鼠标按下某一项时发出（禁用项不发），携带该项 id；默认阻止了默认行为，不抢走调用方的焦点 */
    (event: "select", itemId: string): void;
    /** 鼠标进入某一项时发出（禁用项不发），携带该项的扁平下标 */
    (event: "hover", index: number): void;
}
```

没有 slot，没有 `expose`。根节点是 Teleport 而不是普通元素，未声明的 attribute 不会落到面板上；组件不承诺 `attrs` 透传面，需要的东西都从 props 传。

## 布局

面板是竖向两段：头部（前缀 + 标题，背景比面板略深，常驻不滚动）与列表（可滚动，占剩余高度）。列表里每组可带分组标题，组内每项一行：左侧图标、中间名称（长了截断）与可选提示胶囊、下方说明。

面板高度由自身内容与可用空间共同决定：内容不超过上限时按内容高度，超过后内部滚动；上限在有视口信息时按上下可用空间收敛（普通密度上限 288px，紧凑 280px，最低 96px），空出 12px 视口边距与 8px 触发间隔。宽度取"锚点宽度（对齐时）或密度默认宽度（普通 360 / 紧凑 264，不小于 260）"中的较大者，再不小于光标矩形宽度，并把左边缘夹在视口内。方向按下方空间是否放得下判定，放不下且上方更宽裕时向上展开。

`390×844` 下宽度收敛到视口内并保留两侧边距，长列表在面板内部滚动，不产生页面级横向滚动。

## 交互

- 鼠标按住某一项 → `select`；按下动作被阻止了默认行为，所以输入框不会因此失去焦点（这是它能贴着编辑器用的前提）。
- 鼠标进入某一项 → `hover`，把下标交给调用方，由调用方通过 `activeIndex` 回传高亮；禁用项既不 `hover` 也不 `select`，视觉上变淡且不响应指针。
- 组件**自己不听键盘**：方向键换项、回车/Tab 选中、Escape 关闭都由调用方（编辑器的触发插件）处理，组件只负责显示和回报指针事件。也不接管焦点，没有出现/消失时的焦点迁移逻辑。

## 不支持

- 不接受键盘事件，不提供搜索输入框；过滤由调用方的数据决定。
- 不管理开合状态，没有 `open` / `update:open`：调用方决定何时挂载它。
- 不执行菜单命令，也不感知命令怎么做——它只回报 id 与下标。
- 不做虚拟滚动，长列表全量渲染。
- 不把当前高亮项滚进可视区。

## 注意事项

- `anchorRect` 与 `anchorElement` 都为空时按"整行锚点"渲染：面板宽度撑满最近的定位祖先，方向取决 `direction`。用之前请保证祖先链上有定位上下文。
- 定位与最大高度的计算走仓库内共享的浮层布局规则，`direction: "auto"` 时的取舍随那套规则变化，不要在调用方硬编码方向。
- 传 `teleportTarget` 为 `false` 会关掉 Teleport，此时面板留在组件树内，需要调用方自己处理层级与被裁剪的问题。

## 隐藏通道理由

- **`env:portal`**：面板必须脱离宿主的局部层叠上下文才能稳定贴在光标处、压住编辑器与侧栏。渲染目标是 `teleportTarget` 传进来的元素或选择器；默认落到 `document.body`。目标不存在时保持 Teleport 的既有行为（不渲染面板并给出开发期警告），组件不创建隐式目标。`anchorRect` 为空或 `teleportTarget` 为 `false` 时不 Teleport，就地绝对定位。
- **`env:global`**：面板的位置依赖锚点在视口中的位置，需要在窗口尺寸变化、以及任意祖先容器滚动时重算；另外点击面板之外要能通知调用方（由调用方挂在面板容器上）。这些监听与面板同生命周期，组件卸载时解除。调用方拿不到这些事件，浮层的定位属于组件自身职责。
- **`state:local`**：视角版本号，仅用于在自己尺寸或视口变化后重新计算一次布局。
