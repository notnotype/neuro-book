---
标签: [state:inject]
---

# DesktopFrame

桌面窗口自己画的外框：窗口没有系统标题栏时，右上角的最小化、最大化（或还原）、关闭三个按钮，以及页面自己没有标题栏时的一条后备标题栏。行为合同见 [`runtime.browser-host`](../../../../docs/specs/runtime/browser-host.md) 的“窗口外框”与 [`runtime.desktop-shell`](../../../../docs/specs/runtime/desktop-shell.md) 输出 10；状态、`<html>` 上的属性与发给壳的消息在 `host/desktop-frame.ts`，全局的让位与拖动区域规则在 `styles.css`。

它是一个独立的 Vue 根：`boot.ts` 在窗口启动之前把它挂到 `body` 下的 `[data-desktop-frame-root]` 上（排在关闭层之后），不随宿主页与工作台切换卸载。普通浏览器里没有能力标记，它什么也不画。它依赖宿主链（能力标记、桥、`<html>` 上的属性），不在 Component Lab 里单独挂载，由 `DesktopFrame.dom.test.ts` 与 `e2e/desktop-frame.e2e.ts` 验收。

## 布局

- **窗口按钮** `[data-desktop-controls]`：固定在右上角，高 36px，三个按钮各占 `--nb-window-controls-width` 的三分之一（138px，每个 46px；宽度只在 `styles.css` 写一处），贴住窗口右缘；`role="group"`，名字是“窗口”。层级取 nb-ui 登记表的 `desktopFrame`：模态、命令面板开着时也在上面。
- **后备标题栏** `[data-desktop-fallback-bar]`：只在 `<html>` 带 `data-desktop-frame-bar`（`#app` 里没有 `[data-desktop-titlebar]`）时画。顶上 36px 满宽，左边 16px 的图形标志与文档标题（截断），右边留出按钮的宽度；整条是拖动区域。读屏不读它（`aria-hidden`）：它只是文档标题的重复。
- 颜色按三级回退：主题变量 → 加载页的 `--host-loading-*`（主题还没加载时）→ 系统色。窗口在前台时按钮字形用正文色，不在前台时用次要文字色；悬停底色是字形色的 10%；关闭按钮悬停是 Windows 的红 `#c42b1c` 配白色字形（系统按钮就是这个颜色，不随主题变）。高对比度模式下悬停用 `Highlight`。
- 标题栏与按钮随页面缩放（Ctrl+滚轮、Ctrl+加减）同比变化，不做反向补偿。

## 交互

- 点按钮把动作交给壳：最小化、在最大化与还原之间切换、关闭（与系统的关闭同一条路，会经过关闭前询问）。按钮名随壳推来的状态在“最大化”与“还原”之间换。
- 按钮不是 Tab 停靠点（`tabindex="-1"`），与系统标题栏的按钮一样；键盘用 Alt+Space 的系统菜单与 Alt+F4。
- 拖动、双击最大化、贴边分屏由 WebView2 按 CSS `app-region` 交给系统，组件不处理。
- 按下按钮不取焦点（`mousedown` 时阻止缺省行为），编辑器里的光标与选区不受影响。
- 关闭前询问期间按钮照样可用：关闭层不给它的根设 `inert`，它自己的根恢复 `pointer-events`（reka 的模态会给 `body` 设 `none`）。模态开着时窗口不能拖：遮罩盖满窗口，不是拖动区域。

## 数据

```ts
type Props = {
    /** host/desktop-frame.ts 的 createDesktopFrame：enabled、state（ShallowRef）与 control。 */
    frame: DesktopFrame;
};
```

没有 emits、slots、expose；它是独立应用的根，没有 attrs 可透传。

## 状态

- 没有能力标记：什么都不画。
- 最大化：中间的按钮字形是“还原”，名字是“还原”。
- 页面有自己的标题栏（工作台）：只画按钮，按钮压在标题栏右栏末尾留出的位置上。

## 不支持

- Windows 11 悬停最大化按钮弹出的贴靠布局（要原生层对按钮回 `HTMAXBUTTON`）；Win+Z 照常可用。
- 窗口不在前台时整条标题栏变淡（只让按钮字形变淡）。
- macOS 的红绿灯与 Linux：外框只在 Windows 的桌面壳里出现。

## 注意事项

- 按钮是原生 `<button>` 而不是 nb-ui 的 `IconButton`：系统标题栏的按钮是贴边、无圆角、无内边距的矩形，`IconButton` 做不出来。字形用 Windows 的图标字体（Windows 11 是 Segoe Fluent Icons，Windows 10 是 Segoe MDL2 Assets），与系统按钮像素一致；外框只在 Windows 上出现，所以不做别的字体回退。
- 模态打开时 reka 给内容之外的兄弟节点设 `aria-hidden`，外框根也在其中，这是模态的预期。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，翻译宿主目录 `nbook.host` 的 `desktopFrame.*`。
