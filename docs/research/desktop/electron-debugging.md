# Electron 桌面调试记录

这份文档记录 NeuroBook Desktop Envelope 在 Windows 上调试“源码已经修复，但实际 Portable 仍表现异常”这类问题的固定方法。它是调试参考，不是生产启动参数，也不替代 Task 143 的自动化和人工验收矩阵。

## 何时阅读和使用

遇到以下任一情况时，先同时检查源码和实际打包产物：

- 标题栏、拖动区、窗口按钮或主体布局与源码不一致。
- Portable 能启动但页面表现像旧版本，或重打包后行为没有变化。
- 需要判断问题发生在 Electron main/preload、渲染页面，还是 Product loopback。

先确认运行的是本次构建生成的包，记录包目录、构建时间、manifest/source identity 和日志位置。不要把正在运行的 dev server 当作打包产物验证；dev server 只能证明开发页面，不证明 Portable 内的 HTML/CSS/JS 已更新。

## 已打包 Electron 的 CDP 诊断

Task 145 的 Manager GUI 与主应用共用同一个 Electron executable。调试向导时使用
`NeuroBook-Electron.exe --manager-gui --remote-debugging-port=<port>`；它加载
`manager.html`，通过 `manager-preload.cjs` 调用 Manager CLI，不会加载 Product origin。
因此 Manager GUI 的 CDP target 与主应用 target 必须分开记录，不能把向导页面的可见结果当成
Product/Workbench 验收。

CDP（Chrome DevTools Protocol）适合附加到已经运行的 Portable，不需要改业务代码。

1. 在隔离的临时根启动打包后的 Electron，并只绑定 loopback 调试端口：

   ```powershell
   <portable-root>\<envelope-executable>.exe --remote-debugging-port=9224
   ```

   调试完成后关闭进程。端口不能进入生产 launcher、安装 manifest 或用户可配置的长期参数。

2. 查询页面 target：

   ```text
   http://127.0.0.1:9224/json/list
   ```

   选择 `type=page` 的 target，使用返回的 `webSocketDebuggerUrl` 建立 WebSocket。

3. 发送 `Runtime.evaluate` 检查实际 DOM 和计算样式，例如：

   ```js
   ({
     titleBar: document.querySelector('.desktop-title-bar')?.getBoundingClientRect().toJSON(),
     pageRoot: document.querySelector('.novel-ide-page')?.getBoundingClientRect().toJSON(),
     titleBarPosition: getComputedStyle(document.querySelector('.desktop-title-bar')).position,
     body: {
       innerHeight: window.innerHeight,
       clientHeight: document.documentElement.clientHeight,
       scrollHeight: document.documentElement.scrollHeight,
     },
   })
   ```

4. 发送 `Page.captureScreenshot` 保存证据到 `.agent/tmp/<test-name>-<uuid>/`。同时保存 `/json/list`、评估结果、Electron stdout/stderr 和退出码。

标题栏布局的最小通过条件是：

- 标题栏 `rect.y === 0` 且高度为 36px。
- 桌面页面根节点从 `y === 36` 开始。
- 页面根节点不与标题栏重叠。
- `scrollHeight` 的额外增长符合页面自身内容，而不是标题栏重复占位。

CDP 只证明渲染层的几何和计算样式，不证明 Windows 原生拖动已经命中。做 OS 级拖动前必须先把目标窗口激活；如果窗口没有获得前台焦点，SendInput/鼠标探针会保持窗口位置不变，这不能归因于 `-webkit-app-region`。激活测试还要保证隔离的 `LOCALAPPDATA` 位于 Portable 根之外，否则 Manager 会因“用户级 lease 不能位于 Installation Root 内”拒绝启动。

本次问题的根因是：运行中的 Portable 仍带有旧的 `.desktop-title-bar { position: fixed; }` 和 `.desktop-page-shell { padding-top: 36px; }`，而源码已经改为文档流布局并删除了旧的顶部 padding。也就是说，现象来自源码与运行包不一致，不是被其他窗口覆盖；重新构建并替换产物后 Electron 已恢复拖动。

## Playwright 与 CDP 的分工

- Playwright Electron API（`_electron.launch()`、`firstWindow()`、locator、截图和 console 监听）用于可重复的 UI smoke。它适合验证启动页、标题栏菜单、设置页、缩放和页面交互。
- 原始 CDP 用于附加到已经启动的真实 Portable，特别适合确认“打包后到底加载了哪份 CSS/JS”以及采集几何尺寸。
- 两者都不能单独证明系统托盘、原生菜单、文件对话框、快捷方式、真实窗口移动/吸附或安装卸载行为。上述项目需要 Windows UI Automation 或用户授权的可见验收。

原生线的可重复脚本是 `scripts/deploy/electron-native-acceptance.ts`（`bun run desktop:native-acceptance`）。它启动真实 Electron main，调用真实 `BrowserWindow.maximize()/unmaximize()`，从 Desktop 日志读取托盘图标是否为空，并通过已有封面入口检查 `input[type=file]` 与 `filechooser` 事件。`filechooser` 事件只能证明渲染器触发了文件选择请求；Windows 文件选择器的可见目录、过滤器、取消/选择结果仍要用 Windows UI automation 观察，不能把事件当成“已选文件”。

