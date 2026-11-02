---
标签: [state:inject]
---

# Notification

`Notification` 是一条内联状态通知，使用 `info`、`success`、`warning` 或 `error` 色调呈现图标与内容；它只展示信息并上报用户动作，不负责入队、自动消失或自身关闭。可以带一条进度条，给长任务用。

## 布局与状态

通知从左到右显示色调图标、可伸缩的标题/正文、可选动作按钮和可选关闭按钮。标题仅在标题文字非空或提供 `title` 插槽时出现；正文容器始终存在，默认文字来自 `message`。给了 `progress` 时正文下多一条进度条：数值画确定进度（`Progress`，`sm` 档，色调随通知），`null` 画一条自己来回滑动的短条表示不确定进度（系统设了减少动画时停住）。动作按钮在 `actionLabel` 非空或提供 `action` 插槽时出现。`dismissible=true` 才显示关闭按钮。

根节点为 `role="status"`。色调同时决定图标与状态颜色；通知没有禁用、加载或错误覆盖态，`error` 是通知色调而非组件错误状态。窄空间下正文列可收缩，按钮保持自身宽度。

## 数据

```ts
type NotificationTone = "info" | "success" | "warning" | "danger";

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
    /** 关闭按钮的可访问名称及 title；可选，缺省按界面语言取（中文 "关闭通知"） */
    closeLabel?: string;
    /** 进度（0 到 100）；null 为不确定进度；不给就没有进度条 */
    progress?: number | null;
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

## 隐藏通道理由

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取关闭按钮的缺省可访问名称，以及不确定进度条的取值文字，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `closeLabel` 时以属性为准，不读端口。进度条的取值文字没有对应的属性，固定走端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。
