# t13 计划：系统托盘与关掉最后一个窗口时的去向（r2）

r1 经 Opus 设计审查 18 条（1 阻塞、11 应改、6 可选），全部成立，处理见 [evidences/design-review-r1-disposition.txt](evidences/design-review-r1-disposition.txt)；r2 按它改写。

## 目标

1. 设置“关掉最后一个窗口时”：缺省“退出 NeuroBook”（照旧），可改为“留在系统托盘”（服务继续运行）。
2. 缺省模式下，关最后一个窗口时有工作在跑，提示里多一个“工作完成后退出”：窗口关掉、服务继续，工作都结束后 NeuroBook 自己有序退出。
3. 托盘图标与菜单：打开、退出。

合同改动见“切片 1”的逐处清单。

## 现状（读过的代码与 Electrobun 2.0.6）

- `src/desktop/windows.ts` 的 `WindowCoordinator`：纯状态机。`#isLast(id)`（自有、没有别的存活窗口）决定原因 `quit`；`pageAnswered` 提交时重判（`window` 同意而此刻已是最后一个就以 `quit` 重问）；`#commit(id, true)` 进入停止中并调 `onQuit`；窗口都没了调 `onAllClosed`；`quitRequested()` 对每个没在问的窗口走 `closeRequested`；`serverAbandoned()` 只把 `#ownsServer` 置 false。
- `src/desktop/shell.ts`：`#stopAndExit`、`#allClosed`（停服务端、放锁、退出）；开窗转交由锁的回调直接调协调器。
- `src/desktop/desktop-settings.ts`：设置值缓存，整份 `Value.Check`（`DesktopSettingValuesSchema` 各项必填、`additionalProperties: false`）；`sameDesktopSettings` 只比缩放与开机自启。
- `desktop/src/bun/index.ts`：`exitOnLastWindowClosed: false`；`before-quit` 一律否决交协调器；`exit` 直接 `Utils.quit`。
- 页面 `src/web/host/close-query.ts`：参与方 → 宿主页未保存正文 → `quit` 时在跑的工作；`finish(allow)` 保留“正在关闭”层（`heldAfterAllow`，10 秒未关撤层），`deny` 撤层；提示 `ClosePrompts.ask` 返回 `close | cancel`。桥 `close-query` 只有 `generation`、`reason`。
- Electrobun 2.0.6 托盘（`Tray.ts`、`nativeWrapper.cpp` 的 `TrayWindowProc`）：`Shell_NotifyIconW`；图标 `LoadImageW(IMAGE_ICON, LR_LOADFROMFILE)` 只认 `.ico`（`neurobook.ico` 已随包复制）；设了菜单时**左右键都弹同一个菜单**（`WM_LBUTTONUP` 落到 `WM_RBUTTONUP`），选中项经 `tray-clicked` 交回 `action`；没有 `NIM_SETVERSION`（键盘操作不来）；`setVisible(false)` 删图标、`setVisible(true)` 重新 `NIM_ADD`，可能失败（`visible` 读回 false）；托盘窗口是 message-only，不处理 `TaskbarCreated`（Explorer 重启后图标不回来）；退出路径不删图标（会留幽灵图标）。注销、关机只经控制台处理函数，GUI 进程收不到，没有 `WM_QUERYENDSESSION`：注销、关机时壳与服务端被系统结束，按输出 22 的非合作结束。`BrowserWindow.activate` 不还原最小化窗口，要先 `unminimize()`。壳的界面文字只有中文。

## 行为（写进 Spec）

**设置**：`nbook.desktop` 加 `closeLastWindow`：`"quit"`（缺省）/ `"tray"`，标题“关掉最后一个窗口时”，选项“退出 NeuroBook”“留在系统托盘（服务继续运行）”，说明一句“注销或关机时 NeuroBook 会被系统结束，只保证已保存的内容”。与缩放、开机自启同一条值的路。

**后台**：壳有自有服务端、没有窗口、不在停止中时处在后台，分两种：

