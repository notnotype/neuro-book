---
标签: [state:local, env:portal, env:global]
---

# Dialog

`Dialog` 是受控的模态对话框，负责遮罩、焦点陷阱、滚动锁、尺寸和统一页脚；宿主通过插槽呈现业务内容，并可选择接管关闭请求或确认流程。它与 `AlertDialog` 的区别是可承载任意正文，且页脚可自定义。

## 布局

对话框包含可选 header、可滚动 body 和可选 footer。默认 header 显示标题及可选关闭按钮；body 占据剩余高度并在内容溢出时内部滚动；默认 footer 可含取消与确认按钮。滚动正文时，标题下方或页脚上方才出现分隔线。`bodyClass` 与 `headerClass` 分别追加到对应容器，用来接管样式或滚动布局。

| `size` | 默认宽度 | 默认高度 | 最大高度 |
| --- | --- | --- | --- |
| `sm` | `360px` | `auto` | `85vh` |
| `default`（默认） | `420px` | `auto` | `85vh` |
| `md` | `min(560px, calc(100vw - 32px))` | `auto` | `85vh` |
| `lg` | `min(720px, calc(100vw - 32px))` | `auto` | `calc(100vh - 32px)` |
| `xl` | `min(1080px, calc(100vw - 20px))` | `min(780px, calc(100vh - 20px))` | `calc(100vh - 20px)` |
| `full` | `calc(100vw - 24px)` | `calc(100vh - 24px)` | `calc(100vh - 24px)` |

显式 `width`、`height`、`maxHeight` 分别覆盖预设的对应值。`overlayType` 默认为不透明遮罩；`transparent` 为透明遮罩，`blur` 使用 `--overlay-bg` 并增加模糊。

## 注意事项

`size="default"` 的默认宽度是固定 `420px`，不会按视口自动收窄。若在 `390px` 窄屏需要保留左右各 `16px` 的间距，使用 `size="md"`（宽度为 `calc(100vw - 32px)`）或显式覆盖 `width`。

## 交互

打开时焦点移入首个可聚焦控件（没有时聚焦对话框面板），Tab / Shift+Tab 在面板内循环；关闭时解除键盘监听与 body 滚动锁，并将焦点归还到打开前的元素。面板为 `role="dialog"`、`aria-modal="true"`；非空 `title` 同时作为 `aria-label`。关闭方式包括页脚取消按钮、可选关闭按钮、Escape 和遮罩上的主键或右键按下并在同一遮罩释放；对应原因分别是 `cancel`、`close-button`、`esc`、`overlay`。`busy` 阻止关闭及确认请求并禁用默认页脚按钮。

默认页脚中的确认按钮发出 `confirm`。若父组件监听了 `confirm`，由父组件负责后续关闭；否则组件自动发出 `update:modelValue(false)` 和 `cancel`。取消及其它关闭请求先发出 `request-close`；若没有监听该事件，组件自动发出 `update:modelValue(false)` 和 `cancel`。一旦父组件监听 `request-close`，关闭完全交给父组件处理，不会自动发出上述两项。

小尺寸 `sm`、`default` 的默认页脚按钮等宽填满一行；其它尺寸的按钮靠右排列。自定义 footer 插槽时，组件只提供确认和取消回调，不替插槽内容实现按钮或忙碌状态。

## 数据

