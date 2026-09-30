---
标签: [state:shared-read, state:shared-write]
---

# NotificationViewport

应用级通知视口：从共享通知队列读取待显示项，按位置与偏移分组，在页面顶层呈现可关闭的 toast。它让任意页面都能把通知送到同一处，而不必在各自布局里重复放置提示。

## 布局与交互

视口固定覆盖窗口，通知卡片按队列给出的六种角落或边缘中点位置排列；同一位置与偏移的一组卡片纵向堆叠，最大宽度为 420px，窄屏保留 16px 水平内边距。`titlebar` 为真时，整个视口向下让出 `SHELL_TITLEBAR_HEIGHT`；通知自身的纵向偏移仍作用于各组。卡片展示可选标题，以及 `html` 或纯文本 `message`；右侧关闭按钮会从共享队列移除该项。卡片进出与同组移动有 220ms 过渡。

关闭按钮是唯一交互入口，带有“关闭通知”的可访问名称。该固定视口不接管焦点，不提供键盘快捷键；通知也不会自动获得焦点。

## 数据

```ts
type NotificationTone = "success" | "warning" | "info" | "error";
type NotificationPosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

interface NotificationItem {
    id: string;
    title?: string;
    message?: string;
    html?: string;
    tone: NotificationTone;
    position: NotificationPosition;
    offsetX: number;
    offsetY: number;
    autoClose: boolean;
    duration: number;
    createdAt: number;
}

interface NotificationViewportProps {
    /** 标题栏是否实际在场；为真时视口整体向下让出 SHELL_TITLEBAR_HEIGHT。默认 false。 */
    titlebar?: boolean;
}

type NotificationViewportEmits = {};
type NotificationViewportSlots = {};
```

队列项由 `useNotification()` 管理，不是本组件的 prop；关闭按钮调用其 `remove(id)`。本组件不 expose 方法或属性。`titlebar` 用于计算容器的行内顶偏移，不会写回队列或作为 DOM attribute 输出；其它未声明 attribute 因组件只有一个根容器而按 Vue 默认 fallthrough 规则处理。

## 状态与边界

空队列时只保留不可交互的固定视口层，不显示卡片。队列项的语气由 `tone` 映射到状态色；缺少 `title` 时省略标题行，`html` 有值时优先于 `message`，两者都没有时不显示正文。队列的自动关闭时长与入队策略属于 `useNotification()`，不是视口自身提供的配置。

不支持由 props 传入通知列表、修改通知内容、暂停计时、手动排序或通过 slot 替换卡片。`NotificationItem.html` 以 `v-html` 原样渲染；生产者必须确保内容可信或已净化，本组件不做 HTML 消毒。

## 隐藏通道理由

- `state:shared-read`：读取 `useNotification()` 的 `notifications` 队列，只有这份共享队列能让应用各处产生的通知汇聚到全局视口。
- `state:shared-write`：关闭按钮调用同一 composable 的 `remove(id)` 更新队列；由通知发起方逐个接收并处理关闭会把共享通知的生命周期分散到多个宿主。

## 验证入口

该组件由 Vue 应用根 `app.vue` 与标题栏在真实应用树中装配；`app.vue` 不是 Component Lab 的组件索引条目，因此这里没有独立 Lab 验证入口。由于组件直接读写共享通知状态，Lab 按能力标签将其判为不可挂载；不要为它搭建假通知宿主。