- **留在托盘**（模式 `tray` 关掉最后一个窗口）：一直运行，直到从托盘退出、系统结束它，或服务端意外退出后选“稍后”。
- **工作完成后退出**（缺省模式下选了那个按钮）：壳每 30 秒取一次在跑的工作，取到“没有工作、没有取不到的”时有序退出。取不到时继续等。

连的是别人的实例时没有后台，最后一个窗口关掉照旧退出。

**最后一个窗口关掉后去向**（模式 × 来源 × 有没有工作 × 托盘能不能显示）：

| 情形 | 询问 | 去向 |
|---|---|---|
| 模式 `quit`，用户关最后一个窗口，没有工作 | `quit`，不提示工作 | 停止、退出（照旧） |
| 模式 `quit`，用户关最后一个窗口，有工作（或取不到） | `quit`，提示列出工作，选择“取消”（缺省）/“工作完成后退出”/“仍然关闭”；托盘显示不了时没有中间那个 | 选中间那个：窗口关掉，进“工作完成后退出” |
| 模式 `tray`，用户关最后一个窗口，托盘能显示 | `window`（只问未保存正文） | 进“留在托盘” |
| 模式 `tray`，托盘显示不了 | 同模式 `quit` | 同模式 `quit` |
| 应用级退出（托盘“退出”、框架退出请求），任何模式 | 各窗口各自问，最后一个以 `quit`，不给“工作完成后退出” | 停止、退出 |
| 自有服务端不是壳的 | `window` | 退出，不停服务端（照旧） |

以询问时的原因为准：`quit` 询问得到同意就停止，询问期间模式改成 `tray` 也一样；`window` 询问照现有的重问规则。

**托盘图标**：壳有自有服务端，且（模式 `tray` 或在后台）时显示。提示文字：平时“NeuroBook”；留在托盘时“NeuroBook（在后台运行）”；工作完成后退出时“NeuroBook（工作完成后退出）”；停止中“NeuroBook（正在退出）”，菜单两项置灰。图标尺寸 16×主显示器缩放比例。退出前先删图标。

**菜单**：“打开 NeuroBook”、分隔线、“退出 NeuroBook”。左键与右键都弹这个菜单（Electrobun 2.0.6 的行为）。

- 打开：有不在关闭中的产品窗口时，把最近获得焦点的那个还原（最小化的）并置前；没有时开一个新窗口（与开窗转交同一条路）。停止中置灰。开出窗口即离开后台（“工作完成后退出”的轮询停下；之后再关最后一个窗口时重新按上表判断）。
- 退出：有窗口时等于应用级退出。没有窗口时，壳取一次在跑的工作（8 秒）：没有就停止、退出；有工作、有取不到的或整个取不到时开一个窗口，页面就绪后发应用级退出（提示照常列出工作，选“取消”时窗口留着）。取工作的这段里再点“退出”不理；这段里开出了窗口（托盘打开、开窗转交）就改成对全部窗口发应用级退出；这段里来了框架的退出请求就直接停止，取回的结果作废。

**后台时的其它事件**：

- 开窗转交照常开窗（离开后台）。
- 框架的退出请求：直接停止、退出（没有页面可问）。
- 自有服务端意外退出：照旧弹壳的对话框，文字改成“NeuroBook 的服务意外退出（退出码 N）。现在没有打开的窗口”，“重新启动服务”成功后留在原来那种后台；选“稍后”时壳退出（对话框开着时开出了窗口就照旧：窗口离线、不退出）。
- 更新：已下载的更新只在壳启动时换上；后台期间提示等有窗口就绪再交。模式 `tray` 时页面的更新文字把“下次打开 NeuroBook 时安装”换成“从系统托盘退出 NeuroBook 再打开时安装”。
- 注销、关机：系统结束进程（输出 22）。不承诺有序停止，写进已知限制。

**已知限制**（写进 Spec）：左键也弹菜单；Explorer 重启后图标不回来（从开始菜单再打开、或注销后恢复）；Windows 11 新图标缺省在“^”溢出区；注销、关机时非合作结束。提示里的说明写“可以从系统托盘或开始菜单再打开”。

## 设计

**协调器**（`windows.ts`）：