```ts
type DialogSize = "sm" | "default" | "md" | "lg" | "xl" | "full";
type DialogCloseReason = "overlay" | "cancel" | "close-button" | "esc";

interface DialogProps {
    /** 是否打开；必填、受控，默认由父组件持有 */
    modelValue: boolean;
    /** 尺寸预设；可选，默认 "default" */
    size?: DialogSize;
    /** 标题；可选，默认空字符串；作为非空时的 aria-label */
    title?: string;
    /** 是否显示关闭按钮；可选，默认 false */
    closable?: boolean;
    /** 是否显示 header；可选，默认 true */
    showHeader?: boolean;
    /** 点击遮罩是否请求关闭；可选，默认 true */
    closeOnOverlay?: boolean;
    /** Escape 是否请求关闭；可选，默认 true */
    closeOnEsc?: boolean;
    /** CSS 宽度；可选，默认由 size 决定 */
    width?: string;
    /** CSS 高度；可选，默认由 size 决定 */
    height?: string;
    /** CSS 最大高度；可选，默认由 size 决定 */
    maxHeight?: string;
    /** Teleport 选择器；可选，默认 "body"；false 禁用 Teleport */
    teleportTarget?: string | boolean;
    /** 遮罩样式；可选，默认 "opaque" */
    overlayType?: "transparent" | "blur" | "opaque";
    /** 默认页脚是否显示取消按钮；可选，默认 false */
    showCancel?: boolean;
    /** 是否显示 footer；可选，默认 true */
    showFooter?: boolean;
    /** 是否阻止关闭与确认；可选，默认 false */
    busy?: boolean;
    /** body 附加 class；可选，默认空字符串 */
    bodyClass?: string;
    /** header 附加 class；可选，默认空字符串 */
    headerClass?: string;
    /** 默认取消按钮文字；可选，默认 "取消" */
    cancelLabel?: string;
    /** 默认确认按钮文字；可选，默认 "确认" */
    confirmLabel?: string;
    /** 关闭按钮可访问名称与 title；可选，默认 "关闭" */
    closeLabel?: string;
}

interface DialogEmits {
    /** 仅无 request-close 监听器时，默认关闭流程发出 false */
    (event: "update:modelValue", value: boolean): void;
    /** 默认确认按钮触发；无 confirm 监听器时随后自动关闭 */
    (event: "confirm"): void;
    /** 默认取消或自动关闭回退时发出 */
    (event: "cancel"): void;
    /** 请求关闭；原因是遮罩、取消按钮、关闭按钮或 Escape */
    (event: "request-close", reason: DialogCloseReason): void;
}

interface DialogSlots {
    /** 对话框正文 */
    default?: () => any;
    /** 替换 header 内容；未提供时使用 title、header-extra 与可选关闭按钮 */
    header?: () => any;
    /** 默认 header 中的附加内容；自定义 header 时不参与渲染 */
    "header-extra"?: () => any;
    /** 替换默认页脚按钮；接收确认与取消回调 */
    footer?: (props: {confirm: () => void; cancel: () => void}) => any;
}
```

组件没有 `expose` API；根节点为 Teleport，attrs 不属于稳定公共合同。`modelValue` 始终由父组件持有，不提供非受控初始值。`showHeader=false` 时不显示 header，即使 `closable=true` 也没有关闭按钮；`showFooter=false` 时不显示默认或自定义 footer。

## 状态与边界

`busy` 只阻止本组件提供的确认与关闭动作，不替正文控件设置 disabled。组件不定义正文的加载、错误或空数据外观，由默认插槽负责。无 `title` 时不会设置 `aria-label`；如使用自定义 header，应自行确保可访问名称。Dialog 的关闭按钮默认为隐藏，模态操作应通过有名称的页脚按钮提供出口。

## 不支持

不提供非模态模式、自动保存、异步确认锁定/错误提示或业务数据管理。自定义页脚回调只触发组件动作，不会替宿主等待异步任务。

## 隐藏通道理由

- `env:portal`：模态面板与遮罩需脱离宿主裁剪及 stacking context；默认传送到 `body`，可传选择器指定目标，`false` 时禁用 Teleport。字符串目标不存在时回退到 `body`。
- `env:global`：打开期间需在 `document` 处理 Escape/Tab，并锁定 `document.body` 滚动；关闭或卸载时移除监听、恢复滚动并归还焦点。这些行为是模态对话框的一部分，不应要求每个宿主重复实现。
