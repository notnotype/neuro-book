# t13 计划：系统托盘与关掉最后一个窗口时的去向

## 目标

1. 设置“关掉最后一个窗口时”：缺省“退出 NeuroBook”（照旧），可改为“留在系统托盘”（服务继续运行，从托盘再打开）。
2. 缺省模式下，关最后一个窗口时若有工作在跑，提示里多一个“在后台继续”：窗口关掉、服务继续，NeuroBook 留在托盘。
3. 托盘图标与菜单：打开、退出。

合同改动：[`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md)（非目标里的“不在后台常驻”改掉；新增“后台与托盘”一组输出；状态表加“后台”；场景加一条）、[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 10 的“在跑的工作”（多一个选择、回答多一种）。

## 现状（读过的代码）

- `src/desktop/windows.ts` 的 `WindowCoordinator`：纯状态机。`#isLast(id)` = 自有服务端且没有别的存活窗口 → 原因 `quit`；`#commit(id, quit)` 里 `quit` 为真时 `#stopping` 并调 `onQuit`（壳停服务端、放锁、退出）；窗口都没了调 `onAllClosed`（壳在 `#allClosed` 里停服务端并退出，覆盖“没经最后一次关闭就关完”的三种情况）。`quitRequested()` 对每个没在问的窗口走 `closeRequested`。
- `src/desktop/shell.ts`：`#stopAndExit`、`#allClosed`；桌面专属设置的值经桥由页面交来（`desktop-settings` 消息），壳缓存在 `settings-cache.json`（`src/desktop/desktop-settings.ts`）。
- `desktop/src/bun/index.ts`：Electrobun 适配层，`exitOnLastWindowClosed: false`（窗口全关时框架不退，由壳决定），`before-quit` 一律否决后交协调器。
- 页面：`src/web/host/close-query.ts` 按“参与方 → 宿主页未保存正文 → `quit` 时在跑的工作”问，回答 `allow` / `deny`（`close-answer`）；提示由 `ClosePrompts.ask` 给，返回 `close` / `cancel`。在跑的工作取自 `GET /api/runtime/work`（`src/shared/running-work.ts`）。
- 桥的形状在 `src/shared/desktop-bridge.ts`（两边共用）。
- Electrobun 2.0.6 的 `Tray`（`package/src/sdks/main/core/Tray.ts` 与 Windows 的 `nativeWrapper.cpp`）：`Shell_NotifyIconW`；图标用 `LoadImageW(IMAGE_ICON, LR_LOADFROMFILE)`，只认 `.ico`，宽高由选项给；右键（与 `WM_CONTEXTMENU`）弹 `TrackPopupMenu`，选中项经 `tray-clicked` 事件交回 `action`；左键抬起也发 `tray-clicked`，`action` 为空串。`setVisible(false)` 删图标，`setVisible(true)` 重建。壳的界面文字只有中文（启动页、对话框），托盘照此。

## 行为（写进 Spec 的）

**设置**：`nbook.desktop` 加一项 `closeLastWindow`：`"quit"`（缺省）/ `"tray"`，标题“关掉最后一个窗口时”，选项“退出 NeuroBook”“留在系统托盘（服务继续运行）”；与缩放、开机自启同一分区、同一条值的路（页面交给壳、壳缓存）。

**后台**：壳有自有服务端、没有窗口、没有在停止时处在“后台”。连上的是别人的实例时没有后台：最后一个窗口关掉照旧退出（服务端不归壳，留着没有意义）。

**托盘图标**：模式是 `tray`，或此刻在后台，就显示；否则不显示（缺省用法看不到托盘图标）。提示文字“NeuroBook”，在后台时“NeuroBook（在后台运行）”。图标用随包的 `neurobook.ico`，按主显示器缩放比例要 16×缩放 的尺寸。建托盘失败只记诊断：这时不进后台（模式 `tray` 的最后一个窗口照 `quit` 处理），免得留下看不见、关不掉的进程。

**菜单**：“打开 NeuroBook”、分隔线、“退出 NeuroBook”。左键单击等于“打开”。

- 打开：有产品窗口时把最近获得焦点的那个置前（最小化的先还原）；没有时开一个新窗口（与开窗转交同一条路，地址是服务端首页）。停止中不响应。
- 退出：有窗口时等于应用级的退出请求（输出 19 的 `quitRequested`：各窗口各自询问，最后一个以 `quit`）。在后台（没有窗口）时，壳向自有服务端取在跑的工作（同一个 `GET /api/runtime/work`，8 秒）：没有工作就直接进入停止中；有工作、有取不到的或整个取不到时开一个窗口，页面就绪后对它发 `quit` 询问（提示照常列出工作；选“取消”时窗口留着）。

**关最后一个窗口**：

- 模式 `tray`：原因是 `window`（只问未保存的正文，不提示在跑的工作）；关掉后进入后台。
- 模式 `quit`：原因照旧是 `quit`；在跑的工作的提示多一个“在后台继续”，三个选择是“取消”（缺省）、“在后台继续”、“仍然关闭”。选“在后台继续”时页面回答 `background`：壳关掉窗口、不停服务端，进入后台。没有在跑的工作时不提示，照旧退出。
- `background` 只对 `quit` 询问有效；对 `window` 询问的 `background` 按 `allow` 处理（不会发生，防御）。

**后台时的其它事件**：开窗转交照常开窗（离开后台）；页面请求新窗口不会发生（没有页面）；自有服务端意外退出时照旧弹壳自己的对话框（不需要页面），选“稍后”后没有服务端可留，壳退出；系统或框架发来的应用退出请求（注销、关机）在后台时直接进入停止中，不询问（没有页面可问，在跑的工作按中断收口，与输出 22 的非合作结束相比仍是有序停止）；更新提示等到有窗口就绪再交。

## 设计

协调器（`windows.ts`，纯状态机，测试都在这里）：

- 新选项 `closeLastWindow(): "quit" | "tray"` 与 `trayAvailable(): boolean`（由壳给）。`#isLast` 改名为 `#quitsOnClose`：自有、没有别的存活窗口、并且（模式 `quit` 或托盘不可用）。
- `pageAnswered` 接受 `background`：是 `quit` 询问且仍是最后一个时 `#commit(id, false)`（不停）；其余按 `allow`。
- 窗口都关完时：自有服务端、没在停止、托盘可用 → 调新的 `onBackground()`，不调 `onAllClosed`；否则照旧。
- `openFromTray()`：停止中忽略；有窗口时返回要置前的窗口（最近焦点）交给 port 新方法 `focus(id)`；没有时 `openWindow()`。
- `quitFromTray()`：有窗口时 `quitRequested()`；没有时返回 `"check-work"` 由壳去取工作。壳取回之后调 `quitWithoutWindows()`（直接 `#stopping` + `onQuit`）或 `askQuitInNewWindow()`（开窗，记下“就绪后以 `quit` 询问”，在 `pageReady` 里发起；就绪前用户关它就是普通关闭）。
- `quitRequested()` 在没有窗口、自有服务端时直接进入停止中。

壳（`shell.ts`）：持有托盘状态（模式、在不在后台），算出“要不要显示、提示文字”交给 port 的 `setTray({visible, tooltip})`；`onBackground` 时把这次运行标成后台（日志一行），不停服务端；取工作用 `fetch(<serverUrl>/api/runtime/work)` 加 8 秒截止，形状用 `RunningWorkReportSchema` 校验，不合就当取不到。

适配层（`desktop/src/bun/index.ts`）：建 `Tray`（壳启动、拿到锁之后建一次，按 `setTray` 显示与隐藏，`tray-clicked` 按 `action` 分到 `openFromTray` / `quitFromTray`）；`focus(id)` 用 Electrobun 的窗口置前（最小化时先还原）。图标路径用应用包里的 `neurobook.ico`（构建时已复制，见 `electrobun.config.ts`，没有就加）。

页面：`close-query.ts` 的 `ClosePrompts.ask` 对 `work` 提示允许返回 `background`（只在 `quit` 询问里给这个选择）；`finish` 的回答多 `background`；桥的 `close-answer` 形状加这个值。提示的界面（宿主的关闭提示组件）加一个按钮，文案“在后台继续”，说明一句“窗口会关掉，服务继续运行，可以从系统托盘再打开”。设置项的声明在 `src/plugins/desktop/shared/contracts.ts`，值经 `DesktopSettingValuesSchema` 交给壳（加 `closeLastWindow`；缓存读到旧文件缺这一项时按缺省 `quit`）。

## 切片

1. Spec：desktop-shell（非目标、新的“后台与托盘”输出、状态表、场景 17）、browser-host 输出 10、设置项。提交到 master。
2. 设置项与桥：`contracts.ts` 加配置项与文字，`desktop-bridge.ts` 的设置值与 `close-answer` 加新值，`desktop-settings.ts` 的缓存兼容；测试：配置声明、缓存读旧文件、桥的校验。
3. 协调器：上面的状态机改动；`windows.test.ts` 按场景补：模式 `tray` 关最后一个进后台、`background` 回答、后台时开窗转交、托盘的打开与退出（有窗口、没窗口无工作、没窗口有工作开窗询问、询问前被关）、后台时的应用退出请求、托盘不可用时照旧退出、连别人实例时不进后台。
4. 壳与适配层：`shell.ts` 的托盘状态与取工作；`index.ts` 的 `Tray`；`shell.test.ts` 补托盘显示规则与取工作（取不到、形状不对、超时）。
5. 页面：`close-query.ts` 与提示组件；`close-query` 的单元测试与 e2e（桌面能力标记下的关窗询问已有 e2e，补“在后台继续”的回答）。
6. Windows 验收（要能在 pc-notype 上构建，现在被 Defender 挡着，见 t18）：托盘出现与消失、菜单、左键、在后台时再从开始菜单打开、托盘退出的三种情况、关机注销不在本 Task 实测（记为未实测）。

## 验证

- 单元：`bun test src/desktop/ src/web/host/close-query.test.ts`；类型检查；`bun run test:affected`。
- e2e：关窗询问相关的文件（`desktop-frame.e2e.ts` 与关闭前询问所在文件，实施时查准）。
- Windows：上面第 6 片，证据进 `evidences/`。

## 待确认（照推荐做，记进待确认清单）

- 托盘图标只在模式 `tray` 或在后台时显示（不常驻）。
- 缺省模式下“在后台继续”只出现在有工作在跑的提示里。
- 后台时注销、关机直接有序停止，不询问。
- 托盘菜单只有中文（与壳的其它文字一致）。

## 风险

- Electrobun 托盘在 Windows 上的实际表现（图标清晰度、菜单在多显示器上的位置、`SetForegroundWindow` 让菜单点外面能收起）没实测过；第 6 片之前先在 pc-notype 上做一个最小探针（只建托盘与菜单），不行就记下限制或换法。
- 在后台时 WebView2 已没有窗口，Electrobun 的消息循环仍要在（托盘的消息靠它）：`exitOnLastWindowClosed: false` 已经保证框架不退，探针一并确认。
