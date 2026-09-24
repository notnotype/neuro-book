---
标签: [state:shared-read, state:shared-write, env:timer]
---

# NotificationViewport

`NotificationViewport` 是全局通知队列的可视出口：把 `useNotification()` 创建的通知固定显示在视口边缘，并集中处理自动消失、悬停暂停、关闭和通知动作。它本身不创建通知；产品只需挂载一个视口，就能展示由该 composable 发出的通知。

## 布局

通知按创建顺序纵向排列，间隔 8px；每项由 `Notification` 渲染。固定容器最大宽度为 448px（含两侧各 16px 内边距），单条通知内容区最大约 416px。默认固定在视口底部水平居中，也可固定在右上或右下。通知不拦截空白处的指针事件，单条通知可交互。客户端挂载前不渲染内容。

在窄屏中仍使用所选边缘位置和居中规则，宽度受视口与外边距约束，内容超长由通知自身排版；进入和离开分别淡入淡出并沿纵向移动 8px。

## 交互

- 队列中的通知由 `useNotification` 自动移除；指针进入某条通知时暂停它的自动关闭计时，离开后按剩余时间恢复，且至少留出 800ms。
- 带动作的通知显示动作按钮。点击后调用该通知携带的 `action.run()`，随后移除该通知。
- 不论通知是否有自动关闭时长，视口都将每条通知设为可关闭；点击“关闭通知”按钮后从共享队列移除该项。
- 动作与关闭按钮的键盘、焦点和可访问名称由子组件 `Notification` 的按钮承担；本组件自身不注册快捷键。

## 数据

```ts
type NotificationPosition = "bottom-center" | "bottom-right" | "top-right";

interface NotificationViewportProps {
    /** 通知堆叠位置；默认 "bottom-center"。 */
    position?: NotificationPosition;
    /** 每条通知关闭按钮的可访问名称与 title；默认 "关闭通知"。 */
    closeLabel?: string;
}

interface NotificationViewportEmits {}
interface NotificationViewportSlots {}
```

没有 `update:*` 事件，通知队列不受控于 props；组件不 expose 方法或属性。未声明 attrs 没有稳定的透传目标（根部经过 `ClientOnly`）；不要依赖其落点。

## 状态与边界

- 空队列：客户端视口容器内没有通知。
- 有通知：按队列顺序堆叠；通知的 tone、标题、消息、动作和时长来自共享 `NotificationItem`，tone 的取值为 `"info" | "success" | "warning" | "error"`。
- `NotificationViewport` 强制每条通知 `dismissible: true`，所以视口中总有关闭按钮。
- 本组件没有禁用、只读、加载或错误状态。

## 不支持

- 不提供创建、更新或清空通知的 props、slots、emits 或 expose API；这些动作由 `useNotification()` 提供。
- 不提供逐条可配置的停留时长或动作确认流程；时长及动作函数随通知数据一起提交。

## 隐藏通道理由

`state:shared-read`：`useNotification` 从模块级共享队列读取通知，因此不同调用方发出的通知可以由同一个视口统一呈现。此出口属于共享通知服务的一部分，而不是某个业务父组件维护的局部数组；需要隔离队列时应调整宿主/服务边界，不能把它误认为纯受控列表。

`state:shared-write`：关闭通知会调用共享服务的 `remove` 修改队列；动作完成后也移除通知。将移除交由通知出口执行，才能让按钮与自动过期共用同一套队列清理行为。

`env:timer`：自动关闭计时器由 `useNotification` 管理，视口在悬停时暂停、离开时恢复该计时器。计时与通知队列生命周期相同，集中在通知服务中处理。

此组件读取并经 `remove` 修改共享队列；在公共零件中这是有意的有耦合偏离，理由见上文。
