# t18 实施计划：桌面窗口第一轮试用反馈（r2）

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

工作方式：autonomous-delivery。设计审查第 1 轮（omp 13 条、Sonnet 13 条，处理见 [`evidences/design-review-r1-disposition.txt`](evidences/design-review-r1-disposition.txt)）后改为 r2：最小尺寸从消息钩子改成子类化窗口过程（探针证明钩子改不动），前端两片按 Sonnet 的意见补全。最小尺寸一片改动大，r2 只就这一片再请 omp 审一轮，前端两片先实施。

## 技术选型

- **窗口按钮与启动页的图标**：内联 SVG，用 lucide 的四个图形（minus、square、copy 作“还原”、x），`stroke="currentColor"`、描边 2（viewBox 24），渲染成 15px，与布局按钮的 lucide 图标同形同粗。不用 `i-lucide-*` 类：它是 `background-color: currentColor` 加遮罩，高对比度模式下背景色被强制成 Canvas，按钮会整个消失（设计审查 Sonnet 第 3 条）；启动页是静态 HTML，本来就只能内联，两处同一做法。不用 Windows 图标字体：字形和标题栏其它图标不是一套，正是这次的问题。
- **最小尺寸**：Electrobun 2.0.6 没有 `minWidth`/`minHeight`（上游 PR blackboardsh/electrobun#478 关闭未合入），它的 `WM_GETMINMAXINFO` 只处理 `WS_POPUP`。做法：用 `bun:ffi` 的 `cc`（Bun 内嵌的 TinyCC）运行时编译一个很短的 C 窗口过程，`library: ["user32"]` 直接链接 user32；`SetWindowLongPtrW(GWLP_WNDPROC)` 子类化产品窗口：先 `CallWindowProcW` 交给 Electrobun 原来的窗口过程，`WM_GETMINMAXINFO` 时再把 `ptMinTrackSize` 抬到最小值。原过程地址与最小尺寸存成窗口属性（`SetPropW`），没有跨线程共享的表，句柄值复用也碰不到旧记录（属性随窗口销毁）。探针证据 [`evidences/min-size-probe-r1.txt`](evidences/min-size-probe-r1.txt)：链接 user32 可行；消息钩子（计划 r1 的方案）改不动系统读的那份 `MINMAXINFO`，已否决；子类化后系统采用改过的值，发 `WM_GETMINMAXINFO` 读回 800×560。
  - 否决：消息钩子 `WH_CALLWNDPROCRET`/`WH_CALLWNDPROC`（实测改动无效）；在 `resize` 事件里发现太小再 `setSize` 回去（与系统的拖动循环打架，窗口抖；#382 里也这样说）；给 Electrobun 打原生补丁（要在 Windows 上用 Zig 与 MSVC 重建原生层，升级时每次重做）；在页面里加最小宽度（窗口照样能缩小，页面被裁）。

## 关键设计

### `packages/neuro-book/src/web/DesktopFrame.vue`、`styles.css`、`DesktopFrame.md`

- 三个按钮仍是原生 `<button>`：命中区要贴住窗口右上角（关闭按钮的命中区一直到窗口的右缘与上缘），`IconButton` 是定边长的方块。每个命中区 34×36；按钮里画一块与布局按钮（`IconButton` `sm`）同样大小的“芯”：26×26，圆角 `var(--radius-button-sm, 6px)`；芯之间因此是 8px。按钮组左边留 18px，中间一道与标题栏“项目切换与菜单之间”同款的短分隔线（16px 高、`--divider`），把窗口按钮与布局按钮分成两组。`--nb-window-controls-width` 从 138px 改成 120px（18 + 3 × 34，只在 `styles.css` 一处）。
- 状态与 `IconButton` 的 default 变体同一组值（组件里注明“与 nb-ui IconButton default 同步”）：静止图标 `--text-secondary`；指针在命中区内任何位置（不只芯上）芯的底色 `--text-main` 15%、图标 `--text-main`；按下 24% 并缩到 0.93；过渡时长与缓动取同样的 token；光标是指针。关闭：悬停芯是 Windows 的红 `#c42b1c` 配白色图标。颜色与圆角都写三级回退（主题变量 → 加载页变量 → 系统色或定值），外框在主题加载前就显示。`forced-colors` 下悬停芯用 `Highlight`、图标 `HighlightText`。
- 删掉“不在前台时字形变淡”：`data-focused`、它的样式，`host/desktop-frame.ts` 里的 `focused` 状态及其监听（只为它而存）。壳推送的消息形状不改。
- `desktop/src/views/shell/index.html`（启动页）：同样的尺寸、芯、分隔线与内联 SVG，颜色用 `CanvasText` 系（它没有主题）。最大化与还原两个 SVG 都放进按钮、按状态切 `hidden`，不再改 `textContent`（否则会冲掉 SVG）。

