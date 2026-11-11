---
标签: [state:local, state:inject, env:global, env:portal]
别名: ["通知中心", "Notification Center"]
---

# WorkbenchNotificationsView

底部面板里的“通知”视图（[`workbench/notifications.md`](../../../../../../../docs/specs/workbench/notifications.md) 输出 13 到 16）：列出本窗口发过的通知，弹出的通知关掉或到时消失后仍在这里，能再点它的动作、看详情、移除。视图开着并且页面在前台时，中心里的都算看过，新通知不再弹出；这件事由本组件上报给通知服务。

## 布局

- 整个列表共用几列（子网格），长短不一的标题不推动后面的列：没看过的点（6px）、色调图标（16px）、标题与正文（同一行，正文淡一档，放不下时截断、悬停看全文）、时间（至少 3.5em、按内容放宽，右对齐）、动作与“详情”（按内容宽）、移除（24px）。每行至少 28px 高。
- 没看过的行首一个强调色的点、标题加粗；点里有一段视觉隐藏的“没看过”给读屏。
- 列表在视图里纵向滚动（视图声明 `layout: "fill"`）；空的时候视图中间一句“没有通知。”。
- `390×844`：列不变，标题与正文先截断。

## 交互

- 点动作：交给中心执行，执行后这一条从中心与弹出处一起移除。
- 点“详情”：打开 `DetailDialog`，标题“通知标题：详情”（没有标题时只写“详情”），原文被截断时注明。
- 点移除：只从中心移除。
- 按钮都是 nb-ui 的 `Button`、`IconButton`，焦点画内嵌焦点线；行里的按钮用 `aria-describedby` 指向这一行的标题与正文，几行同名的“详情”“移除”读屏分得出是哪一条。

## 数据

```ts
type Props = {
    /** 工作台给视图的上下文；只读 `visible`。必填。 */
    context: ViewContext;
    /** 本窗口的通知中心（受控：条目、未读数由它持有，本组件只调它的方法）。必填。 */
    center: NotificationCenter;
};
```

没有事件与插槽；没有 expose；attrs 落在根上。

## 状态

- 空：居中的一句说明。
- 详情对话框打开期间显示点开那一刻的原文；那一条被移除时对话框照常显示，关闭后焦点交还打开前的元素。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取窗口的翻译端口，翻通知的标题、正文、动作名与本插件目录里的文字，并取当前语言格式化时间。
- `env:global`：经 `useForegroundVisibility`（`src/ui/foreground-visibility.ts`）监听 `document` 的 `visibilitychange`，页面转到后台时报“不可见”（输出 15、16 的“页面在前台”）；卸载时摘掉监听并报“不可见”，所以去书架页以后通知照常弹出。
- `env:portal`：“详情”经 `DetailDialog` 渲染到页面根上的浮层（nb-ui 对话框的门户）。
