# t18 实施计划：桌面窗口第一轮试用反馈

## Context

开发者 2026-11-16 在 Windows 上试了 t03、t04 的测试版，提了四条：

1. 右上角三个窗口按钮位置不对，样式、大小与标题栏不匹配；
2. 没有回到书架的入口；
3. 最小宽高太小；
4. 拖动改窗口大小不够流畅。

前三条是本 Task。第 4 条页面那一层单独在 t19 做（要改布局包 nb-layout）；WebView2 窗口式托管的闪白要 Electrobun 改用合成托管，壳里改不了（上游 issue blackboardsh/electrobun#484 还开着），不在本 Work 里做。

开发者当场定的（2026-11-16）：

- 窗口按钮三项都选了：和标题栏图标不统一、太大太高、位置偏了。pc-notype 上用 PrintWindow 拍了测试版窗口（只拍这个窗口自己）：几何是对的，按钮贴着客户区右上角，与标题栏中线对齐。偏的感觉来自字形：Windows 图标字体的 10px 细线，窗口不在前台时更淡；旁边布局按钮是 15px 的线条图标、圆角浅灰底。46×36 的直角大块悬停底色也和标题栏里的其它按钮不是一路。
- 最小尺寸 800×560（界面缩放 100% 的 CSS 像素，按窗口所在显示器的 DPI 换算）。
- 回到书架的入口：标题栏的作品下拉、文件菜单、标题栏左上角的标志，三处都要。

