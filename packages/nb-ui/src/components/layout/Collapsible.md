---
标签: [state:local]
---

# Collapsible

为调用方提供触发器与折叠内容区域的最小状态容器。它不预设标题、图标或触发器外观；相比固定样式的 `CollapsibleSection`，本组件把触发器和内容布局都留给插槽。

## 布局与交互

根容器占满父级宽度。`trigger` 插槽作为 Reka Collapsible 的触发器，默认插槽作为内容；内容使用高度与透明度过渡，并在边界处裁切。窄屏保持同一上下结构，具体宽度和触发器排版由插槽内容决定。

激活 trigger 会打开或关闭内容并发出 `update:open`。为了让上游把触发语义与键盘操作关联到实际元素，`trigger` 应提供单个可交互元素（通常为带可访问名称的 button）。`disabled` 禁止切换；焦点与键盘细节由 Reka UI 管理。

## 数据

```ts
type CollapsibleProps = {
    /** 当前开合状态；传入时为受控值，默认 undefined */
    open?: boolean;
    /** 非受控初始状态；默认 false */
    defaultOpen?: boolean;
    /** 禁止切换；默认 false */
    disabled?: boolean;
};

type CollapsibleEmits = {
    /** 用户切换开合状态时发出；受控用法由父组件回写 */
    (event: "update:open", value: boolean): void;
};

type CollapsibleSlots = {
    /** 必需的交互触发器；以 as-child 方式承载单个元素 */
    trigger(): unknown;
    /** 折叠后显示的内容 */
    default(): unknown;
};
```

没有 expose。未声明的 attributes、`class` 与 `style` 交给唯一根 Reka `CollapsibleRoot`；实际 DOM 落点由 Reka 决定。

## 状态与边界

- `open` 为受控状态；未提供时使用 `defaultOpen` 作为非受控初值。
- 闭合时内容的挂载与可见性由 Reka UI 管理；本组件没有独立加载、错误或空状态。
- 不提供预设标题行、展开图标或持久化开合状态。

## 上游边界

Reka UI 负责受控/非受控开合、触发器无障碍语义、键盘交互与内容生命周期。本组件承诺 trigger/default 两个插槽、全宽根容器和高度/透明度过渡；上游其余行为可能随 Reka UI 升级变化。