### `packages/neuro-book/src/plugins/projects/web/plugin.ts`、`welcome.ts`（回到书架命令与文件菜单）

- 新命令 `nbook.project.back-to-shelf`，标题“回到书架 / Back to Bookshelf”，参数 `{}`，`effect: "read"`（不改任何数据，只是离开当前页面），`expose: {agent: "never"}`（整页导航会打断 Agent 所在的窗口，同 `nbook.project.open`），`when` 无：工作台页（有没有作品都一样）执行它都是整页导航到 `/`，复用 `navigation.navigateDocument("/")`。离开时的未保存保护是编辑器插件的 `beforeunload`（`plugins/editor/web/plugin.ts`），“打开项目”与欢迎页原来的“回到书架”走的都是这条路（`shared/host.ts` 的 `WindowNavigation` 注释）；WebView2 里会不会弹出这个询问，列进 Windows 验收。在书架页上执行它是一次重新载入，不另加判断（命令面板里才能在书架页执行它，无害）。
- 文件菜单：`TITLEBAR_MENU_ITEMS` 加一项，`group: "file"`、`section: "1_open"`、`order: 1`（排在“打开项目”之后；同节同序时按 id 字典序，`back-to-shelf` 会排到前面）。
- 欢迎页的“回到书架”改为执行这条命令（与欢迎页其它动作同一个 `execute`），删掉 `WelcomeHostOptions.navigateDocument`、插件里的注入与测试替身。

### `packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue`、`WorkbenchTitleBar.vue`、`ShellChrome`（作品下拉与标志）

- 命令在不在、可不可用由 `ShellChrome` 读（它有随命令增减重算的 `version`；`CommandService.get`/`isEnabled` 本身不是响应式的，作品插件在 `onStartup` 才登记命令，晚于外壳挂载）：新增一个读取，返回“回到书架”的命令标题或 null。工作台只按命令 id 引用（`WorkbenchShell.vue` 已这样引用 `nbook.project.open`），不依赖作品插件的模块。命令不在目录里时作品下拉不列这一项、标志不是按钮，与菜单“命令不在目录里不显示”（workbench/menus 输出 1）一致。
- 作品下拉：有作品时是“打开项目…”与“回到书架”两项。没有作品时（`/workbench` 空工作台）项目切换仍是单个“打开项目…”按钮，回书架经标志与文件菜单。标题栏新增可选 prop（缺省没有书架）与事件 `back-to-shelf`，标题栏仍只发事件。
- 标志：横排标志与单独的图形标志包进同一个按钮（`aria-label` 与悬停提示取命令标题，`nb-ui-focus-ring`，是普通的 Tab 停靠点，排在项目切换之前）。按钮的外框就是原来标志的外框（外边距从标志挪到按钮上，标志自己不再带外边距），测量层的复本用同一个类包一层，让位的切换点不变。悬停与按下用标题栏其它按钮同向的反馈（芯底色），不改墨色。桌面窗口里按钮是 `no-drag`（全局规则已覆盖 `button`），标志这一块不再能拖窗口，记为接受的代价；按下后指针移动超过 4px 再松开不算点击，免得想拖窗口却回了书架。

### `packages/neuro-book/desktop/src/bun/win32.ts`、`min-size.c`、`index.ts`（最小尺寸）

