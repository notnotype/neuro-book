---
标签: [state:local, env:portal, env:global, env:timer]
---

# Dropdown

`Dropdown` 是锚定到调用方触发器的菜单包装器。调用方提供普通项、递归子菜单或受控 radio/checkbox 项，组件负责浮层定位、键盘漫游、选择值上报和长列表滚动；菜单命令本身仍由宿主解释。

## 布局与交互

默认插槽内容作为唯一触发器。菜单默认在触发器下方对齐起点并留 7px 间距，靠近视口边缘时由底层定位逻辑避让；可用 `side` 与 `align` 改变方向和对齐。`compact` 档用紧凑条目尺寸；`menuClass` 与 `rootClass` 分别追加菜单浮层与触发器根样式类，未设置时两者没有额外类；`menuMaxHeight` 直接限制列表可视高度。该 common wrapper 将 `menuClass` 缺省为 `""`，因此 nb-ui Dropdown 的默认 `min-w-[200px]` / `min-w-[160px]` 类不生效；实际最小宽度按菜单内容与调用方 class 计算，未保证固定最小宽度。

触发器禁用时不能打开菜单。选择普通项发出 `select(value)`；带 `children` 的父项展开子菜单而不选择自身。radio / checkbox 的 `checked`、radio 的 `group` 由调用方在选择后更新，不由组件代切换。Reka 菜单原语负责键盘导航、关闭与焦点归还。列表溢出时在菜单内部滚动，并显示可拖动的悬浮滚动条。详细样式与键盘细节以 nb-ui Dropdown 行为为准。

## 数据

```ts
import type {DropdownItem as NbDropdownItem} from "@notnotype/nb-ui/components";
type DropdownItem = NbDropdownItem;

interface DropdownProps {
    /** 菜单数据，必填。 */
    items: DropdownItem[];
    /** 菜单 class；默认空字符串。 */
    menuClass?: string;
    /** 菜单列表最大高度；默认 undefined。common wrapper 显式传 undefined，使 nb-ui 高度 composable 使用其内置的 6 项 / 5 项截断估算。 */
    menuMaxHeight?: string;
    /** 根触发器 class；默认空字符串。 */
    rootClass?: string;
    /** 紧凑菜单密度；默认 false。 */
    compact?: boolean;
    /** 水平对齐；默认 "start"。 */
    align?: "start" | "center" | "end";
    /** 浮层方向；默认 "bottom"。 */
    side?: "top" | "right" | "bottom" | "left";
    /** 浮层与触发器间距（px）；默认 7。 */
    sideOffset?: number;
    /** 禁用触发器；默认 false。 */
    disabled?: boolean;
}

interface DropdownEmits {
    /** 选中可操作的普通项时发出菜单项 value。 */
    (event: "select", value: string): void;
    /** 声明的焦点通知；当前代理底层没有发出 focus 事件（当前实现与声明不一致）。 */
    (event: "focus", event: FocusEvent): void;
}
```

`DropdownItem` 完整上游类型含 `label` 与 `value`（必填），以及 `active`、`disabled`、`iconClass`、`rightIconClass`、`shortcut`、`title`、`tone`、`separator`、递归 `children`、`type: "item" | "radio" | "checkbox"`、受控 `checked` 与 radio `group` 等可选字段。`radio` 项缺少 group 时底层按单项独立成组并发开发诊断。

插槽只有 `default` 触发器。common 包装器没有声明 `open` 或 `update:open`，不能把它当作受控开合 API。没有 expose；包装器没有显式绑定 attrs，底层根为多个 portal 兄弟节点，attrs 不保证落到特定 DOM 节点。

## 状态与边界

- 未打开：只呈现触发器；打开与否由底层菜单原语根据触发器操作管理。
- `disabled=true`：触发器禁用，不能打开菜单。
- 条目禁用：不选择；子菜单项只负责展开。
- `checked`、`active` 是菜单项数据中的展示状态，radio / checkbox 选择结果由调用方回传。
- 空列表没有可执行项；本组件没有独立加载、错误或空态视图。
- 不支持命令派发、业务持久化或组件层受控开合。

## 上游边界

菜单原语、层叠子菜单、键盘行为、碰撞定位和 Teleport 来自 nb-ui `Dropdown` / Reka UI；列表最大高度、磨砂表面、滚动条几何与状态来自 nb-ui composable。本包装器只承诺它显式传入的 props 和 `select` 转发；上游其余行为不作为此 wrapper 的独立保证。

## 隐藏通道理由

- `env:portal`：打开时菜单被 Reka `DropdownMenuPortal` 传送到组件树之外，避免祖先裁剪并与视口定位配合。
- `env:global`：悬浮滚动条拖动时监听 window mousemove / mouseup，松开或卸载后移除；监听仅在拖动期间存在。
- `env:timer`：底层级联调度器对首次 hover 延迟打开子菜单（一次性计时器，不是轮询）；当前源码未展示组件卸载时的显式取消路径。
- `state:local`：保存子菜单级联与滚动条几何、滚动和拖动状态；菜单项与选择结果由宿主提供。

## 已知偏差

wrapper 声明 `focus` emits，但其模板绑定的 `@focus` 不会因底层 nb-ui Dropdown 当前未发出 `focus` 而触发。