依据：[`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 的“窗口外框”（输出 10–12）、[`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 10 与场景 15、[`ui/workbench-shell`](../../../../../docs/specs/ui/workbench-shell.md) 输出 28、[`workbench/bookshelf`](../../../../../docs/specs/workbench/bookshelf.md) 输出 19、[`workbench/commands`](../../../../../docs/specs/workbench/commands.md) 的“命令目录（项目）”。

工作方式：autonomous-delivery。计划先做设计审查（阻塞）：前端两片派 Sonnet，最小尺寸（原生钩子）与整份计划派 omp。

## 技术选型

- **窗口按钮的图标**：用应用已有的 lucide 图标类（`i-lucide-minus`、`i-lucide-square`、`i-lucide-copy`、`i-lucide-x`），与布局按钮同一条图标管线；外框挂在 `boot.ts` 导入样式入口之后，图标类可用。不用 Windows 图标字体：字形和标题栏其它图标不是一套，正是这次的问题。壳的启动页是静态 HTML，没有图标管线，内联同样四个 lucide 图形的 SVG。
- **最小尺寸**：Electrobun 2.0.6 没有 `minWidth`/`minHeight`（上游 PR blackboardsh/electrobun#478 关闭未合入）；它的 `WM_GETMINMAXINFO` 只处理 `WS_POPUP` 窗口。窗口过程在 Electrobun 的原生 UI 线程，Bun 代码在另一条线程，`JSCallback` 不能同步改 `MINMAXINFO`。做法：用 `bun:ffi` 的 `cc`（Bun 内嵌的 TinyCC）在运行时编译一个约 40 行的 C 钩子过程，`SetWindowsHookExW(WH_CALLWNDPROCRET, 钩子, NULL, UI 线程 id)` 挂在 UI 线程上：窗口过程处理完 `WM_GETMINMAXINFO`、系统读取结果之前，钩子把登记过的窗口的 `ptMinTrackSize` 抬到最小值。整个过程在 C 里，不回到 JS。已在 pc-notype 上实测：安装包自带的 Bun 1.4.4 能用 `cc` 编译并调用。
  - 否决：在 `resize` 事件里发现太小再 `setSize` 回去（与系统的拖动循环打架，窗口抖、闪；#382 里也这样说）；给 Electrobun 打原生补丁（要在 Windows 上用 Zig 与 MSVC 重建原生层，升级时每次重做）；在页面里加最小宽度（窗口照样能缩小，页面被裁）。

## 关键设计

### `packages/neuro-book/src/web/DesktopFrame.vue`、`styles.css`、`DesktopFrame.md`

- 三个按钮仍是原生 `<button>`（理由不变：按钮命中区要贴住窗口右上角，`IconButton` 是定边长的方块），每个命中区 40×36，`--nb-window-controls-width` 从 138px 改成 120px（只在 `styles.css` 一处）。按钮里画一块与 `IconButton` `sm` 同样的“芯”：26px 高、32px 宽，圆角 `--radius-button-sm`；图标 15px（`IconButton` `sm` 的 1.25em × 12px），颜色 `--text-secondary`；悬停芯的底色 `--text-main` 15%、图标 `--text-main`，按下 24%，与 `IconButton` 的 ghost 同一组值。关闭悬停：芯是 Windows 的红 `#c42b1c` 配白色图标。命中区比芯大：鼠标甩到屏幕角落仍点得到关闭（Fitts），但看起来和标题栏里的按钮是一套。
- 去掉“不在前台时字形变淡”（`data-focused` 与它的样式）：标题栏里别的图标都不随前台变化，只有这三个变淡，正是“不统一”的一部分。`state.focused` 若只为它而存，一并删掉（`host/desktop-frame.ts` 与壳推送的字段按实际用处决定，壳的消息形状不改）。
- 颜色仍按三级回退（主题变量 → 加载页变量 → 系统色）；`forced-colors` 下悬停用 `Highlight`。
- `desktop/src/views/shell/index.html`（启动页）：同样的尺寸、芯与内联 SVG，颜色用 `CanvasText` 系（它没有主题）。

### `packages/neuro-book/src/plugins/projects/web/plugin.ts`（回到书架命令与文件菜单）

- 新命令 `nbook.project.back-to-shelf`，标题“回到书架 / Back to Bookshelf”，参数 `{}`，`effect: "read"`，`expose: {agent: "never"}`（整页导航会打断 Agent 所在的窗口，同 `nbook.project.open`），`when` 无：工作台页（有没有作品都一样）执行它都是整页导航到 `/`，与欢迎页的“回到书架”（`welcome.ts` 的 `onShelf`）同一个动作，复用 `navigation.navigateDocument("/")`。离开页面前的未保存询问走整页导航已有的那条路，与“打开项目”切换作品相同。
- 文件菜单：`TITLEBAR_MENU_ITEMS` 加一项，`group: "file"`、`section: "1_open"`、排在“打开项目”之后。
- 欢迎页的“回到书架”改为执行这条命令，不再各写一遍导航。

### `packages/neuro-book/src/plugins/workbench/web/components/WorkbenchTitleBar.vue`、`WorkbenchShell.vue`（作品下拉与标志）

- 作品下拉：有作品时是“打开项目…”与“回到书架”两项。工作台不认识书架插件，按命令 id 引用（`WorkbenchShell.vue` 已经这样引用 `nbook.project.open`）：命令表里没有这条命令或它不可用时不列这一项（书架插件没装的工作台没有书架可回）。下拉里的条目由 `WorkbenchShell` 按命令表算好交给标题栏（标题栏仍只发事件），新增事件 `back-to-shelf`。
- 标志：横排标志与单独的图形标志包成一个按钮（`aria-label` “回到书架”、悬停提示同名），点了执行同一条命令；命令不在时标志照旧是不可点的图案。按钮自然是 `no-drag`（标题栏的全局规则已覆盖 `button`）。样子不变：不加底色、不加边框，悬停只把光标变成指针、标志墨色从正文色变为次要色，免得标题栏左端多出一个显眼的按钮。测量层的复本不变。

### `packages/neuro-book/desktop/src/bun/win32.ts`、`index.ts`（最小尺寸）

- `win32.ts` 新增 `setMinimumSize(hwnd, {width, height}): string[]`（返回问题列表，与 `adoptCustomFrame` 同一约定）与 `forgetMinimumSize(hwnd)`。
- 第一次调用时编译钩子（结果缓存在模块里，不释放：钩子在进程寿命内一直挂着）。C 源码以字符串放在 `win32.ts` 旁的 `min-size-hook.c`，随 `build.copy` 进包（`cc` 读文件路径；包里的路径用 `PATHS` 解析，同 ICO 的做法）。C 里不 `#include` 系统头、不链接 user32：`CallNextHookEx`、`GetDpiForWindow`、`GetWindowRect`、`GetClientRect` 的函数指针由 JS 从 `dlopen("user32.dll")` 取得后经初始化函数交给 C（Bun 内嵌的 TinyCC 在 Windows 上带不带导入库没有保证）。结构体 `CWPRETSTRUCT`、`MINMAXINFO` 按 x64 布局在 C 里自己声明，旁边注明偏移。
- C 侧：最多 64 个槽的表（HWND、最小客户区宽高，逻辑像素）；登记先写宽高再写 HWND，钩子按 HWND 找槽。钩子过程只处理 `message == WM_GETMINMAXINFO` 且 HWND 在表里：最小窗口尺寸 = 最小客户区 × DPI / 96 + 此刻的（窗口矩形 − 客户区矩形），取它与系统给的值中较大的写回 `ptMinTrackSize`；其余一律 `CallNextHookEx`。
- 挂钩：`GetWindowThreadProcessId(hwnd)` 得到 UI 线程 id，`SetWindowsHookExW(WH_CALLWNDPROCRET = 12, 钩子, NULL, 线程 id)` 只挂一次（所有窗口在同一条 UI 线程；若线程 id 与已挂的不同，再挂一个）。这个调用不跨线程等待，不违反文件头的线程约定。
- 登记之后让窗口立刻按最小尺寸收一次：不需要，初始 1280×800 已大于最小值；比最小值小的显示器上（工作区不足 800×560）系统的最大化与拖动照常，窗口可能超出工作区，这是接受的边界。
- `index.ts`：所有产品窗口（`kind === "page"`，有没有系统标题栏都算）在 `adoptWindow` 里登记 800×560；启动页与对话框不登记。窗口关闭时 `forgetMinimumSize`。编译或挂钩失败时写壳日志 `desktop.window.min-size-unavailable`（带原因），窗口照常可用。
- 常量 `MIN_PAGE_SIZE = {width: 800, height: 560}` 放在核心 `src/desktop/`（不依赖 Electrobun 的那一侧），Spec 引用它的值。

## Spec 与文档改动

- `docs/specs/runtime/desktop-shell.md` 输出 10：加“产品窗口最小 800×560（CSS 像素，按显示器 DPI 换算；界面缩放不影响）”；场景 15 加“缩不到比最小尺寸更小”；限制里写“工作区比最小尺寸小的显示器上窗口可能超出工作区”。
- `docs/specs/runtime/browser-host.md` 输出 10–11：窗口按钮的样子（与标题栏按钮同一套图标、命中区 40×36、不随前台变淡）。
- `docs/specs/ui/workbench-shell.md` 输出 28：作品下拉加“回到书架”；标志可点回书架；删掉“桌面窗口没有最小尺寸”的已知限制，改成指向 desktop-shell 的最小尺寸。
- `docs/specs/workbench/commands.md` 的“命令目录（项目）”：加 `nbook.project.back-to-shelf`。
- `docs/specs/workbench/bookshelf.md` 输出 19：欢迎页的“回到书架”执行这条命令。
- `DesktopFrame.md`、`WorkbenchTitleBar.md`（作品下拉、标志按钮）、`desktop/README.md`（`win32.ts` 一行、升级 Electrobun 时复测最小尺寸：若上游有了 `minWidth`，删掉钩子）。

## 切片

1. **窗口按钮**：`DesktopFrame.vue`、`styles.css`、`desktop-frame.ts`（若删 `focused`）、启动页、`DesktopFrame.md`、Spec browser-host。验证：`bun run test:bun -- src/web/DesktopFrame.dom.test.ts`，`e2e/desktop-frame.e2e.ts`；本机带能力标记的 Chrome 截图对照布局按钮。
2. **回到书架**：projects 插件命令与菜单、欢迎页改走命令、`WorkbenchShell.vue` 与 `WorkbenchTitleBar.vue`、语言目录、Spec commands、workbench-shell、bookshelf，组件文档。验证：`WorkbenchTitleBar.dom.test.ts`、projects 的命令测试与 `WelcomePage.dom.test.ts`、e2e `projects.e2e.ts` 里加一条（工作台 → 作品下拉“回到书架” → 书架页；标志同）。
3. **最小尺寸**：`min-size-hook.c`、`win32.ts`、`index.ts`、`electrobun.config.ts` 的 `build.copy`、核心常量、Spec desktop-shell、壳 README。验证：类型检查（`win32.ts` 在应用包的类型检查里）；pc-notype 上的 Windows 验收（下文）。

每片单独提交。

## 验收映射

| Spec | 覆盖 |
|---|---|
| browser-host 输出 10–11（按钮样子与命中区） | `DesktopFrame.dom.test.ts`（按钮名与动作不变）、`desktop-frame.e2e.ts`（按钮贴右上角、右栏留出 120px、搜索仍居中）；样子靠截图对照 |
| workbench-shell 输出 28（作品下拉、标志） | `WorkbenchTitleBar.dom.test.ts`（命令在时有这一项与可点标志，不在时没有）、`projects.e2e.ts` 新增的回书架用例 |
| commands 项目目录 `nbook.project.back-to-shelf` | projects 插件的命令测试（登记、执行即导航到 `/`） |
| bookshelf 输出 19 / 场景 12（欢迎页回书架） | `WelcomePage.dom.test.ts` 与现有 e2e |
| desktop-shell 输出 10 最小尺寸 / 场景 15 | Windows 验收：`SetWindowPos` 缩到 300×200，窗口停在最小尺寸（DefWindowProc 处理 `WM_WINDOWPOSCHANGING` 时按 `WM_GETMINMAXINFO` 限制）；最大化与还原照常；启动页与对话框不受限；两个窗口都受限；关掉一个再开一个仍受限。真实拖动由开发者试 |

## 验证

- 单元与 DOM：上面列的文件。
- e2e（合入前跑一次）：`e2e/desktop-frame.e2e.ts`、`e2e/projects.e2e.ts`。之后改动只重跑覆盖改动的那一个。
- Windows（pc-notype）：Hutch dev 构建测试标识 t18test，独立状态根；Win32 查询经 `/it` 计划任务在桌面会话里跑，PrintWindow 只拍应用自己的窗口，不截屏幕区域，不动鼠标。验最小尺寸（上表）、按钮的样子（PrintWindow 对照）、启动页按钮。
- 未验证、交开发者：真实拖动窗口边缘到最小尺寸时的手感；按钮新样子是否满意。

## 不做与风险

- 不做：页面在改大小时的重排开销（t19）；WebView2 合成托管（上游）。
- 风险：TinyCC 编译的钩子若有错，会在 UI 线程里崩掉整个应用。兜底：钩子只读写登记过的 HWND 的 `MINMAXINFO`，其余原样交下去；Windows 验收覆盖产品窗口、启动页、对话框、多窗口与关窗后再开；C 源码短到能逐行审。
- 风险：Electrobun 升级后自己处理了 `WM_GETMINMAXINFO`（例如合入 #478）。钩子在窗口过程之后取较大值，与它叠加也不冲突；README 写明届时删掉钩子。