## Manager GUI 与最终 Portable

Task 145 起，Manager GUI 与主应用共用同一个 Electron Runtime。验证 Manager 时对最终 Portable 启动：

```powershell
<portable-root>\desktop\NeuroBook-Electron.exe --manager-gui --remote-debugging-port=9225
```

它的 target URL 应为 `file:///.../desktop/resources/app.asar/manager.html`；页面应能看到安装范围和 Provider 类型 `<select>`。Provider 离线测试允许返回 warning，但测试后 API Key 输入框必须为空，不能出现在 stdout、NDJSON 或日志中。关闭 Manager GUI 后再启动主应用使用不同 CDP 端口，避免把两个入口的窗口误判为同一个页面。

最终 Portable 的检查顺序固定为：先读取 `manifest.json` 和 `product.imageId`，再用 CDP 检查标题栏/页面几何，最后关闭窗口并确认 Electron、Product、loopback 端口和 State Root 句柄均已收口。安装回归应额外检查 `%LOCALAPPDATA%/Programs/NeuroBook`、用户级 State/Cache/Desktop roots、开始菜单/桌面快捷方式和 `HKCU` 注册项；全局安装必须在提升权限环境单独执行，非提升环境只能作为 fail-closed 证据。

### Machine-scope UAC 验收

Manager GUI 的 machine-scope 操作由一次性 UAC Broker 转交同一个 Manager CLI。CDP 只能填写 Depot、选择安装范围并读取 Manager 的 NDJSON 阶段；UAC 同意/取消、Program Files 写入、HKLM 注册和公共快捷方式属于 Windows 原生权限边界，不能用 Renderer JavaScript 代替。

验收时分别记录三条结果：

- UAC 取消或提升进程未连接：GUI 必须收到 `uac-cancelled`，不应创建 `Program Files/NeuroBook`、HKLM 项、公共快捷方式或 staging；
- UAC 允许：安装、修复和卸载阶段必须仍由 Broker 调用 Manager CLI，控制管道使用 `operationId/nonce`，密码（如启用 auth）只走独立 secret 管道后写入 CLI stdin；
- Broker/pipe 中断：GUI 显示失败并回收临时 pipe，State Root 按卸载合同保留。

不要把 UAC 提示截图或系统事件当成 Manager 成功；必须继续检查安装 manifest、receipt、注册项、State/Cache/Desktop Root 和进程树。密码不得写入 CDP trace、截图、命令行、环境变量、NDJSON 或普通日志。

测试和诊断脚本都应使用隔离临时根，并清理子进程、调试端口和临时文件。不要为了让 smoke 通过而关闭 `contextIsolation`、sandbox、CSP 或 origin 校验。

## 共享 Workbench Chrome smoke

标题栏和 Activity Bar 属于 Vue 页面，不应等到重新组装完整 Portable 才发现回归。先启动隔离 Source Dev，再用普通 Edge/Chrome 注入 mock Desktop Bridge v2：

```powershell
node --import tsx scripts/deploy/desktop-workbench-browser-smoke.ts `
  --url http://127.0.0.1:<port> `
  --browser-executable 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  --evidence-dir .agent/tmp/<test-name>-<uuid>/evidence
```

加入 `--headed` 可执行可见复核。这个 smoke 同时创建不带 Bridge 的浏览器 context，因此能在一次运行中证明：

- Desktop 只有一个 36px 标题栏，页面和 Activity Bar 从 `y=36` 开始；
- B/S 没有标题栏、Desktop shell 或 36px 顶部空白；
- Activity Bar、菜单折叠、键盘焦点、书架 Settings、Inline Session 和 Agent/IDE 切换仍可用。

通过 `context.addInitScript()` 注入 mock 时，不要把经 `tsx` 转换后的 TypeScript 函数直接交给 Playwright 序列化。`tsx` 可能在函数源码中插入浏览器不存在的 `__name` helper，表现为 init script 静默失败、`window.neuroBookDesktop` 为 `undefined`。当前脚本使用不依赖构建期闭包的纯浏览器 JavaScript `content`，并在几何断言前显式检查 Bridge v2。

模式切换的 fallback 动画会临时克隆 IDE 纸面，克隆节点位于 `.mode-transition-paper` 且不可交互。自动化来回切换时应等待该快照 detached，并等待 `data-workbench-layout-mode` 达到目标状态；不要把 420ms 内的动画快照误报为两个正式 Prompt Bar。

## 完成标准

一次桌面 UI 调试至少应留下：

- 运行包路径和 source/image identity。
- CDP target、DOM geometry、computed style 和截图（如涉及视觉问题）。
- 复现命令、日志路径、退出码及是否清理了 Electron/Product/端口。
- 对应的 Playwright 或合同测试结果；未覆盖的原生 OS 行为明确列为未验证。
