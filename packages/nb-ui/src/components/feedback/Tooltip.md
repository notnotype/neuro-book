---
标签: [state:local, state:inject, env:portal, env:timer]
---

# Tooltip

`Tooltip` 为一个触发器提供短暂的说明性提示，适合补充图标按钮或简短控件的含义。它将提示放在独立浮层中；触发器本身由调用方提供，富文本内容可用命名插槽覆盖纯文本。

## 布局

默认插槽作为触发器，提示位于上方、与触发器相距 6px；上游定位器会按可用空间调整位置。提示面板无箭头，最大宽度为 288px，指针事件穿透。内容不能滚动交互。

## 交互

- 鼠标悬停经过 `delay` 毫秒后显示，键盘聚焦时即时显示；禁用后不显示。
- 点击触发器不会主动关闭当前提示；Escape 关闭提示。详细 hover/focus 状态切换由 Reka Tooltip 原语提供。
- 提示不是交互面板，不应把按钮等可操作内容放入 `content` 插槽。

## 数据

```ts
type TooltipPlacement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
    /** 纯文本提示；默认空字符串，可由 content 插槽替换。 */
    text?: string;
    /** 首选显示方向；默认 "top"。 */
    placement?: TooltipPlacement;
    /** 悬停到显示的延迟毫秒数；默认 300。 */
    delay?: number;
    /** 是否禁用提示；默认 false。 */
    disabled?: boolean;
}

interface TooltipEmits {}
interface TooltipSlots {
    /** Reka TooltipTrigger 的 as-child 触发器子树。 */
    default?: () => unknown;
    /** 富内容；未提供时使用 text。 */
    content?: () => unknown;
}
```

组件没有 expose API。attrs 按 Vue 默认行为落在组件根部（TooltipProvider）；不保证透传到实际触发器或浮层。

## 状态与边界

`delay` 后悬停显示，键盘聚焦即时显示；`disabled` 时上游禁用 Tooltip。空文本且无 `content` 时提示没有可见文字，浮层是否呈现空白外框由上游决定。

## 不支持

- 不提供 `open` 受控 prop 或状态变化事件。
- 不提供箭头、可交互内容、触发器合成或自定义浮层 class。

## 上游边界

Reka UI Tooltip 管理 hover/focus 状态、Provider 延迟、Escape 关闭及 Portal 生命周期；Reka Popper 负责定位和碰撞翻转。本组件固定无箭头和 6px 偏移，其余上游未声明行为不作承诺，升级可能变化。

## 隐藏通道理由

`state:local`：TooltipRoot 在组件实例内维护当前提示的展开状态；组件不把该临时状态回传给父级。

`state:inject`：读取可选的 `NB_POPOVER_Z_INDEX`，使 Tooltip 位于 DialogWindow 内容树时显示在所属窗口上方；未注入时回退普通浮层层级。该窗口层级是宿主上下文。

`env:portal`：说明浮层必须不受触发器祖先的裁剪与局部层叠上下文影响，故使用 Reka `TooltipPortal`。Portal 目标由上游管理，本组件没有目标 prop；目标缺失时的表现遵循 Reka UI。

`env:timer`：`delay` 经 TooltipProvider/TooltipRoot 传给 Reka，由上游用延迟控制 hover 显示；键盘聚焦仍即时显示。计时行为属于提示交互本身。
