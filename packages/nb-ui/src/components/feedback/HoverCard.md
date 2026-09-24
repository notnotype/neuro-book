---
标签: [state:local, state:inject, env:portal, env:timer]
---

# HoverCard

`HoverCard` 是附着于触发内容的非模态悬浮说明面板，适合补充预览或上下文信息；它与点击打开的 `Popover` 不同，开合延迟和触发手势由 Reka Hover Card 管理。

## 布局与交互

`trigger` 插槽作为触发元素，默认插槽作为面板内容。面板默认显示在触发器下方并居中，可配置四向位置、对齐、偏移及碰撞规避；最大宽度为 360px。`arrow=true` 时显示指向触发器的箭头。内容经 Portal 呈现，不遮罩页面；未被 `DialogWindow` 承载时使用普通页面 popover 层级，在窗口中则继承窗口浮层层级。

打开与关闭延迟分别默认为 250ms 和 200ms。受控模式下，开合变化通过 `update:open` 发给父组件；非受控模式由 Reka 内部管理。触发器缺失时没有用户可操作的开合入口。

## 数据

```ts
interface HoverCardProps {
    /** 是否打开；可选，传入后为受控值；默认 undefined（非受控） */
    open?: boolean;
    /** 非受控模式的初始打开值；可选，默认 false */
    defaultOpen?: boolean;
    /** 打开延迟（ms）；可选，默认 250 */
    openDelay?: number;
    /** 关闭延迟（ms）；可选，默认 200 */
    closeDelay?: number;
    /** 面板方向；可选，默认 "bottom" */
    side?: "top" | "right" | "bottom" | "left";
    /** 与触发器的间距（px）；可选，默认 6 */
    sideOffset?: number;
    /** 面板对齐；可选，默认 "center" */
    align?: "start" | "center" | "end";
    /** 是否避让视口边界；可选，默认 true */
    avoidCollisions?: boolean;
    /** 内容面板附加 class；可选，默认空字符串 */
    contentClass?: string;
    /** 是否显示箭头；可选，默认 false */
    arrow?: boolean;
}

interface HoverCardEmits {
    /** Reka open 状态变化时发出 */
    (event: "update:open", value: boolean): void;
}

interface HoverCardSlots {
    /** 触发内容；应提供可承载 as-child 的元素 */
    trigger?: () => any;
    /** 面板内容 */
    default?: () => any;
}
```

`open` 未提供时由 Reka 内部持有状态，`defaultOpen` 只决定初始值；`open` 提供后由父组件持有。组件没有 `expose` API。attrs 不属于稳定公共合同：唯一根为 Reka `HoverCardRoot`，最终 DOM 落点由上游决定，不应依赖其透传位置。`contentClass` 是显式面板样式入口。

## 状态与边界

无禁用、错误或加载状态。组件从 `NB_POPOVER_Z_INDEX` 注入窗口内浮层层级；没有提供方时回退到 nb-ui 普通 popover 层级，因此可脱离 `DialogWindow` 单独使用。

## 上游边界

Reka UI 负责触发时机、开合延迟、受控/非受控状态、Portal、碰撞定位与浮层可访问交互。本组件承诺项目面板样式、参数映射、箭头开关和窗口层级继承；其余行为及 Reka 升级后的变化不属于本组件合同。

## 隐藏通道理由

- `state:inject`：从 `DialogWindow` 的浮层上下文读取 z-index，使窗口内 hover card 处于所属窗口上方；注入缺失时有明确的普通页面层级回退。
- `env:portal`：浮层需脱离宿主裁剪并按触发器定位；组件使用 Reka `HoverCardPortal`，没有目标选择 prop。目标位置及目标缺失时的表现由 Reka 决定，当前组件及测试未核实其细节。
- `env:timer`：延迟开合属于 HoverCard 的交互语义，由上游按 `openDelay`、`closeDelay` 执行，不应由每个使用方重复计时。
