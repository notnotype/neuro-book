---
标签: [state:local, env:portal, env:global]
---

# DialogWindow

`DialogWindow` 是一个无遮罩、页面仍可交互的非模态浮动窗口，适合在查看或编辑工作区内容时并排保留主页面。它与模态 `Dialog` 的区别是：窗口外点击不会关闭窗口，也不会锁定背景滚动；标题栏可拖动，尺寸调整是可选能力。

## 布局

窗口由标题栏、可滚动 body 和可选 footer 组成。标题栏包含拖动区域、可选关闭按钮和一个 `DialogTitle`；body 占据剩余高度，内容超出时由 `bodyClass` 决定滚动归属；footer 固定在底部，不随 body 滚动。`maxHeight` 限制窗口高度，启用 `resizable` 后窗口至少保持 `minWidth` × `minHeight`。

在 `390×844` 窄屏中，窗口宽度自动收敛到视口内侧并保留 12px 两侧间距；窗口不会制造页面级横向滚动，长内容继续在 body 内滚动。桌面视口默认从右上区域打开，拖动后保留本次组件实例中的位置。

## 交互

- 打开窗口后，Reka Dialog 语义为非模态：不渲染 Overlay、不困住焦点、不锁定背景指针事件；窗口外元素仍可点击和聚焦。
- 标题栏的标题区域可拖动。窗口至少保留一段可抓取区域在视口内，拖动不会改变页面滚动位置。
- `closable` 为 `true` 时显示关闭按钮；按钮带有“关闭”可访问名称。`closeOnEsc` 为 `true` 时按 Escape 请求关闭。`busy` 时关闭按钮、Escape 和 resize 均不生效。
- 没有 `request-close` 监听器时，关闭动作发出 `update:modelValue(false)`；存在监听器时只发出 `request-close`，由宿主决定是否关闭。这保留了确认、撤销或异步保存等宿主流程的控制权。
- `resizable` 为 `true` 时提供右侧、底部和右下角三个可聚焦 resize 手柄。鼠标拖动在 pointerup 时提交尺寸；方向键按 10px 调整，Shift + 方向键按 1px 调整，尺寸不会低于最小值。
- Reka 负责 Dialog 的角色、标题关联、Portal 和生命周期；窗口定位、拖动、resize 与视口约束由本组件负责。组件不提供模态焦点陷阱。

## 数据

```ts
type DialogWindowResizeAxis = "width" | "height" | "both";

type DialogWindowProps = {
    /** 是否显示；必填、受控，默认由宿主持有 */
    modelValue: boolean;
    /** 标题文字；默认空字符串；无 header 时为空则使用视觉隐藏标题 */
    title?: string;
    /** 宽度（px）；默认 560；窄屏显示宽度会收敛到视口 */
    width?: number;
    /** 高度 CSS 值或 px 数值；默认 auto */
    height?: string | number;
    /** 最大高度 CSS 值；默认 calc(100dvh - 80px) */
    maxHeight?: string;
    /** 是否启用 resize；默认 false */
    resizable?: boolean;
    /** 最小宽度（px）；默认 320 */
    minWidth?: number;
    /** 最小高度（px）；默认 240 */
    minHeight?: number;
    /** 是否显示关闭按钮；默认 true */
    closable?: boolean;
    /** 是否响应 Escape；默认 true */
    closeOnEsc?: boolean;
    /** 忙碌时阻止关闭与 resize；默认 false */
    busy?: boolean;
    /** body 容器 class；默认 overflow-y-auto px-4 py-3 */
    bodyClass?: string;
    /** Portal 目标；默认 body；传 false 关闭 Teleport */
    teleportTarget?: string | boolean;
};

type DialogWindowEmits = {
    /** Reka open 状态变化或无 request-close 监听器时的默认关闭事件 */
    (event: "update:modelValue", value: boolean): void;
    /** 关闭按钮或 Escape 请求关闭；原因分别为 close-button / esc */
    (event: "request-close", reason: "close-button" | "esc"): void;
    /** resize 鼠标提交或键盘调整后的宽度（px） */
    (event: "update:width", value: number): void;
    /** resize 鼠标提交或键盘调整后的高度（px） */
    (event: "update:height", value: number): void;
};
```

插槽合同：默认插槽是 body 内容；`header` 替换标题栏文字并仍包在 `DialogTitle` 中；`footer` 渲染底部操作区。组件不暴露 `expose` API；attrs 不是稳定公共合同，不应依赖内部 Reka 节点的透传位置。组件不提供业务数据、请求、store 或持久化能力。

`env:portal` 的理由：浮动窗口必须脱离宿主的局部 stacking context 才能稳定覆盖工作区；`teleportTarget` 明确指定目标，默认公共目标为 `body`。产品主题宿主（例如 NeuroBook 的 `.novel-ide-theme`）必须由消费者显式传入，不能由公共包硬编码。目标不存在时保持 Vue/ ReKa Portal 的原有 Teleport 行为，不创建隐式目标。

`env:global` 的理由：标题栏拖动和 pointer resize 需要在一次手势持续期间监听指针移动与释放事件；组件销毁或手势结束时解除监听。该监听不是常驻全局快捷键。

## 状态与边界

- 默认：显示标题栏、body 和可选 footer；窗口打开状态完全由 `modelValue` 控制。
- 禁用/只读：组件没有统一 disabled 或 readonly 状态；宿主应通过 `busy` 阻止关闭与 resize，并在 body 控制业务字段状态。
- 忙碌：关闭按钮不可用、Escape 不关闭、resize 手柄不进入 Tab 顺序，也不发出 resize 事件。
- 出错、空数据：组件不解释 body 数据；宿主通过默认插槽呈现错误或空状态。
- 没有标题：组件使用视觉隐藏的 `DialogTitle`，仍为 Dialog 提供可访问名称。
- 空 footer：未提供 `footer` 插槽时不渲染 footer 区域。

## 不支持

- 不支持 Overlay、模态焦点陷阱、背景指针事件锁定或背景滚动锁定。
- 不支持自动保存位置或尺寸到浏览器存储；宿主如需持久化必须通过受控 props/emits 自行实现。
- 不支持替代 `Dialog` 或 `AlertDialog` 承担确认流程；需要破坏性确认时使用对应模态组件。

## 上游边界

Reka UI 负责 Dialog 的角色、`aria-labelledby` 关联、Portal、Escape/outside 事件和非模态生命周期。本组件承诺阻止 outside dismiss、保留页面交互并将 Escape 转换为 `request-close`；Reka 其余实现细节及升级后的未声明行为不属于本组件合同。