- 新选项：`closeLastWindow(): "quit" | "tray"`；port 新方法 `ensureTray(): boolean`（同步显示托盘，返回成功与否）、`focus(id)`（还原并置前）。
- `#appQuit`：`quitRequested()` 置位；任何一个窗口的询问以 `deny`、“取消关闭”收口时复位。置位时最后一个窗口一律以 `quit` 询问、不给后台选择。
- 询问原因与是否给后台：最后一个窗口、自有：`#appQuit` 或模式 `quit` 或 `!ensureTray()` → `quit`，此时 `offerBackground = !#appQuit && ensureTray()`；否则（模式 `tray` 且托盘可显示）→ `window`。`askPage(id, generation, reason, offerBackground)`。
- `pageAnswered(..., "background")`：只在这次询问 `offerBackground` 为真、仍是最后一个时有效：再 `ensureTray()` 一次，成功就 `#commit(id, false)` 并记下“工作完成后退出”；失败就当作 `deny`，port 弹对话框说明“系统托盘图标建不出来，没有进入后台”。其余情形的 `background` 丢弃并报诊断（新回调 `report`）。
- 窗口都关完：`#appQuit` → 不会发生（最后一个以 `quit` 提交，已在停止中）；自有、不在停止、记着的后台种类（模式 `tray` 的 `window` 提交 → 留在托盘；`background` 回答 → 工作完成后退出）→ `onBackgroundChanged(kind)`；否则 `onAllClosed`。
- 离开后台：后台时 `openWindow` / `openWindowRequested` / 托盘打开开出窗口 → `onBackgroundChanged(null)`。
- 托盘：`openFromTray()`、`quitFromTray()`；`#trayQuit: null | "checking" | {readonly askIn: WindowId}`，规则照上节；壳取回工作后调 `trayQuitChecked(hasWork: boolean)`。`askIn` 窗口就绪（`pageReady`）时 `quitRequested()`；它就绪前被关掉就清掉 `#trayQuit`。
- `quitRequested()` 没有窗口、自有时直接 `#stopping` 并 `onQuit`。`onQuit` 只调一次（`#stopping` 守住）。
- `serverAbandoned()`：没有窗口时调 `onAllClosed`。

**壳**（`shell.ts`）：托盘的显示规则是纯函数 `trayView({owned, mode, background, stopping}) → {visible, tooltip, enabled}`，状态变化时交 port 的 `setTray`；“工作完成后退出”的轮询（注入时钟，30 秒，`fetch(<serverUrl>/api/runtime/work)` 加 8 秒截止，`RunningWorkReportSchema` 校验，不合当取不到）；托盘退出的取工作（同一个取法）；意外退出对话框的后台文字；退出前 `removeTray`。

**设置值**（`desktop-settings.ts`、`desktop-bridge.ts`）：`DesktopSettingValuesSchema` 加 `closeLastWindow`；缓存读取逐项读，缺的或不合的项取缺省（旧缓存保留缩放）；`sameDesktopSettings` 逐键比较；`DEFAULT_DESKTOP_SETTINGS` 与模块头注释更新。

**适配层**（`desktop/src/bun/index.ts`）：启动拿到锁后建 `Tray`（先隐藏）；`setTray` 按需 `setVisible`、`setTitle`、`setMenu`（置灰）；`ensureTray` = `setVisible(true)` 后读 `visible`；`tray-clicked` 按 `action` 分派；`focus(id)` = `unminimize()`（最小化时）加 `activate()`；`exit` 里先 `tray.remove()`。

**页面**：桥 `close-query` 加 `background: boolean`（壳允许时才给中间那个按钮）；`close-answer` 的回答加 `background`。`close-query.ts` 给在跑的工作单独一个提问方法（返回 `close | background | cancel`），别的提示的类型不变；`background` 走 `allow` 那一支的收口（保留层、10 秒未关撤层写诊断）。提示组件加按钮“工作完成后退出”与一句说明“窗口会关掉，工作在后台跑完后 NeuroBook 自己退出；可以从系统托盘或开始菜单再打开”。更新提示的文字按模式（页面从配置读）。

