---
标签: [state:local, state:inject, env:portal, env:global]
---

# Dialog

`Dialog` 是由父级 `modelValue` 控制的模态对话框，提供固定遮罩、header/body/footer 三段布局、通用关闭与确认请求，并允许各段由插槽替换。它把关闭原因和确认意图交回宿主，不在组件内决定业务保存或其它副作用。

## 布局与交互

对话框以固定遮罩居中显示。header 可隐藏，默认展示 `title` 与关闭按钮；body 占据剩余高度并在内容超出时内部滚动；footer 可隐藏，默认提供确认按钮，并可选增加取消按钮。`bodyClass` 与 `headerClass` 分别补充 body、header 的 class。`size` 预设如下，`width` / `height` / `maxHeight` 可分别覆盖对应尺寸：`sm` 为 360px、auto、85vh；`default` 为 420px、auto、85vh；`md` 为 `min(560px, calc(100vw - 32px))`、auto、85vh；`lg` 为 `min(720px, calc(100vw - 32px))`、auto、`calc(100vh - 32px)`；`xl` 为 `min(1200px, calc(100vw - 48px))` × `min(840px, calc(100dvh - 80px))`，最大高度 `calc(100dvh - 80px)`；`full` 为 `min(1600px, calc(100vw - 48px))` × `min(1080px, calc(100dvh - 80px))`，最大高度 `calc(100dvh - 80px)`。

遮罩默认为半透明黑；`transparent` 不覆盖底色。可由同一次指针按下并在遮罩上抬起触发遮罩关闭；左右键均可触发，右键原生菜单会被屏蔽。Escape 默认请求关闭。`busy=true` 时关闭、取消和确认动作都不执行。组件出现和消失由父级改变 `modelValue`；只有没有对应监听器的默认路径才会发 `update:modelValue(false)` 并发出 `cancel`。它只绘制遮罩，不提供焦点移动、焦点陷阱、关闭后焦点归还或 `role="dialog"` / `aria-modal` 语义。
默认宽度为 420px（`size="default"`），不会随视口自动收窄；在 390px 视口会超出 30px。窄屏应显式选 `md` / `lg` 尺寸或提供 `width` 覆盖；`sm` 的 360px 固定宽度能放进该视口。高内容在 `maxHeight` 内由 body 滚动。

## 数据

```ts
type DialogSize = "sm" | "default" | "md" | "lg" | "xl" | "full";
type DialogCloseReason = "overlay" | "cancel" | "close-button" | "esc";

interface DialogProps {
    /** 显隐受控值，必填。 */
    modelValue: boolean;
    /** 标准尺寸；默认 "default"。 */
    size?: DialogSize;
    /** 默认 header 标题；默认空字符串。 */
    title?: string;
    /** 是否显示 header 关闭按钮；默认 true。 */
    closable?: boolean;
    /** 是否渲染默认 header；默认 true。 */
    showHeader?: boolean;
    /** 遮罩上的有效按下/抬起是否请求关闭；默认 true。 */
    closeOnOverlay?: boolean;
    /** Escape 是否请求关闭；默认 true。 */
    closeOnEsc?: boolean;
    /** 覆盖预设宽度；默认由 size 决定。 */
    width?: string;
    /** 覆盖预设高度；默认由 size 决定。 */
    height?: string;
    /** 覆盖预设最大高度；默认由 size 决定。 */
    maxHeight?: string;
    /** Teleport 目标选择器；默认 ".novel-ide-theme"；传 false 禁用 Teleport。 */
    teleportTarget?: string | boolean;
    /** 遮罩类型；默认 "opaque"。 */
    overlayType?: "transparent" | "opaque";
    /** 是否显示默认取消按钮；默认 false。 */
    showCancel?: boolean;
    /** 是否显示 footer；默认 true。 */
    showFooter?: boolean;
    /** 忙碌时阻止关闭和确认；默认 false。 */
    busy?: boolean;
    /** body 附加 class；默认空字符串。 */
    bodyClass?: string;
    /** header 附加 class；默认空字符串。 */
    headerClass?: string;
}

interface DialogEmits {
    /** 未接管 request-close 的默认关闭，以及显隐受控值同步。 */
    (event: "update:modelValue", value: boolean): void;
    /** 默认确认；若有 confirm 监听器则只发事件、不自动关闭。 */
    (event: "confirm"): void;
    /** 默认关闭路径在发 update:modelValue(false) 后发出。 */
    (event: "cancel"): void;
    /** 关闭请求；有监听器时默认关闭被交给宿主决定。 */
    (event: "request-close", reason: DialogCloseReason): void;
}
```

插槽：`default` 为滚动 body；`header` 替换默认 header；`header-extra` 插入默认标题右侧（仅当未替换整个 header 时）；`footer` 替换 footer，并接收 `{confirm: () => void; cancel: () => void}`。没有 expose。attrs 未明确绑定到内部 DOM 节点，Teleport 根节点不提供稳定透传目标。

## 状态与边界

- 默认展示标题栏、正文、确认按钮和不透明遮罩；打开值始终由宿主持有。
- `closable=false` 隐藏关闭按钮；`showHeader=false` 隐藏 header；`showFooter=false` 隐藏 footer。`showCancel=true` 增加取消按钮。
- `busy=true` 禁止关闭与确认；没有独立禁用或只读态。
- 空正文仍保留布局；错误、空数据和业务加载反馈均由插槽内容呈现。
- 未监听 `request-close` 时，关闭请求会发出 `update:modelValue(false)` 与 `cancel`；已监听时宿主必须自行关闭。
- 未监听 `confirm` 时，确认会执行默认关闭并发 `cancel`；已监听时仅通知宿主，不自动关闭。

## 隐藏通道理由

- `state:local`：保存遮罩指针按下的按钮与 Teleport 是否已挂载，均随实例销毁。
- `state:inject`：通过 Nuxt `useI18n()` 取得默认取消/确认文案，使按钮随当前应用语言变化而无需宿主重复传入。
- `env:portal`：固定定位的模态遮罩需要脱离局部裁剪和层叠上下文。默认目标为 `.novel-ide-theme`；目标不存在时本组件没有 body 回退，会按 Vue Teleport 的既有行为报告未解析目标。Lab 页面本身提供该真实主题宿主；特殊场景可用 `teleportTarget=false` 原位渲染。
- `env:global`：`modelValue` 变化时登记 Escape 的 document keydown 监听，隐藏或卸载时移除。当前 watch 非 immediate，初次挂载即为打开值不会执行该 watch（当前实现见「已知偏差」）。

## 已知偏差

初次挂载即 `modelValue=true` 时，显隐 watch 不运行，因此 document Escape 监听没有登记；先以关闭状态挂载、再打开则会登记。关闭按钮与遮罩处理不依赖该监听。