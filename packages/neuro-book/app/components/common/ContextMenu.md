---
标签: [state:local, env:portal, env:global, env:timer]
---

# ContextMenu

`ContextMenu` 是由宿主持有坐标和可见状态的右键菜单。它把旧 common `ContextMenuItem`（包括 `danger` 兼容字段）映射到 nb-ui 菜单，负责视口内定位、递归子菜单、外部点击/Escape 关闭通知；菜单项动作仍由调用方提供的回调执行。

## 布局与交互

菜单按 `x`、`y` 坐标定位，宽度至少 170px；超出视口右侧或底部时向内收，左上方至少留 8px。菜单超出右侧时子菜单翻到父项左侧。`children` 可递归构造多级子菜单，带子菜单的项本身不执行 `action`；禁用项不执行动作，分隔项忽略其它呈现字段。`shortcut` 仅显示文本，不绑定按键。`tone: "danger"` 显示破坏性动作样式；兼容属性 `danger: true` 在未给 `tone` 时映射为 danger。

组件挂载后监听 document 的 click、contextmenu 与 keydown：在菜单外点击、菜单外右键或 Escape 时发出 `close`，不会自行修改 `visible`。禁用态仅由每项的 `disabled` 表示；坐标、可见状态及动作均归宿主。菜单项是原生 button，能通过 Tab 聚焦；当前 `MenuNodes` 仅明确处理 `ArrowRight` 展开子菜单，其它按键漫游与出现时的焦点移动未由该组件实现。

## 数据

```ts
interface ContextMenuItem {
    /** 普通菜单项文字；separator=true 时可省略。 */
    label?: string;
    /** 图标 CSS 类名。 */
    iconClass?: string;
    /** 仅展示的快捷键文字，不负责监听键盘。 */
    shortcut?: string;
    /** 可执行项的动作回调；禁用项或有子项的父项不会执行。 */
    action?: () => void;
    /** 任意层级子菜单。 */
    children?: ContextMenuItem[];
    /** 禁用当前项。 */
    disabled?: boolean;
    /** danger 样式；仅在 tone 未提供时作为兼容回退。 */
    danger?: boolean;
    /** 显式样式，优先于 danger。 */
    tone?: "default" | "danger";
    /** 分隔线；为 true 时忽略其余显示字段。 */
    separator?: boolean;
}

interface ContextMenuProps {
    /** 菜单显隐，必填；宿主受控。 */
    visible: boolean;
    /** 菜单左侧视口坐标（px），必填。 */
    x: number;
    /** 菜单顶部视口坐标（px），必填。 */
    y: number;
    /** 菜单项数组，必填。 */
    items: ContextMenuItem[];
}

interface ContextMenuEmits {
    /** 选中动作项、点击/右键菜单外部或按 Escape 时发出；不携带载荷。 */
    (event: "close"): void;
}
```

没有 slots 或 expose。组件渲染为 Teleport 根节点，不提供稳定的 attrs 透传目标；调用方不应依赖 attrs 落到浮层内部哪个节点。

## 状态与边界

- `visible=false` 时菜单不显示，但组件挂载期间的 document 监听仍存在；卸载时解除。
- 空 `items` 没有可执行菜单项。
- 菜单项没有组件级 loading 或错误状态；动作执行、失败反馈和后续业务状态由宿主处理。
- 不支持由组件保存坐标或显隐状态，也不替调用方绑定 `shortcut`。

## 上游边界

递归菜单节点、键盘漫游、子菜单 hover 延迟和浮层样式来自 nb-ui `ContextMenu`、`ContextMenuPanel` 与 `MenuNodes`。本组件额外承诺旧类型到 nb-ui 类型的映射、`danger` 回退规则，以及按宿主主题节点选择 Teleport 目标；其余菜单原语行为以 nb-ui 实现为准。

## 隐藏通道理由

- `env:portal`：nb-ui 菜单面板必须脱离调用方的裁剪区域，组件优先传送到 `.novel-ide-theme`，该目标不存在时使用 `body`。
- `env:global`：底层 ContextMenu 在挂载时登记 document 的 click、contextmenu、keydown 监听，卸载时全部移除，用于外部关闭。
- `env:timer`：底层级联调度器对首次 hover 延迟打开子菜单（一次性计时器，不是轮询）；当前源码未展示组件卸载时的显式取消路径。
- `state:local`：底层菜单保存 mount 标志、经视口收敛后的坐标与级联展开状态；菜单项、可见状态和原始坐标仍由 props 提供。
