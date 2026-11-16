---
标签: [state:inject]
---

# DesktopFrame

桌面窗口自己画的外框：窗口没有系统标题栏时，右上角的最小化、最大化（或还原）、关闭三个按钮，以及页面自己没有标题栏时的一条后备标题栏。行为合同见 [`runtime.browser-host`](../../../../docs/specs/runtime/browser-host.md) 的“窗口外框”与 [`runtime.desktop-shell`](../../../../docs/specs/runtime/desktop-shell.md) 输出 10；状态、`<html>` 上的属性与发给壳的消息在 `host/desktop-frame.ts`，全局的让位与拖动区域规则在 `styles.css`。

它是一个独立的 Vue 根：`boot.ts` 在窗口启动之前把它挂到 `body` 下的 `[data-desktop-frame-root]` 上（排在关闭层之后），不随宿主页与工作台切换卸载。普通浏览器里没有能力标记，它什么也不画。它依赖宿主链（能力标记、桥、`<html>` 上的属性），不在 Component Lab 里单独挂载，由 `DesktopFrame.dom.test.ts` 与 `e2e/desktop-frame.e2e.ts` 验收。

## 布局

- **窗口按钮** `[data-desktop-controls]`：固定在右上角，高 36px，宽 `--nb-window-controls-width`（120px，只在 `styles.css` 写一处）：左边 18px 里一道 16px 高的短分隔线（与工作台标题栏里项目切换与菜单之间的同款），把它们与左边的布局按钮分成两组；然后是三个 34×36 的命中区，贴住窗口右缘与上缘。`role="group"`，名字是“窗口”。层级取 nb-ui 登记表的 `desktopFrame`：模态、命令面板开着时也在上面。
- **芯**：每个命中区中间是 26×26 的芯，与标题栏里的布局按钮（nb-ui `IconButton` 的 `sm`、default 变体）同样大小、圆角、颜色、过渡与按下缩放；图标是 15px 的内联 SVG，图形取自 lucide（minus、square、copy、x），与布局按钮的 lucide 图标同形同粗。指针在命中区里任何位置都点亮芯。
- **后备标题栏** `[data-desktop-fallback-bar]`：只在 `<html>` 带 `data-desktop-frame-bar`（`#app` 里没有 `[data-desktop-titlebar]`）时画。顶上 36px 满宽，左边 16px 的图形标志与文档标题（截断），右边留出按钮的宽度；整条是拖动区域。读屏不读它（`aria-hidden`）：它只是文档标题的重复。
- 颜色与圆角按三级回退：主题变量 → 加载页的 `--host-loading-*`（主题还没加载时）→ 系统色或定值。静止图标是次要文字色，悬停时芯的底色是正文色的 15%、图标变正文色，按下 24% 并缩到 0.93；不随窗口前台与否变化（标题栏里别的图标也不变）。关闭按钮悬停是 Windows 的红 `#c42b1c` 配白色图标（系统按钮就是这个颜色，不随主题变）。高对比度模式下图标是 `ButtonText`，悬停芯用 `Highlight`。
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
- 最大化：中间的按钮图标是“还原”（两个叠着的方块），名字是“还原”。
- 页面有自己的标题栏（工作台）：只画按钮，按钮压在标题栏右栏末尾留出的位置上。

## 不支持

- Windows 11 悬停最大化按钮弹出的贴靠布局（要原生层对按钮回 `HTMAXBUTTON`）；Win+Z 照常可用。
- 窗口不在前台时变淡：整条标题栏与按钮都不变。
- macOS 的红绿灯与 Linux：外框只在 Windows 的桌面壳里出现。

## 注意事项

- 按钮是原生 `<button>` 而不是 nb-ui 的 `IconButton`：命中区（34×36，关闭按钮一直到窗口角上）比看得见的芯大，`IconButton` 是定边长的方块，做不出来。芯的尺寸与状态值与 `IconButton` 同步，那边改了这里跟着改。
- 图标用内联 SVG 而不是 `i-lucide-*` 类：图标类是遮罩加 `background-color: currentColor`，高对比度模式下背景色被强制成 Canvas，按钮会整个消失；SVG 的描边用 `currentColor`，颜色由系统给。启动页（`desktop/src/views/shell/index.html`）是静态 HTML，用同样的四个图形。
- 2026-11-16 以前按钮用 Windows 的图标字体、46×36 的直角块，开发者试用后觉得与标题栏不是一套、偏大（w00046 t18）。
- 模态打开时 reka 给内容之外的兄弟节点设 `aria-hidden`，外框根也在其中，这是模态的预期。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，翻译宿主目录 `nbook.host` 的 `desktopFrame.*`。
