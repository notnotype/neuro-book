# t03 计划：桌面窗口自己画标题栏、应用图标

r2，2026-11-15（r1 经设计审查第 1 轮修订：omp 14 条、Sonnet 17 条，处理见 [evidences/design-review-r1-disposition.txt](evidences/design-review-r1-disposition.txt)）。

## Context

开发者 2026-11-15 定：桌面窗口不要 Windows 原生标题栏，参考 VS Code 自己画（[Work README](../../README.md) 的“桌面端体验的决定”）。现在桌面窗口有两条标题栏：系统的，加上工作台自己 36px 的（[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 输出 28）。同一 Task 补上应用图标。

依据：
- [`runtime/desktop-shell.md`](../../../../../docs/specs/runtime/desktop-shell.md)：非目标里的“自定义标题栏以后另做”、输出 10、13、14、17。
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 输出 9 到 11。
- [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 输出 28、30。
- [ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md)。

工作方式：
- autonomous-delivery。
- 代码在 worktree `.worktree/w00046-t03-title-bar`（分支 `feat/w00046-t03-title-bar`）。应用图标已在这个分支上提交（`be074783f`、`39276fe1e`），见下文“应用图标”。
- Windows 验收在 Windows 开发机上做：只用 UI 自动化与 Win32 查询读状态，不截屏、不动鼠标。

### 已实测的事实

来源：Windows 开发机，Electrobun 2.0.6，WebView2 157（[frame-probe-r1.txt](evidences/frame-probe-r1.txt)，第 7 条是设计审查后补测的）。

- **沙箱页面的 `app-region` 走系统命中。** 用 `titleBarStyle: "hiddenInset"`、`sandbox: true`、加载 `http://127.0.0.1` 的页面时：
  - 写 `app-region: drag` 的区域，`WM_NCHITTEST` 回 `HTCAPTION`；
  - `no-drag` 的按钮与正文回 `HTCLIENT`；
  - 顶边回 `HTTOP`。
  所以拖动、双击最大化、贴边分屏都由系统做，页面只标区域。原因是 Electrobun 在原生层对所有网页视图打开了 WebView2 的 `IsNonClientRegionSupportEnabled`。
- **`hiddenInset` 最大化会压住任务栏。** 它的样式缺 `WS_SYSMENU`、`WS_MINIMIZEBOX`、`WS_MAXIMIZEBOX`，最大化后铺满整个显示器，任务栏盖住页面底部 48px。经 `bun:ffi` 补上这三位并 `SWP_FRAMECHANGED` 后，最大化正好是工作区，命中测试不变。Electrobun 的 `styleMask` 选项在 Windows 上不起作用，所以只能这样补。
- **窗口没有图标。** Hutch 按 `build.win.icon` 把图标嵌进 `launcher.exe` 与 `bun.exe`，但窗口本身没有图标句柄。
- **浮层不挡拖动区。** `app-region` 不管层叠：盖在拖动区上、没写 `no-drag` 的固定定位浮层，命中仍是 `HTCAPTION`（点它就是拖窗口）；浮层写了 `no-drag` 才回 `HTCLIENT`。
- **合成的双击无效。** WebView2 只认真实输入，所以拖动、双击、贴边的手感要真实操作确认。
- **线程方向。** Electrobun 的窗口回调都是 `threadsafe` 的无返回值回调，原生 UI 线程不同步等 Bun 线程；Bun 线程同步调窗口函数，与 Electrobun 自己的 `dispatch_sync` 同向，不形成等待环。这一条从源码核实（`sdks/main/proc/native.ts` 第 2700 到 2730 行），Windows 验收在并发开窗与拖动时复核。

## 技术选型

- **拖动区域**：CSS `app-region: drag`，两种写法都写（`-webkit-app-region` 与 `app-region`），由 WebView2 原生处理。不用 Electrobun 的 JS 拖动：它的沙箱预加载里没有，而且是按原始输入平移窗口，没有贴边分屏与双击最大化。
- **补样式与窗口图标**：`bun:ffi` 调 `user32`（`win.ptr` 就是 HWND）。图标用 `LoadImageW(LR_LOADFROMFILE)`，按 DPI 取尺寸。
  - 否决改 Electrobun 原生层：要维护补丁。
  - 否决 `titleBarStyle: "hidden"`：它是 `WS_POPUP`，没有拉伸边框与阴影。
- **窗口按钮的字形**：先用系统图标字体 `"Segoe Fluent Icons", "Segoe MDL2 Assets"` 的 E921（最小化）、E922（最大化）、E923（还原）、E8BB（关闭），与系统按钮像素一致；字体不存在（普通浏览器、e2e）时回退到内联 SVG。否决只用 SVG：1px 线在 125%、150% 缩放下落在半像素上会糊。

## 关键设计

### 页面与壳的约定：`src/shared/desktop-bridge.ts`

- **页面发**：
  - `{type: "window-control", action: "minimize" | "toggle-maximize" | "close"}`；
  - `{type: "window-state-query"}`：页面的外框一建立就问一次，免得整页导航之后、`page-ready` 之前按钮显示的状态是错的。
- **壳发**：`{type: "window-state", maximized: boolean}`。
  - `maximized` 严格等于 Win32 的 `IsZoomed`；贴边分屏不算最大化，按钮仍是“最大化”。这一条写进 Spec。
- 两种页面消息进 `HostReply`；`window-state` 进 `ShellMessage`。文件头的“输出 9 到 11”改为连同新输出。
- **能力标记**：预加载脚本（`desktop/src/bun/preload.ts`）在页面脚本之前用 `Object.defineProperty(window, "__nbookDesktopFrame", {value: 1, writable: false, configurable: false, enumerable: false})` 声明窗口没有系统标题栏。
  - `<html>` 一出现，预加载就设 `data-desktop-frame`（它已有观察 `document` 的 MutationObserver）。
  - 它只是渲染能力信号，不是安全边界：插件完全信任（ADR 0022），页面里任何脚本本来就能发桥消息。
  - 普通浏览器里没有它，宿主什么都不画。

### 壳：`packages/neuro-book/desktop/src/bun/`

- **`index.ts` 的 `openManaged`**：
  - Windows 上，WebView2 版本不低于 123 时，产品窗口与启动页窗口用 `titleBarStyle: "hiddenInset"`，预加载带能力标记；创建后调 `adoptCustomFrame`，失败项写壳日志 `desktop.frame.adopt-failed`。
  - WebView2 低于 123（没有非客户区支持）时退回系统标题栏、不带标记，页面就回到现在的样子（两条标题栏）。版本从 `hasWebView2` 已经读到的注册表 `pv` 取。
  - 同一个窗口会从启动页换成产品页，所以样式在创建时定。
  - 对话框窗口（`openDialog`）保留系统标题栏。
- **`onWindowMessage`**：`window-control` 与 `window-state-query` 两种窗口都接（启动页也有按钮）。
  - `minimize` 调 `win.minimize()`。
  - `toggle-maximize` 按 `win.isMaximized()` 在最大化与还原之间切换。
  - `close` 调 `shell.windows.closeRequested(id)`，与系统的关闭同一条路：输出 14 的询问，输出 17 的启动页直接关。
- **`window-state` 的发送**：一个全局的 `resize` 监听按 `event.data.id` 查 `windows` 表，不给每个窗口注册（Electrobun 2.0.6 的 `win.on` 没有解绑）。
  - 收到 `resize`、`window-state-query` 时，按 `win.isMaximized()` 发。
  - 每个窗口记上一次发出的值，相同就不发；记录随窗口的 `close` 删除。
  - 页面换了文档时，记录清掉重发：`page-ready`、`shell-ready` 之前的查询都按“没发过”处理。
  - 去重与清理放在核心的小模块 `src/desktop/window-state.ts`（纯 TS，有单测），适配层只转交。
- **新文件 `win32.ts`**（已起草）：`adoptCustomFrame(hwnd, iconFile) → string[]`（没做成的项与原因）。
  - **补样式**：`GetWindowLongPtrW`、`SetWindowLongPtrW` 补三位，再 `SetWindowPos(SWP_FRAMECHANGED | SWP_ASYNCWINDOWPOS)`。
  - **图标**：`GetDpiForWindow` 加 `GetSystemMetricsForDpi(SM_CXICON 与 SM_CXSMICON)` 求大小两个尺寸，`LoadImageW` 从包里的 ICO 加载，`PostMessageW(WM_SETICON)` 交给窗口。
  - **句柄**：同一尺寸的图标所有窗口共用，进程结束前不销毁。尺寸数有上限（大小各一，再乘上见过的 DPI），不随开关窗增长；这是 `LoadImageW` 不带 `LR_SHARED` 时避免泄漏的做法。
  - **ABI**：`HWND`、`HICON` 用 `FFIType.ptr`，`LONG_PTR` 用 `i64`，`wParam` 用 `u64`；路径是以 null 结尾的 UTF-16LE 缓冲区，调用期间持有。`hwnd` 为空时不调用，交回原因。
  - **已知限制**：窗口换到 DPI 不同的显示器后，图标不重新按新 DPI 加载，系统会缩放已给的那一档。
  - `win32.ts` 只依赖 `bun:ffi`，纳入应用包的类型检查（`tsconfig.json` 的 `include` 加这一个文件）。
- **启动页 `src/views/shell/index.html`**：启动页模式下，顶上一条 36px 的拖动条（两种写法的 `app-region: drag`），右边三个按钮。
  - 按钮发 `window-control`。
  - 页面监听 `nbook-desktop` 事件里的 `window-state`，按 `maximized` 换字形与名字；脚本加载后先发一次 `window-state-query`。
  - 对话框模式不画：页面按 `render` 交来的 `kind` 区分。

### 页面宿主：`packages/neuro-book/src/web/`

命名用 `desktop-frame`：`window` 在 `host/window.ts`、`data-window-state` 里已经指窗口运行实例。

- **`host/desktop-frame.ts`**（不依赖 Vue，与 `close-ui.ts` 同形）：`createDesktopFrame({global, bridge, document, report})`。没有能力标记时，交回一个什么都不做、`state` 恒为空的对象。有标记时：
  - **`<html>` 上的属性与变量**：
    - 设 `data-desktop-frame`（预加载已设，这里再设一次，e2e 与真实路径一致）；
    - 变量 `--nb-window-controls-width`（3 × 46px）；
    - `--nb-window-frame-offset`：后备标题栏在时是 36px，否则是 0；
    - 按 `window-state` 设 `data-desktop-maximized`。
  - **页面有没有自己的标题栏**：在 `#app` 子树上观察 `[data-desktop-titlebar]`。回调用 `requestAnimationFrame` 合并；已找到、而且那个元素还连在文档上时直接返回。没有时设 `data-desktop-frame-bar`，由宿主画后备标题栏。
  - **文档标题**：观察 `<title>`。
  - **交回**：`state: Readonly<ShallowRef<{maximized, hasPageTitlebar, focused, title}>>` 与 `control(action)`。发送失败（`send` 返回 false）写诊断 `desktop.frame.send-failed`。
- **`DesktopFrame.vue` 与 `DesktopFrame.md`**：独立的 Vue 根。`boot.ts` 在关闭层之后挂到 `body` 下的 `[data-desktop-frame-root]`，不随宿主页与工作台切换卸载（同 `CloseLayer`）；状态经 prop 交入（`ShallowRef`），文字经 `useText()`（标签 `state:inject`）。不登记 Lab 场景：理由同 `CloseLayer`，它依赖宿主链，由 e2e 验收，`.md` 写明。它画两样东西。
  - **窗口按钮**：
    - 位置：固定在右上角，`role="group"` 加分组名；每个按钮 46×36，原生 `<button>`，`tabindex="-1"`（同系统按钮，不是 Tab 停靠点；键盘有 Alt+Space 与 Alt+F4）。
    - 为什么不用 nb-ui 的 `IconButton`：它有圆角与内边距，做不出贴边的系统按钮矩形。这条理由写进 `.md`。
    - 字形：最小化、最大化或还原（随 `maximized`），关闭；名字随之变，读屏不另播报。
    - 颜色按三级回退：主题变量 → 宿主页变量（`--host-loading-*`）→ 系统色。
      - 悬停底色：`color-mix(in srgb, currentColor 10%, transparent)`。
      - 关闭按钮悬停：Windows 的红 `#c42b1c` 配白色字形，对比度约 5.7:1；字面颜色的理由写进 `.md`。
      - 窗口不在前台：字形用次要文字色。
      - `@media (forced-colors: active)`：字形 `currentColor`，悬停底色用 `Highlight`。
    - 层级：在 nb-ui 的 `z-index.ts` 登记 `desktopFrame`，高于模态最高一层与 `commandPalette`、低于 `inspectorProbe`（Lab 的检查框要能检查它），补顺序断言。
    - 根 `pointer-events: auto`、`app-region: no-drag`。
  - **后备标题栏**（`data-desktop-frame-bar` 时）：顶上 36px，`app-region: drag`；左边图形标志（`NeuroBookMark`）与文档标题，右边留出按钮的宽度。底色依次取 `--shell-chrome-surface`、`--host-loading-background`、`Canvas`，同加载页一致。
- **关闭层的例外**（`host/close-ui.ts`、`CloseLayer`）：
  - `createCloseUi` 的 `ownRoot` 改为“不设 `inert` 的根”的列表，`boot.ts` 把外框根也交进去；
  - reka 模态在 `body` 上设 `pointer-events: none`，外框根自己写 `pointer-events: auto`；
  - `installCloseKeyGuard` 放行焦点在 `[data-desktop-frame-root]` 里的按键。
  结果：询问期间窗口照样能最小化、最大化、拖动；再点关闭交壳，壳按输出 14 出原生对话框。browser-host 输出 10 写明这个例外。
- **让位**：合同只靠一个变量与 `#app`，不挂在页面根的类名上。
  - 外框开启时（`html[data-desktop-frame]`），视口不滚动：
    - `html` 是 `overflow: hidden` 与 `scrollbar-gutter: auto`，这样窗口按钮贴住窗口右缘；
    - `#app` 是 `position: fixed; inset: var(--nb-window-frame-offset) 0 0 0; overflow: auto`。
  - 页面根的整屏高度改用 `var(--nb-viewport-block, 100dvh)`，外框开启时宿主把它设成 `100%`。用到它的是 `.nb-host-page`、`.nb-workbench-page` 与 Lab 的 `LabPage.vue`（它现在写 `h-screen`）。这一条写进 browser-host 新输出，作为页面的合同。
  - 普通浏览器里这些规则都不生效，版式与现在逐像素相同（e2e 的回归断言）。
  - `index.html` 的静态加载页 `.nb-host-loading`：起点取 `--nb-window-frame-offset`。外框开启时整块 `app-region: drag`：加载页阶段还没有 Vue 根，窗口至少能拖，关闭用 Alt+F4 与任务栏。
  - 离线横幅 `.nb-offline-banner`：外框开启时右端让出 `--nb-window-controls-width`，不盖住按钮。它不接受指针，盖住的标题栏照样能拖。
- **浮层不被当成拖动区**：外框开启时，`body > :not(#app):not([data-desktop-frame-root])` 一律 `app-region: no-drag`。经 Portal 挂到 `body` 下的浮层都在其中：对话框与遮罩、菜单、下拉、提示、浮动窗口、命令面板、通知。值会被后代继承，Chromium 按树序扣掉它们的矩形。模态开着时整个窗口不能拖，与系统模态对话框的效果相近，写进 Spec。

### 工作台标题栏：`plugins/workbench/web/components/WorkbenchTitleBar.vue`

- **声明自己画了标题栏**：根加 `data-desktop-titlebar`。它是宿主的合同（标题栏在窗口顶端、高 36px、右端留位、内部可交互部分 no-drag），与已有的 `data-workbench-titlebar`（工作台自己的钩子）不同，`WorkbenchTitleBar.md` 写明两者的关系。
- **拖动区域**：根写两种写法的 `app-region: drag`。no-drag 的部分另写在一个非 scoped 的 `<style>` 块里，选择器以 `[data-desktop-titlebar]` 起头。这样能命中 nb-ui `Menubar` 里 reka 渲染的触发器（scoped 选择器命不中子组件内部）。no-drag 的范围是“有点击或悬停行为的一切”：
  - `button`、`a[href]`、`input`、`select`、`textarea`；
  - `[role="menubar"]`、`[role="menuitem"]`、`[role="button"]`、`[tabindex]:not([tabindex="-1"])`；
  - `[data-workbench-item]`：无命令的条目也有悬停提示。
  普通浏览器里 `app-region` 不生效，不按“是不是桌面”分支。
- **右端留位**：放在右栏 `.workbench-titlebar__end` 的末尾（`padding-inline-end: var(--nb-window-controls-width, 0px)`），不放在根上，所以三栏网格仍然左右等分，两侧够宽时搜索在窗口正中。
  - `measuredWidths()` 把这个留位算进 `chrome`，并在宽度之外也 watch 它，逐级让位的算法不改。
  - 窗口窄到最省一档也放不下时，右端被裁的部分是已知限制：Electrobun 2.0.6 没有最小窗口尺寸的接口。e2e 量出起裁的宽度，写进 Spec。
- **双击与拖动**：标题栏空白处的双击最大化由系统做，组件不处理。
- **已打开的菜单**：点标题栏空白处会落在非客户区，页面收不到 `pointerdown`，菜单可能不关。Windows 验收时实测页面会不会收到 `blur`：会，就在 `blur` 时关掉菜单；不会，就记为已知限制。

### 应用图标（已提交）

- **开发者的决定**（2026-11-15，两次）：
  - 桌面图标不用 16、24 的像素专用版；
  - 问“为什么不用 SVG”，并说规范可以改。
- **做法**：ICO 里装不了 SVG，所以每个尺寸都从同一份 SVG 直接渲染。应用图标不按尺寸换版本，也不用像素专用版。桌面应用（Windows、macOS、Linux）与 favicon 用不带边框的那一份（开发者在 [对比图](artifacts/icon-variants/index.html) 上选的）；网页清单仍用带封面边框的。
- **已改的文件**：
  - `brand/logo/tools/produce.py` 与 `guidelines.py`，已重新生成；
  - Windows ICO 是 16–256 共七档；`favicon.ico` 的 16、32、48 同源；
  - 下游的 `src/web/public/favicon.ico` 与 `desktop/assets/neurobook.ico` 已同步；
  - `electrobun.config.ts` 的 `build.win.icon`、`build.copy`（复制到 `Resources/app/neurobook.ico`，供窗口图标与 t04 的托盘加载）；
  - `build-variant.ts` 的工程文件清单加了 `assets`，否则发布流水线的变体构建拿不到它。
- **不变的部分**：界面里 14–24px 的单色小标志不是应用图标，仍用像素专用版。

## Spec 与文档改动

- **`runtime/desktop-shell.md`**：
  - 非目标去掉“自定义标题栏”。
  - 输出 10 改写为“窗口与标题栏”：
    - Windows 上 WebView2 不低于 123 时没有系统标题栏，由页面画；
    - 补样式使最大化限在工作区，失败时窗口照常、记诊断；
    - 窗口图标是应用图标；
    - 旧 WebView2 退回系统标题栏；
    - `maximized` 的含义。
  - 输出 13 加上窗口按钮的三种消息。
  - 验收加场景 15“标题栏”：
    - 拖动、双击最大化与还原、贴边分屏；
    - 最大化不压任务栏；
    - 三个按钮；
    - 启动页也能拖、能关；
    - Alt+Space 系统菜单、Alt+F4；
    - 关闭询问期间能最小化；
    - 旧 WebView2 的退路。
  - 实现合同加“补样式”与线程方向。
- **`runtime/browser-host.md`**：
  - 输出 11 的“页面与壳之间只有两件事”改为三类（关闭、更新、窗口外框）。
  - 新输出“窗口外框”：
    - 能力标记；
    - 按钮与后备标题栏；
    - 页面声明自己的标题栏要满足的合同；
    - `--nb-viewport-block` 让位合同；
    - 浮层一律不是拖动区。
  - 输出 10 加上窗口按钮的例外。
  - 加验收场景。
- **`ui/workbench-shell.md` 输出 28**：桌面窗口里标题栏就是窗口的拖动区域，右栏末尾留出窗口按钮，窄到放不下时的已知限制。
- **组件与说明**：`desktop/README.md`（图标已写；加 WebView2 退路与升级 Electrobun 时复测补样式）；`DesktopFrame.md` 新建；`WorkbenchTitleBar.md` 的“布局”补拖动区域与留位；`CloseLayer.md` 写例外。
- **宿主目录**（中英）：
  - 新键 `desktopFrame.controls`（分组名）、`desktopFrame.minimize`、`desktopFrame.maximize`、`desktopFrame.restore`、`desktopFrame.close`。
  - 英文用 Windows 的原词：Minimize、Maximize、Restore Down、Close。

## 切片

1. **壳与约定**：
   - 内容：桥的三种消息与校验测试；`src/desktop/window-state.ts` 与单测；预加载的能力标记与 `data-desktop-frame`；`win32.ts` 定稿并纳入类型检查；`openManaged` 与 `onWindowMessage`；WebView2 版本的退路；启动页的拖动条与按钮。
   - 验证：`bun run test:affected --since master`、`bun run --cwd packages/neuro-book typecheck`、`bun desktop/scripts/build.ts`（主进程预打包）。
   - 提交。
2. **页面宿主与工作台标题栏**：
   - 内容：`desktop-frame.ts` 与测试；`DesktopFrame.vue` 与 DOM 测试；`boot.ts` 挂载与关闭层的例外；`styles.css`、`host-loading.css`、`index.html`、`LabPage.vue`；nb-ui `z-index.ts` 登记与顺序断言；宿主目录新键；`WorkbenchTitleBar` 的区域、留位与测量。e2e 新文件 `desktop-frame.e2e.ts`。
   - 提交。
3. **Spec 与 Windows 验收**：三份 Spec 与组件文档；Windows 开发机上用本分支的载荷重建安装包，按“验证”的 Windows 一节跑，证据写进 `evidences/`。提交。

## 验收映射

| Spec | 覆盖 |
|---|---|
| desktop-shell 输出 10、13 | `desktop-bridge.test.ts`（消息形状）、`window-state.test.ts`（去重与清理）；Windows 验收（样式、图标、命中、退路） |
| desktop-shell 场景 15 | Windows 开发机：Win32 查询与 UI 自动化；真实拖动由开发者操作 |
| browser-host 输出 10 的例外 | `desktop-frame.e2e.ts`（关闭层开着时按钮可用、消息交壳）、`close-ui` 的单测 |
| browser-host 新输出“窗口外框” | `desktop-frame.test.ts`、`DesktopFrame.dom.test.ts`、`desktop-frame.e2e.ts` |
| workbench-shell 输出 28 | `desktop-frame.e2e.ts`（拖动区域的计算样式、留位、居中）；DOM 测试只守属性与结构。计算样式只证明样式写对，真正的命中只有 Windows 验收能证明 |

## 验证

- **单元与 DOM**：`bun run test:affected --since master`；应用包与 nb-ui 的类型检查。
- **e2e**：
  - 新文件 `desktop-frame.e2e.ts`。`addInitScript` 模拟预加载：定义能力标记、设 `data-desktop-frame`、装一个记录 `__electrobunSendToHost` 的函数。断言：
    - 工作台页：
      - 标题栏里每个可聚焦元素与菜单触发器的 `-webkit-app-region` 计算值都是 `no-drag`，空白处是 `drag`（在完整菜单与 ≡ 两档宽度、有项目与无项目各一次）；
      - 1280、900、700 宽时，搜索中线与窗口中线之差在 1px 内，最右的条目不压窗口按钮，量出起裁宽度。
    - 书架首页、页面不存在、失败页（含长的抢救正文）：有后备标题栏，内容从 36px 处开始，没有视口滚动条，按钮贴住右缘。
    - 交互与状态：
      - 点按钮时记录到 `window-control`；
      - 派发 `window-state` 后，按钮名变“还原”、`data-desktop-maximized` 跟着变；
      - 外框一建立就有一条 `window-state-query`；
      - 关闭层开着时按钮可用。
    - 浮层与横幅：
      - 对话框、命令面板、浮动窗口的根计算值是 `no-drag`；
      - 离线横幅不盖住按钮。
    - 首页到工作台切换：`.nb-workbench-page` 的高度序列里不出现先短后长。
    - 不定义标记时：不画任何东西，`body`、`.nb-workbench-page` 的尺寸与现在相同。
  - 受影响的现有 e2e 一并跑：`bookshelf.e2e.ts`、`browser-host.e2e.ts`、`desktop-close.e2e.ts`、`rpc.e2e.ts`（离线横幅）。共 5 个文件。改动后只重跑覆盖改动的文件与失败项。
- **Windows（Windows 开发机）**：用本分支的载荷重建安装包，装进测试标识（`NBOOK_DESKTOP_IDENTIFIER`），用独立的状态根。
  - **Win32 查询**：
    - 命中测试：工作台标题栏空白处、书架后备标题栏、加载页是 `HTCAPTION`；按钮、菜单触发器、搜索、开着的对话框是 `HTCLIENT`。
    - 窗口：样式含三位；`WM_GETICON` 非 0；最大化后客户区等于工作区。
    - 线程：并发开窗与拖动时，壳没有卡住。
  - **UI 自动化**：
    - 三个按钮的名字；
    - Invoke 最小化（`IsIconic`）；
    - 最大化与还原：按钮名与 `IsZoomed` 一起变；
    - 关闭：有未保存的修改时出编辑器的询问；询问期间最小化可用；
    - 启动页的按钮。
  - **真实操作**：拖动、双击标题栏、拖到屏幕边缘贴边、Alt+Space、点标题栏空白处时开着的菜单。合成输入不可靠，也会动开发者的鼠标，所以请开发者在 Windows 开发机上试一次，结果记进证据；在那之前写“未验证”。
- **未验证边界**：
  - 多显示器与不同缩放比例下的最大化与按钮字形：只在 Windows 开发机 的单屏 100% 上测；
  - Windows 10：只测 Windows 11；
  - WebView2 低于 123 的退路：只按版本分支的单测与代码审查，没有旧版本的机器。

## 不做与风险

- **不做**：
  - Windows 11 悬停最大化按钮弹出的贴靠布局：要原生层对按钮回 `HTMAXBUTTON`，Win+Z 照常可用；
  - macOS、Linux；
  - 对话框窗口去掉标题栏；
  - 窗口不在前台时标题栏整体变淡：只让按钮字形变淡；
  - 全屏模式；
  - 页面缩放的反向补偿：标题栏与按钮随页面缩放同比变化，写进 `DesktopFrame.md`；
  - 换显示器后按新 DPI 重新加载图标。
- **风险：补样式依赖 Electrobun 的内部行为。** 它依赖 Electrobun 对 `hiddenInset` 的 `WM_NCCALCSIZE` 处理（去掉标题区）在加了 `WS_SYSMENU` 后不变。实测成立；升级 Electrobun 时复测，写进 `win32.ts` 的注释与 `desktop/README.md` 的升级检查。
- **风险：书架首页的首屏观感。** 书架首页上方是后备标题栏，再下面才是书架自己的页头，品牌重复出现。切片 2 之后给开发者看截图，记进待确认清单。
