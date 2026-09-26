---
标签: [state:local, env:portal, env:global, env:timer]
---

# ContextMenu

`ContextMenu` 是由宿主按需定位的右键菜单浮层，支持任意层级子菜单；它不负责监听触发区域或维护菜单项数据，宿主传入视口坐标和菜单项，并通过 `close` 接收关闭通知。

## 布局与交互

菜单固定定位于传入的视口坐标，超出视口右侧或底部时向内钳制并保留 8px 边距。子菜单相对父菜单项展开，空间不足时调整方向；主菜单与子菜单按层级递增显示。目标元素必须是 `teleportTarget` 指定的现存 CSS 选择器，默认是 `body`。

点击菜单项、菜单外点击或外部右键，以及按 Escape 会请求关闭并发出 `close`。选择无子项且未禁用的条目时，先调用该条目的 `action`（若有），再发出 `close`。有子项的条目只展开子菜单，不执行自身 `action`。首次悬停展开子菜单会等待 300ms；点击、键盘 ArrowRight 与已有展开同级之间的切换立即响应。键盘仅明确支持 ArrowRight 展开子菜单和 Escape 关闭；不提供完整方向键导航或类型搜索。

组件挂载期间在 `document` 上注册外部 click、contextmenu 与 keydown 监听，隐藏时仍保留这些监听，到卸载时解除。菜单项的 `shortcut` 只是显示文本，不会注册快捷键。

## 数据

```ts
interface ContextMenuItem {
    /** 显示文字；separator 为 true 时可省略 */
    label?: string;
    /** 图标 CSS class；可选 */
    iconClass?: string;
    /** 快捷键展示文字；可选，仅显示 */
    shortcut?: string;
    /** 叶子项选择时执行；可选，有 children 的项目不会调用 */
    action?: () => void;
    /** 子菜单项；可选 */
    children?: ContextMenuItem[];
    /** 是否禁用；可选，默认未禁用 */
    disabled?: boolean;
    /** 危险操作样式；可选，默认 "default" */
    tone?: "default" | "danger";
    /** 是否渲染分隔线；可选，true 时忽略其余字段 */
    separator?: boolean;
}

interface ContextMenuProps {
    /** 是否显示；必填、由父组件控制 */
    visible: boolean;
    /** 视口坐标系中的水平位置（px）；必填 */
    x: number;
    /** 视口坐标系中的垂直位置（px）；必填 */
    y: number;
    /** 根级菜单项；必填 */
    items: ContextMenuItem[];
    /** Vue Teleport 目标选择器；可选，默认 "body" */
    teleportTarget?: string;
}

interface ContextMenuEmits {
    /** 选择叶子项、菜单外点击/右键或 Escape 时发出；不会自行修改 visible */
    (event: "close"): void;
}

interface ContextMenuSlots {} // 不提供插槽
```

`visible`、`x`、`y` 都由父组件控制；关闭事件不会自动将 `visible` 改为 false。组件不提供 `expose` API；根节点是 Teleport，attrs 不属于稳定公共合同。`x`、`y` 是视口坐标而不是页面滚动坐标，通常应从 `contextmenu` 事件的 client 坐标取得。初始 `visible=true` 时位置直接取输入值；首次挂载不会主动测量钳位。打开后只在 `visible`、`x` 或 `y` 变化时重新测量，视口尺寸单独变化不会触发重算。

## 不支持

不创建右键触发器，不管理菜单项状态，不负责快捷键绑定，也不提供完整菜单键盘导航。`teleportTarget` 仅接受字符串，目标必须在挂载时存在；没有目标回退逻辑。

## 隐藏通道理由

- `env:portal`：菜单需要脱离触发区域的裁剪与局部层叠上下文，并按视口坐标固定定位；目标通过 `teleportTarget` 传入，默认 `body`。
- `env:global`：菜单外点击/右键和 Escape 可能发生在菜单 DOM 之外，因此集中监听 `document`；组件卸载时解除监听。
- `env:timer`：子菜单首次悬停延迟 300ms 是菜单级联交互的一部分；后续展开时序由父组件逐个实现会导致同一菜单体验不一致。
