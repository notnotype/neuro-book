# t03 计划：桌面窗口自己画标题栏、应用图标

r1，2026-11-15。

## Context

开发者 2026-11-15 定：桌面窗口不要 Windows 原生标题栏，参考 VS Code 自己画（[Work README](../../README.md) 的“桌面端体验的决定”）。现在桌面窗口是系统标题栏加工作台自己 36px 的标题栏（[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 输出 28），两条。同一 Task 里补上应用图标：安装包、`launcher.exe`、`bun.exe` 现在都是缺省图标，品牌成品里已有 `brand/logo/06-production/desktop/windows/neurobook.ico`（16 到 256 共 7 种尺寸）。

依据：[`runtime/desktop-shell.md`](../../../../../docs/specs/runtime/desktop-shell.md)（非目标里“自定义标题栏以后另做”、输出 10、13、14）、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 输出 9 到 11（关闭前询问与更新提示的页面一侧）、[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 输出 28、30、[ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md)。

工作方式：autonomous-delivery；代码在 worktree `.worktree/w00046-t03-title-bar`（分支 `feat/w00046-t03-title-bar`，从 master 开）；Windows 验收在 pc-notype（只用 UI 自动化与 Win32 查询读状态，不截屏）。

### 已实测的事实（pc-notype，Electrobun 2.0.6，WebView2 157，[证据](evidences/frame-probe-r1.txt)）

- `titleBarStyle: "hiddenInset"` 去掉系统标题栏，保留拉伸边框与阴影；`sandbox: true`、加载 `http://127.0.0.1` 的页面里写 `app-region: drag` 的区域，`WindowFromPoint` 落在 WebView2 宿主侧的 `Chrome_WidgetWin_0` 上，`WM_NCHITTEST` 回 `HTCAPTION`（2）；按钮（`app-region: no-drag`）与正文回 `HTCLIENT`，窗口顶边 2px 回 `HTTOP`（可从顶边拉伸）。原因：Electrobun 对所有网页视图打开了 WebView2 的 `IsNonClientRegionSupportEnabled`（原生层，不经它的预加载；它沙箱预加载里没有 JS 拖动），所以拖动、双击最大化、贴边分屏都由系统做，页面只标区域。
- **缺陷**：`hiddenInset` 的窗口样式是 `WS_CAPTION | WS_THICKFRAME`，没有 `WS_SYSMENU`、`WS_MINIMIZEBOX`、`WS_MAXIMIZEBOX`。最大化后客户区是整个显示器（2560×1440，工作区 2560×1392），页面底部 48px 被任务栏盖住；Electrobun 的 `WM_GETMINMAXINFO` 只给 `WS_POPUP`（`hidden`）限在工作区。用 `bun:ffi` 给窗口补上这三位样式并 `SWP_FRAMECHANGED` 后，最大化的客户区正好是工作区（2560×1392），命中测试不变。
- Hutch 按 `build.win.icon` 把图标嵌进 `launcher.exe` 与 `bun.exe`（窗口归 `bun.exe` 进程）；窗口本身没有图标句柄（`WM_GETICON` 与窗口类图标都是 0）。
- 合成的 `WM_NCLBUTTONDBLCLK` 投递给 WebView2 的窗口不会最大化（它只认真实输入），所以双击最大化、拖动与贴边分屏的手感要真实操作确认（见“验证”）。

## 技术选型

- 拖动区域：CSS `app-region: drag`（WebView2 原生非客户区），不用 Electrobun 的 JS 拖动（沙箱预加载里没有，且它是按原始输入平移窗口，没有贴边分屏、双击最大化）。
- 补窗口样式与设窗口图标：`bun:ffi` 调 `user32`（`GetWindowLongPtrW`、`SetWindowLongPtrW`、`SetWindowPos`、`SendMessageW`）与 `shell32` 的 `ExtractIconExW`，Electrobun 的 `win.ptr` 就是 `HWND`。否决：改 Electrobun 源码自己编原生层（要维护补丁、跟版本）；`titleBarStyle: "hidden"`（`WS_POPUP`，没有拉伸边框与阴影）。
- 窗口按钮的图形：内联 SVG（10px 见方、1px 线，跟 Windows 的按钮字形一致），不用 lucide 的 `minus`、`square`、`copy`、`x`（线粗与比例不像系统按钮）。

## 关键设计

### 页面与壳的约定：`src/shared/desktop-bridge.ts`

- 页面发 `{type: "window-control", action: "minimize" | "toggle-maximize" | "close"}`；壳发 `{type: "window-state", maximized: boolean}`。都进现有的两个联合类型与校验，`HostReply` 收进 `window-control`。
- 预加载脚本（`desktop/src/bun/preload.ts`）在页面脚本之前定义只读的 `window.__nbookDesktopFrame = 1`：页面据此知道窗口没有系统标题栏，要自己画按钮。它是能力标记，不是“是不是桌面”的判断；以后 macOS 用 `hiddenInset` 保留红绿灯时，标记的值另定。

### 壳：`packages/neuro-book/desktop/src/bun/`

- `index.ts` 的 `openManaged`：Windows 上产品窗口与启动页窗口都用 `titleBarStyle: "hiddenInset"`（同一个窗口会从启动页换成产品页，样式在创建时定）；创建后调 `win32.ts` 的 `adoptCustomFrame(win.ptr)` 补样式、设图标。对话框窗口（`openDialog`）保留系统标题栏。
- `onWindowMessage`：`window-control` 对两种窗口都接（启动页也有按钮）：`minimize` → `win.minimize()`；`toggle-maximize` → 按 `win.isMaximized()` 切换；`close` → `shell.windows.closeRequested(id)`，与系统的关闭同一条路（输出 14 的询问、输出 17 的启动页直接关）。
- `window-state`：窗口的 `resize` 事件与收到 `page-ready`、启动页的 `shell-ready` 时，按 `win.isMaximized()` 发；与上一次发给这个窗口的相同就不发。
- 新文件 `win32.ts`：`adoptCustomFrame(hwnd)`，只在 `process.platform === "win32"` 时做事；`bun:ffi` 打开 `user32`、`shell32` 一次。补 `WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX`（理由写注释：最大化限在工作区、Alt+Space 系统菜单、任务栏点击最小化；失效条件是 Electrobun 自己给 `hiddenInset` 处理了 `WM_GETMINMAXINFO`）；按“应用图标”一节从包里的 ICO 取大小两个图标，`WM_SETICON` 设给窗口。调用失败写壳日志，不影响开窗。
- `src/views/shell/index.html`（启动页与对话框共用的页面）：启动页模式下顶上一条 36px 的拖动条（`app-region: drag`）与三个按钮，发 `window-control`；对话框模式下不画（对话框有系统标题栏）。页面怎么知道模式：`render` 交来的状态里已有 `kind`，对话框的种类集合是已知的。

### 页面宿主：`packages/neuro-book/src/web/`

- 新 `host/window-frame.ts`（不依赖 Vue）：`createWindowFrame({global, bridge, document, report})`。没有 `__nbookDesktopFrame` 时返回一个什么都不做的对象。有时：
  - 在 `<html>` 上设 `data-window-frame="custom"` 与 CSS 变量 `--nb-window-controls-width`（3 × 46px），按壳的 `window-state` 设 `data-window-maximized`；
  - 观察文档里有没有 `[data-window-titlebar]` 的元素（页面自己画了标题栏）：没有时设 `data-window-frame-bar`，由宿主画一条后备的标题栏；
  - 暴露 `state`（`maximized`、`hasPageTitlebar`、窗口是否在前台）与 `control(action)`，发送失败写诊断。
- 新 `WindowFrame.vue` 与 `WindowFrame.md`：独立的 Vue 根，`boot.ts` 在关闭层之后挂到 `body` 下的 `[data-window-frame-root]`，不随宿主页与工作台切换卸载（同 `CloseLayer` 的做法）。画两样：
  - 窗口按钮：固定在右上角，36px 高，每个 46px 宽；最小化、最大化或还原（字形随 `maximized`）、关闭；悬停底色用 `--bg-hover`，关闭按钮悬停是 Windows 的红（`#c42b1c`，白色字形）；窗口不在前台时字形用次要文字色；`app-region: no-drag`；`aria-label` 走宿主目录（新键 `window.minimize`、`window.maximize`、`window.restore`、`window.close`）。层级在关闭层之上：询问期间窗口照样能最小化、移动，再点关闭交给壳（输出 14 的“再次关闭出原生对话框”）。
  - 后备标题栏（`data-window-frame-bar` 时）：顶上 36px，`app-region: drag`，左边图形标志与文档标题，右边留出按钮的宽度；面与线取 `--shell-chrome-surface`、`--shell-chrome-line`，主题没加载时（宿主页）用系统颜色。
- `styles.css`：`html[data-window-frame-bar] body` 让出顶上 36px；`.nb-host-page` 的 `min-height` 与 `.nb-workbench-page` 的 `height` 减去 `--nb-window-frame-offset`（缺省 0，后备标题栏在时 36px）。书架首页与工作台页都在 `.nb-workbench-page` 里（`plugins/workbench/web/home-page.ts`），一处改动覆盖。
- `index.html` 的静态加载页：`html[data-window-frame] .nb-host-loading` 整块 `app-region: drag`（加载页阶段还没有 Vue 根，窗口至少能拖；关闭用 Alt+F4 与任务栏）。`data-window-frame` 由预加载脚本在 `<html>` 出现时就设上（它已有观察 `document` 的 MutationObserver），不等页面脚本。

### 工作台标题栏：`plugins/workbench/web/components/WorkbenchTitleBar.vue`

- 根上加 `data-window-titlebar`，样式 `app-region: drag`；按钮、菜单栏、搜索、条目区、项目切换这些能交互的部分 `app-region: no-drag`（按选择器一次写在根的样式里：`button`、`[role="menubar"]`、`[role="menuitem"]`、`a`、`input`、`[tabindex]`）。普通浏览器里 `app-region` 不生效，不按“是不是桌面”分支。
- 右边留出按钮的宽度：`padding-inline-end` 加上 `var(--nb-window-controls-width, 0px)`；逐级让位已经把根的左右内边距算进 `chrome`（`WorkbenchTitleBar.vue` 第 98 行），不用改 `yield.ts`。
- 双击标题栏空白处最大化由系统做，组件不处理。

### 应用图标：`brand/logo/` 与 `packages/neuro-book/desktop/`

- 开发者 2026-11-15 定（两次）：桌面图标不用 16、24 的像素专用版；“为什么不用 SVG”，规范可以改。ICO 里装不了 SVG，做法是每个尺寸都从同一份 SVG 直接渲染：应用图标不按尺寸换版本、不用像素专用版，桌面应用（Windows、macOS、Linux）与 favicon 用不带边框的那一份（开发者在 [对比图](artifacts/icon-variants/index.html) 上选的），网页清单仍用带封面边框的。`brand/logo/tools/produce.py` 与 `guidelines.py` 已改，Windows ICO 是 16–256 七档，`favicon.ico` 16、32、48 同源；界面里 14–24px 的单色小标志不是应用图标，仍用像素专用版。
- `assets/neurobook.ico`：从 `brand/logo/06-production/desktop/windows/neurobook.ico` 复制，`brand/logo/README.md` 的下游列表加上这一处；`electrobun.config.ts` 写 `build.win.icon: "assets/neurobook.ico"`，并把它复制进包（`build.copy` 到 `Resources/app/neurobook.ico`），供窗口图标与 t04 的托盘按需要的尺寸加载。
- 窗口图标：`win32.ts` 用 `LoadImageW(…, LR_LOADFROMFILE)` 从这份 ICO 按窗口所在显示器的 DPI 取大图标（`SM_CXICON`）与小图标（`SM_CXSMICON`）的尺寸（`GetSystemMetricsForDpi`），系统从最近的较大一档缩放；不用 `ExtractIconEx`（它只给 32 与 16 两种固定尺寸，高 DPI 下发糊）。
- 发布流水线与本机构建打的都是 `desktop/` 目录，检查 `scripts/build.ts` 与 `release.yml` 的桌面构建是否带上 `assets/`（Hutch 从配置读路径，相对 `desktop/`）。

## Spec 与文档改动

- `runtime/desktop-shell.md`：非目标去掉“自定义标题栏”；输出 10 改写为“窗口与标题栏”：Windows 上没有系统标题栏，页面画；最大化限在工作区；窗口图标是应用图标；输出 13 加上窗口按钮的两种消息；验收加场景 15“标题栏”（拖动、双击最大化与还原、贴边分屏、最大化不压任务栏、三个按钮、启动页也能拖与关、Alt+Space 系统菜单、Alt+F4）。实现合同的不变量加一条“补样式”。
- `runtime/browser-host.md`：新输出“窗口外框”：有能力标记时宿主画按钮与后备标题栏，页面用 `[data-window-titlebar]` 声明自己画了标题栏；加验收场景。
- `ui/workbench-shell.md` 输出 28：桌面窗口里标题栏就是窗口的拖动区域，右端留出窗口按钮。
- `desktop/README.md`：图标的来源。`WindowFrame.md` 新建；`WorkbenchTitleBar.md` 的“布局”补拖动区域与右端留位。

## 切片

1. **壳与约定**：桥的两种消息与校验测试；预加载的能力标记与 `data-window-frame`；`win32.ts`；`openManaged` 与 `onWindowMessage`；启动页的拖动条与按钮；图标资产与配置。验证：`bun run test:affected`（`src/shared`、`src/desktop`），桌面主进程预打包（`desktop/scripts/build.ts`）能过，`tsc`。提交。
2. **页面宿主与工作台标题栏**：`window-frame.ts` 与测试、`WindowFrame.vue` 与 DOM 测试、`boot.ts` 挂载、`styles.css`、`index.html`、宿主目录新键（中英）、`WorkbenchTitleBar` 的区域与留位及其 DOM 测试；e2e `desktop-frame.e2e.ts`。提交。
3. **Spec 与 Windows 验收**：三份 Spec 与两个组件文档；pc-notype 上用本分支的载荷重建安装包，按“验证”的 Windows 一节跑；证据写进 `evidences/`。提交。

## 验收映射

| Spec | 覆盖 |
|---|---|
| desktop-shell 输出 10（新写法）、13（窗口按钮） | `desktop-bridge.test.ts`（两种消息的形状）；Windows 验收 |
| desktop-shell 场景 15 | pc-notype 手工验收（UI 自动化与 Win32 查询） |
| browser-host 新输出“窗口外框” | `window-frame.test.ts`、`WindowFrame.dom.test.ts`、`desktop-frame.e2e.ts` |
| workbench-shell 输出 28（拖动区域与留位） | `WorkbenchTitleBar.dom.test.ts`、`desktop-frame.e2e.ts` |

## 验证

- 单元与 DOM：`bun run test:affected --since master`；`bunx tsc` 按包的 `typecheck` 脚本。
- e2e（合入前跑一次）：`desktop-frame.e2e.ts` 一个文件。用 Playwright 的 `addInitScript` 先定义 `__nbookDesktopFrame`（替代预加载脚本）：工作台页上有三个按钮、没有后备标题栏、标题栏根的 `-webkit-app-region` 计算值是 `drag`、搜索按钮是 `no-drag`、按钮不压在条目区上（右端留位）；书架首页与“页面不存在”页有后备标题栏、页面内容从 36px 处开始、没有滚动条；点按钮时 `__electrobunSendToHost` 收到 `window-control`（测试里装一个记录函数）；派发 `window-state` 后按钮的名字变成“还原”；不定义能力标记时什么都不画。改动后只重跑这一个文件。
- Windows（pc-notype）：用本分支的载荷重建安装包，装进测试标识（`NBOOK_DESKTOP_IDENTIFIER`），独立状态根。
  - Win32 查询：工作台标题栏空白处、书架后备标题栏、加载页的命中测试是 `HTCAPTION`，按钮与搜索是 `HTCLIENT`；窗口样式含三位；`WM_GETICON` 非 0；`ShowWindow` 最大化后客户区等于工作区。
  - UI 自动化：三个按钮的名字；Invoke 最小化（`IsIconic`）、最大化与还原（按钮名在“最大化”“还原”之间变、`IsZoomed`）、关闭（走关闭前询问：有未保存的修改时出编辑器的询问）；启动页的按钮。
  - 真实操作（拖动、双击标题栏、拖到屏幕边缘贴边、Alt+Space）：合成输入不可靠，也会动开发者的鼠标；请开发者在 pc-notype 上试一次，结果记进证据。在那之前写“未验证”。
- 未验证边界：多显示器与不同缩放比例下的最大化（只在 pc-notype 的单屏 100% 上测）；Windows 10（只测 Windows 11）。

## 不做与风险

- 不做：Windows 11 悬停最大化按钮弹出的贴靠布局（需要原生层对按钮返回 `HTMAXBUTTON`，WebView2 的非客户区只有拖动区域；Win+Z 照常可用）；macOS、Linux；对话框窗口去标题栏；标题栏在窗口不在前台时整体变淡（只让按钮字形变淡）；全屏模式。
- 风险：用户机器的 WebView2 太旧、没有非客户区支持（WebView2 123 之前）时拖动区域不生效，窗口只能用键盘移动。缓解：WebView2 随系统更新；壳的日志记下 WebView2 版本。记为已知限制写进 desktop-shell。
- 风险：补样式依赖 Electrobun 对 `hiddenInset` 的 `WM_NCCALCSIZE` 处理（去掉标题区）在加了 `WS_SYSMENU` 后不变；实测成立，升级 Electrobun 时复测（写进 `win32.ts` 的注释与 desktop/README 的升级检查）。