- C 源 `desktop/src/bun/min-size.c`，随 `build.copy` 进包（`cc` 读文件路径；包里的路径按 ICO 的做法解析）。只支持 Windows x64（Electrobun 的 Windows 目标只有 x64）：`process.arch !== "x64"` 时不编译，记诊断。C 里用固定宽度类型声明 `MINMAXINFO`，`_Static_assert(sizeof(MINMAXINFO) == 40)`；声明 `CallWindowProcW`、`GetPropW`、`RemovePropW`、`GetDpiForWindow`、`GetWindowRect`、`GetClientRect`、`IsZoomed`，`library: ["user32"]` 链接。
- 窗口过程：`prev = GetPropW(hwnd, "nbook.wndproc")`；`r = CallWindowProcW(prev, …)`；`WM_GETMINMAXINFO` 且窗口不是最大化时：逻辑最小值从属性 `nbook.minsize`（宽高打包）取，DPI 取 `GetDpiForWindow`（为 0 时按 96），物理最小客户区 = 逻辑值 × DPI / 96 向上取整；外框差 = 窗口矩形 − 客户区矩形（两个查询都成功、差值非负才用，否则这次不改）；`ptMinTrackSize` 取它与原值中较大的。最大化时不改：最大化的窗口不能拖动改大小，还原后开始拖动时系统会再问一次。`WM_NCDESTROY` 时删掉两个属性。返回 `r`。
- `win32.ts` 新增 `setMinimumSize(hwnd, {width, height}): string[]`（问题列表，同 `adoptCustomFrame`）：第一次调用时编译（结果缓存在模块里，进程寿命内不释放：窗口过程一直在用）；窗口已有 `nbook.wndproc` 属性时只更新 `nbook.minsize`；否则先 `SetPropW` 存两个属性、再 `SetWindowLongPtrW(GWLP_WNDPROC)` 换上，返回的旧过程必须等于存的那个，不等时换回并报问题。`SetWindowLongPtrW` 换窗口过程不发消息，不违反文件头“跨线程不等待”的约定。
- `index.ts`：窗口成为产品窗口时登记 800×560：`openManaged` 直接开产品页时，以及启动页窗口经 `load(id, url)` 换成产品页时（`WindowCoordinator` 先开 `startup`、服务端就绪后同一个窗口加载产品页）；有没有系统标题栏都登记；启动页与对话框不登记。已登记的再登记只更新值。编译或子类化失败时写壳日志 `desktop.window.min-size-unavailable`（带原因），窗口照常可用。
- 初始尺寸：`centered()` 的结果不小于最小值（按工作区与最小值取：宽 = min(工作区宽, max(800, min(1280, 工作区宽 × 0.9)))，高同理）。程序化改尺寸不受最小跟踪尺寸限制（探针第 4 条），所以创建时就要够大；工作区比最小值还小时窗口就是工作区大小，接受。
- 常量 `MIN_PAGE_SIZE = {width: 800, height: 560}` 放在核心 `src/desktop/`（不依赖 Electrobun 的那一侧），`centered()` 与登记都用它。

## Spec 与文档改动

- `docs/specs/runtime/desktop-shell.md` 输出 10：加“产品窗口最小 800×560（CSS 像素，按窗口所在显示器的 DPI 换算；界面缩放不影响；只限制用户拖动改大小，打开时就不小于它）”；场景 15 加“拖不到比最小尺寸更小”；限制里写“工作区比最小尺寸小的显示器上窗口以工作区为准”。
- `docs/specs/runtime/browser-host.md` 输出 12（窗口外框）：窗口按钮的样子（与标题栏按钮同一套图标与芯、命中区 34×36、与布局按钮之间一道分隔、不随前台变淡）。
- `docs/specs/ui/workbench-shell.md` 输出 28：作品下拉加“回到书架”；无作品时项目切换是单个“打开项目…”按钮；标志可点回书架（命令不在时不可点），标志一块在桌面窗口里不能拖；删掉“桌面窗口没有最小尺寸”的已知限制，改成指向 desktop-shell 的最小尺寸。输出 29 的条目表加文件菜单的“回到书架”。
- `docs/specs/workbench/commands.md` 的“命令目录（项目）”：加 `nbook.project.back-to-shelf`，写明 `effect` 与 Agent 暴露的理由。
- `docs/specs/workbench/bookshelf.md` 输出 19：欢迎页的“回到书架”执行这条命令。
- `DesktopFrame.md`、`WorkbenchTitleBar.md`（作品下拉、标志按钮、Tab 顺序、不能拖）、`desktop/README.md`（`win32.ts` 与 `min-size.c` 两行；升级 Electrobun 时复测：上游有了 `minWidth` 就删掉子类化）。

## 切片

