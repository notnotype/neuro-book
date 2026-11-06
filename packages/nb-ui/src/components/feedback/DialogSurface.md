---
标签: [state:local]
验证入口: Dialog
---

# DialogSurface（内部零件）

`Dialog` 与 `FloatingWindow` 共用的外框：面、标题栏、可滚动正文、页脚、状态行、关闭按钮，以及正文真的滚动起来时才出现的头尾分隔线。不从 `./components` 导出。布局与外观规则写在 [`Dialog.md`](Dialog.md) 的“布局”一节。

它只画外框，不管定位、叠放、焦点与关闭判定：

- 位置、尺寸与层级由宿主经 `style` 给（宿主用 `dialog-frame.ts` 的尺寸预设算）。
- 关闭按钮与取消按钮只发 `request-close("close-button" | "cancel")`，确认按钮只发 `confirm`；判定、`busy` 拦截与 `update:open` 由宿主做。
- 二级的面由宿主传 `nested`（宿主从 `useOverlayLayer` 拿到）。外框自己不读嵌套层数的注入：它读到的是宿主刚提供的值，每一层都会判成二级。
- 窗口的缩放手柄从 `edges` 插槽放进来；`window` 为真时标题栏标为拖动区域、外框带窗口的圆角。

## 合同

单根 `<section>`：宿主与 reka `DialogContent as-child` 给的 class、style、`data-*`、ARIA 属性与 `@pointerdown`（窗口拖动）都落在它上面。下面这些属性与类名是测试与宿主样式在读的合同，不要改名：

- `data-dialog-surface`、`data-dialog-window`（窗口时）、`data-dialog-drag`（标题栏，窗口时）、`data-dialog-body`、`data-dialog-status`、`data-dialog-status-error`；
- `.nb-dialog`、`.nb-dialog__header`、`.nb-dialog__body`、`.nb-dialog__corner-close`、`.nb-ui-dialog-surface--window`、`.nb-ui-dialog-surface--nested`；
- CSS 变量 `--nb-dialog-close-room`（没有标题栏时角上关闭按钮占的见方，宿主的正文按它让位）；
- CSS 变量 `--nb-dialog-from-x`、`--nb-dialog-from-y`、`--nb-dialog-from-scale`、`--nb-dialog-enter-duration`：入场与关闭动画的起点，由宿主经 `style` 写进来（见下一节），没写就是原地缩放淡入。

## 入场与关闭

用关键帧而不是过渡：reka 关闭时等的是 `animationend`，过渡来不及播就被卸掉了。起点读上面那几个变量：有来处时（用户点按钮、菜单项打开）朝来处偏一小段并放大（起始缩放 0.9，时长 `--motion-enter`），没有来处时（快捷键、命令面板、程序打开）原地缩放（0.96，`--motion-base`）。关闭沿用同一组变量，朝同一方向收回。系统要求减少动态效果时时长令牌是 0，动画不播，第一帧就是终点。变量怎么算见 [`Dialog.md`](Dialog.md) 的“从触发点展开”。

`defineExpose({panel})`：外框元素，宿主用它做初始焦点、窗口拖动与“遮罩下是不是最上层”的判断。

插槽：`default`（正文）、`header`、`header-extra`、`status`、`footer`（参数 `{confirm, cancel}`）、`edges`。

## 隐藏通道理由

- `state:local`：正文是否滚离顶部、下方是否还有内容（决定两条分隔线），由正文的滚动事件与外框的尺寸变化（`ResizeObserver`）更新，卸载时断开。
