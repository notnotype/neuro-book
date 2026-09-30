---
标签: []
---

# Notification

`Notification` 是一条内联状态通知，使用 `info`、`success`、`warning` 或 `error` 色调呈现图标与内容；它只展示信息并上报用户动作，不负责入队、自动消失或自身关闭。

## 布局与状态

通知从左到右显示色调图标、可伸缩的标题/正文、可选动作按钮和可选关闭按钮。标题仅在标题文字非空或提供 `title` 插槽时出现；正文容器始终存在，默认文字来自 `message`。动作按钮在 `actionLabel` 非空或提供 `action` 插槽时出现。`dismissible=true` 才显示关闭按钮。

根节点为 `role="status"`。色调同时决定图标与状态颜色；通知没有禁用、加载或错误覆盖态，`error` 是通知色调而非组件错误状态。窄空间下正文列可收缩，按钮保持自身宽度。

## 数据

```ts
type NotificationTone = "info" | "success" | "warning" | "error";

interface NotificationProps {
    /** 通知色调；可选，默认 "info" */
    tone?: NotificationTone;
    /** 标题；可选，默认空字符串 */
    title?: string;
    /** 正文；可选，默认空字符串 */
    message?: string;
    /** 是否显示关闭按钮；可选，默认 false */
    dismissible?: boolean;
    /** 动作按钮文字；可选，默认空字符串 */
    actionLabel?: string;
    /** 关闭按钮的可访问名称及 title；可选，默认 "关闭通知" */
    closeLabel?: string;
}

interface NotificationEmits {
    /** 点击动作按钮时发出；不会自动执行动作 */
    (event: "action"): void;
    /** 点击关闭按钮时发出；不会自行隐藏 */
    (event: "dismiss"): void;
}

interface NotificationSlots {
    /** 替换标题文字；有内容时显示标题区 */
    title?: () => any;
    /** 替换正文 */
    default?: () => any;
    /** 替换动作按钮内容；有内容时显示动作按钮 */
    action?: () => any;
}
```

所有 props 均为显示配置而非受控通知状态。未提供插槽时分别回退到 `title`、`message`、`actionLabel`；插槽优先于对应文字。`dismiss` 与 `action` 只发事件，父组件负责移除通知或执行动作。组件没有 `expose` API；未声明的 attributes（包括 `class`、`style`）按 Vue 单根节点默认行为落到根 `div`。