## 切片

1. **Spec**（master）：desktop-shell 的目标（14 行）、非目标（19、21 行）、术语“关闭前询问”“最后一次关闭”（44、45 行）、输出 16 到 18、21（后台时的对话框）、新的“后台与托盘”一组输出（上面的表、托盘、菜单、事件）、状态表（加“后台”两种与转换）、“不变量”里补后台、桌面专属设置加一项、已知限制、验收 7 与新的验收“托盘与后台”；browser-host 输出 10 的在跑的工作（三个选择、`background` 回答、只在壳允许时给）；desktop-update 补模式 `tray` 时换上的时机与文字。写完对照审查第 16 条列的行再读一遍。
2. **设置值与桥**：配置项与文字、桥的形状、缓存逐项读、去重；测试：声明、旧缓存保留缩放、只改模式不被去重、桥校验。
3. **协调器**：上面的状态机；`windows.test.ts` 补：模式 `tray` 关最后一个进留在托盘；托盘显示不了时照 `quit`；`background` 回答（有效、托盘失败当 `deny`、没授权丢弃）；模式 `tray` 两个窗口应用级退出 → 最后一个以 `quit`、停止、不进后台；询问期间模式改变；`background` 之后、`closed` 之前开窗转交 → 不进后台；后台时开窗转交与托盘打开离开后台；托盘打开时唯一窗口在关闭中 → 开新窗口；托盘退出：有窗口、没窗口无工作、没窗口有工作开窗询问、取工作时再退出、取工作时开出窗口、取工作时框架退出、询问窗口就绪前被关、就绪前多出别的窗口；后台时框架退出；后台时意外退出“稍后”退出、对话框期间开窗后“稍后”不退出、重新启动后仍在后台；停止中托盘点击无效；`onQuit` 只调一次。
4. **壳与适配层**：`trayView` 的纯函数测试（含连别人的实例、停止中）；轮询与取工作（没有工作、有、取不到、形状不对、超时、开窗后停轮询）；适配层的 `Tray`。
5. **页面**：`close-query.ts` 与提示组件；单元测试（`background` 后层保留、过期代次不发、壳不允许时没有这个按钮、`window` 询问里没有）；e2e 补关窗询问的“工作完成后退出”（实施时查准文件）；更新文字按模式。
6. **Windows**（等 pc-notype 能构建，见 t18）：先做最小探针（建托盘、菜单、左键、点外面收起、键盘、Explorer 重启、Win11 溢出区、退出后无残留），再验收：两种模式关最后一个窗口、工作完成后自动退出、托盘打开（含最小化窗口还原）、托盘退出的三种情况、后台时从开始菜单再打开、后台 30 分钟后再打开、开机自启加模式 `tray`、后台时结束服务端进程。

## 验证

- 单元：`bun test src/desktop/`、`close-query` 的测试；类型检查；`bun run test:affected`。
- e2e：关窗询问所在的文件与 `desktop-frame.e2e.ts`。
- Windows：切片 6，证据进 `evidences/`。

## 待确认（照推荐做，记进待确认清单）

- 托盘图标只在模式 `tray` 或在后台时显示（不常驻）；连别人的实例时不显示。
- 缺省模式下的中间选择是“工作完成后退出”（工作跑完自动退出），不是无限期留在后台。
- 左键也弹菜单（Electrobun 2.0.6 的行为，要“左键打开”得自己用 FFI 做托盘）。
- 注销、关机时非合作结束，不承诺有序停止；要有序停止得自己处理 `WM_QUERYENDSESSION`（后续）。
- 托盘菜单与提示只有中文（与壳的其它文字一致）。
- 模式 `tray` 时更新的文字改成“从系统托盘退出再打开时安装”，不在后台自动换上。

## 后续（不在本 Task）

- 自己用 bun:ffi 建托盘窗口：左键直接打开、处理 `TaskbarCreated`、版本 4 的回调（键盘）。
- 处理 `WM_QUERYENDSESSION` 加 `ShutdownBlockReasonCreate`，注销、关机时有序停止。