1. **窗口按钮**：`DesktopFrame.vue`、`styles.css`、`desktop-frame.ts`（删 `focused`）、启动页、`DesktopFrame.md`、Spec browser-host。验证：`DesktopFrame.dom.test.ts`、`e2e/desktop-frame.e2e.ts`（加 `forcedColors: "active"` 下按钮可见）；本机带能力标记的 Chrome 截图（亮色、深色、高对比度、界面缩放 125%）对照布局按钮。
2. **回到书架**：projects 插件命令与菜单、欢迎页改走命令（删 `navigateDocument` 选项）、`ShellChrome`、`WorkbenchShell.vue` 与 `WorkbenchTitleBar.vue`（标志按钮与测量层复本）、两个语言目录与 `projects/locales.test.ts`、Lab 的标题栏夹具（新 prop 与事件，加“没有书架”场景）、Spec commands、workbench-shell、bookshelf，组件文档。验证：`WorkbenchTitleBar.dom.test.ts`（命令在：下拉两项、标志是可聚焦按钮、拖动后松开不发事件；命令不在：没有这一项、标志不是按钮；无作品时单个按钮）、外壳的命令可用性测试（命令晚于外壳登记后出现、撤回后消失）、projects 的命令测试（登记、菜单顺序、执行即导航到 `/`）、`WelcomePage.dom.test.ts`、e2e `projects.e2e.ts` 加一条（工作台 → 作品下拉“回到书架” → 书架页；标志同；文件菜单同）与 `workbench-titlebar.e2e.ts`（让位切换点不变）。
3. **最小尺寸**：`min-size.c`、`win32.ts`、`index.ts`（`openManaged`、`load`、`centered`）、`electrobun.config.ts` 的 `build.copy`、核心常量与 `centered` 的纯函数测试、Spec desktop-shell、壳 README。验证：类型检查（`win32.ts` 在应用包的类型检查里）、`centered` 的单元测试；pc-notype 上的 Windows 验收（下文）。

每片单独提交。

## 验收映射

| Spec | 覆盖 |
|---|---|
| browser-host 输出 12（按钮样子与命中区） | `DesktopFrame.dom.test.ts`（按钮名与动作不变）、`desktop-frame.e2e.ts`（按钮贴右上角、右栏留出 120px、搜索仍居中、高对比度下可见）；样子靠截图对照 |
| workbench-shell 输出 28（作品下拉、标志） | `WorkbenchTitleBar.dom.test.ts`（命令在时有这一项与可点标志，不在时没有）、`projects.e2e.ts` 新增的回书架用例 |
| commands 项目目录 `nbook.project.back-to-shelf` | projects 插件的命令测试（登记、执行即导航到 `/`） |
| bookshelf 输出 19 / 场景 12（欢迎页回书架） | `WelcomePage.dom.test.ts` 与现有 e2e |
| desktop-shell 输出 10 最小尺寸 / 场景 15 | Windows 验收：验收脚本（另一个进程）对窗口发 `WM_GETMINMAXINFO`（跨进程由系统转送结构体）读 `ptMinTrackSize`：首个窗口（启动页转产品页）、新开的产品窗口都是 800×560 加外框；启动页阶段与对话框不是；最大化时不改、还原后又是；关掉再开仍是；打开时客户区不小于 800×560；壳日志没有 `min-size-unavailable`。真实拖动由开发者试 |

## 验证

- 单元与 DOM：上面列的文件。
- e2e（合入前跑一次）：`e2e/desktop-frame.e2e.ts`、`e2e/projects.e2e.ts`。之后改动只重跑覆盖改动的那一个。
- Windows（pc-notype）：Hutch dev 构建测试标识 t18test，独立状态根；Win32 查询经 `/it` 计划任务在桌面会话里跑，PrintWindow 只拍应用自己的窗口，不截屏幕区域，不动鼠标。验最小尺寸（上表）、按钮的样子（PrintWindow 对照）、启动页按钮（最大化后仍有图标）、关掉自动保存改一个文件后执行“回到书架”时 WebView2 是否弹出离开询问（不弹时记为与“打开项目”同样的既有缺口，另建 Task）。
- 未验证、交开发者：真实拖动窗口边缘到最小尺寸时的手感；按钮新样子是否满意。

## 不做与风险

- 不做：页面在改大小时的重排开销（t19）；WebView2 合成托管（上游）。
- 风险：TinyCC 编译的窗口过程若有错，会在 UI 线程里崩掉整个应用。兜底：只对登记的窗口换过程，过程里先原样交给原过程，只改 `WM_GETMINMAXINFO` 的一个字段；Windows 验收覆盖产品窗口、启动页、对话框、多窗口与关窗后再开；C 源码短到能逐行审。
- 风险：Electrobun 升级后自己处理了 `WM_GETMINMAXINFO`（例如合入 #478），或自己也子类化窗口。我们的过程在它之后取较大值，与它叠加不冲突；README 写明升级时复测，上游有接口就删掉子类化。
- 接受的代价：标志一块在桌面窗口里不能拖窗口（开发者要它可点）。
