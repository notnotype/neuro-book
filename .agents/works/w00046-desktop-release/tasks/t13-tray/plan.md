# t13 计划：系统托盘与关掉最后一个窗口时的去向（r3）

- r1 经 Opus 设计审查 18 条，处理见 [evidences/design-review-r1-disposition.txt](evidences/design-review-r1-disposition.txt)。
- r2 经 Opus 第 2 轮 17 条（1 阻塞、10 应改），处理见 [evidences/design-review-r2-disposition.txt](evidences/design-review-r2-disposition.txt)。
- r3 经 Opus 第 3 轮 4 条（0 阻塞、2 应改、2 可选），已直接改进本文，处理见 [evidences/design-review-r3-disposition.txt](evidences/design-review-r3-disposition.txt)。

第 2 轮的问题多集中在两处：缺省模式下的“工作完成后退出”（后台回答、托盘先显示、轮询），以及托盘退出时开窗询问。r3 把这两处换成简单的做法：

- 缺省模式不再给后台选择。关最后一个窗口的询问与提示保持原样，后台只来自模式 `tray`。“有工作在跑时留在后台”另建 Task，等托盘先用起来再定。
- 托盘退出时，没有窗口、有工作，就用壳自己的对话框问（不开产品窗口、不等页面就绪）。

## 目标

1. 设置“关掉最后一个窗口时”：缺省“退出 NeuroBook”，可改为“留在系统托盘”。
2. 托盘图标与菜单：打开、退出。

## 现状（读过的代码与 Electrobun 2.0.6）

- `src/desktop/windows.ts` 的 `WindowCoordinator` 是纯状态机。
  - `#isLast(id)`（自有、没有别的存活窗口）决定原因 `quit`。
  - `pageAnswered` 提交前重判：`window` 同意而此刻已是最后一个，就以 `quit` 重问。之后 `#commit(id, #isLast(id))`。
  - “没有响应”对话框的强制关闭也是 `#commit(id, #isLast(id))`。
  - 窗口都没了调 `onAllClosed`。
  - `quitRequested()` 对每个没在问的窗口走 `closeRequested`。
  - `serverAbandoned()` 只把 `#ownsServer` 置 false。
  - 最后一次关闭进行中时开窗转交回 `closing`，页面请求的新窗口被拒。
- `src/desktop/shell.ts`：`#stopAndExit`、`#allClosed`。开窗转交由锁的回调直接调协调器。
- `desktop/src/bun/index.ts`（适配层）：
  - 持有桌面专属设置的当前值 `desktopValues`，由页面交来，或从缓存读。
  - 壳的对话框是自己开的小窗口，加载本地页面（例如“没有响应”）。
  - `exitOnLastWindowClosed: false`；`before-quit` 一律否决，交给协调器。
- `src/desktop/desktop-settings.ts`：缓存整份做 `Value.Check`（各项必填）；`sameDesktopSettings` 只比两项。
- Electrobun 2.0.6 托盘：
  - 图标只认 `.ico`（`neurobook.ico` 已随包）；构造时立刻显示，失败时 `id` 为 0。
  - `setVisible(false)` 删图标；`setVisible(true)` 重建图标，但菜单与按 id 注册的点击不跟着重建。
  - 设了菜单时左右键都弹菜单。
  - 不处理 `TaskbarCreated`；退出时不删图标；没有 `WM_QUERYENDSESSION`，注销、关机时进程被系统结束。
  - `activate` 不还原最小化的窗口。
  - 壳的文字只有中文。

## 行为（写进 Spec）

**设置**：`nbook.desktop` 加 `closeLastWindow`，取 `"quit"`（缺省）或 `"tray"`。

- 标题“关掉最后一个窗口时”；选项“退出 NeuroBook”“留在系统托盘（服务继续运行）”。
- 说明：“留在托盘时，注销或关机会由系统结束 NeuroBook，只保证已保存的内容”。
- 中英两份文字；与缩放、开机自启走同一条值的路。

**托盘图标**：壳有自有服务端、模式是 `tray`、不在停止中时显示，否则不显示（缺省用法看不到）。

- 停止中图标消失。
- 提示文字：有窗口时“NeuroBook”，没有窗口时“NeuroBook（在后台运行）”；托盘退出正在取工作时“NeuroBook（正在检查在跑的工作）”。
- 图标尺寸取建图标那一刻主显示器的缩放比例；之后改缩放、换主显示器不重建（已知限制）。

**后台**：壳有自有服务端、没有窗口、不在停止中。只在模式 `tray` 且托盘图标显示着时进入，其余情形都没有后台。

**菜单**：“打开 NeuroBook”、分隔线、“退出 NeuroBook”。左键与右键都弹出它。

- **打开**：有不在关闭中的产品窗口时，把最近获得焦点的那个还原（最小化的）并置前；没有时开一个新窗口，与开窗转交同一条路，规则也相同（应用级退出或最后一次关闭进行中时不开）。托盘退出正在取工作时点“打开”，作废这次退出，照常打开。
- **退出**：
  - 有窗口时等于应用级退出。
  - 没有窗口、服务端已意外退出（对话框选过“稍后”或开着）时，直接退出。
  - 没有窗口时：先取一次在跑的工作，截止 8 秒；正在取时再点“退出”不理。
    - 取到没有工作：停止、退出。
    - 有工作、有取不到的、或整个取不到：弹壳的对话框“NeuroBook 有工作在跑，退出会中断它们”。有工作时写出项数，取不到时写“无法确认是否有工作在跑”；给“取消”（缺省）、“打开 NeuroBook”（开窗看是什么工作）、“仍然退出”。
    - 取回时已有窗口（这段里开窗转交开出来的），这次退出作废。
    - 对话框开着时开出了窗口：关掉对话框，这次退出作废。关掉对话框（X）等于“取消”。对话框开着时再点托盘“退出”：把对话框置前。
    - 上面每一处“停止、退出”都经应用级退出（没有窗口时它直接停止），不另开停止的入口：协调器因此进入停止中，开窗转交回 `stopping`。

**最后一个窗口关掉之后**：只看提交关窗时这个窗口的询问原因，并按下表定原因：

| 情形 | 原因 | 关掉之后 |
|---|---|---|
| 服务端不是壳的（连别人的实例，或意外退出后选了“稍后”） | `window` | 壳退出，不停服务端（照旧） |
| 应用级退出进行中（托盘“退出”、框架的退出请求） | `quit` | 停止、退出 |
| 模式 `tray`，托盘图标此刻显示着 | `window` | 进后台 |
| 其余（模式 `quit`，或模式 `tray` 而图标没显示出来） | `quit` | 停止、退出（照旧） |

- `window` 询问照常问参与方与宿主页未保存的正文，不提示在跑的工作。
- 用户关、页面同意按上表。“没有响应”对话框里的强制关闭：这次询问的原因与此刻按上表算的原因有一个是 `quit`，就以 `quit` 提交。
- 重问：`window` 询问同意时，按上表重算。原因变成 `quit`（例如询问期间模式改成 `quit`、托盘消失、来了应用级退出），就以 `quit` 再问一次。
- `quit` 询问得到同意就停止，询问期间模式改成 `tray` 也一样。
- 启动中关窗（输出 23）不变：没有产品窗口，没有后台。

**应用级退出**：`quitRequested()` 发起，它进行中不开新窗口（开窗转交回 `closing`、页面的新窗口被拒、托盘打开不开）。

- 每个窗口各自询问，最后一个以 `quit`。
- 任一询问以 `deny` 或“取消关闭”收口，就结束这次应用级退出。
- 剩下的窗口都已在关闭中，最后一个关掉时停止、退出。
- 没有窗口时直接停止、退出（后台时的框架退出请求）。

**后台时的其它事件**：

- 开窗转交照常开窗。
- 自有服务端意外退出：对话框照旧（壳自己的窗口）。正文把“窗口保持离线”换成“现在没有打开的窗口”。
  - 选“重新启动服务”，成功后留在后台。
  - 选“稍后”，壳退出；对话框开着时开出了窗口，就照旧离线、不退出。
- 更新：已下载的更新只在壳启动时换上，后台期间的提示等有窗口就绪再交。模式 `tray` 时，页面的更新文字把“下次打开 NeuroBook 时安装”换成“从系统托盘退出 NeuroBook，再打开时安装”。

**已知限制**（写进 Spec）：

- 左键也弹菜单。
- Explorer 重启后图标不回来：从开始菜单再打开，或注销后恢复。
- Windows 11 的新图标缺省在“^”溢出区。
- 注销、关机时被系统结束（输出 22）。
- 图标尺寸不随缩放变化。

## 设计

**协调器**（`windows.ts`）：

- 新选项 `closeLastWindow(): "quit" | "tray"`，`trayShown(): boolean`（由壳给）。
- 新回调 `onWindowsChanged(count)`，壳据此算后台与提示文字。
- `#reasonFor(id)` 就是上面的表。`closeRequested`、重问、强制关闭都用它；提交按这次询问的原因（`quit` 才停）。
- `#appQuit`：
  - `quitRequested()` 置位。
  - 任一询问 `deny` 或取消关闭时复位。
  - 置位时 `openWindowRequested` 回 `closing`，`pageWindowRequested` 与托盘打开不开窗。
  - 置位时窗口都关完（剩下的本来就在关闭中）→ 停止。
- 窗口都关完（在 `closed` 那一刻判断）：
  - `#appQuit` → `onQuit`。
  - 不在停止、自有（`#ownsServer`）、模式 `tray`、`trayShown()` → 留在后台（不调 `onAllClosed`）。
  - 其余 → `onAllClosed`（照旧）。
- `serverAbandoned()`：没有窗口时调 `onAllClosed`。
- 托盘：
  - `openFromTray()` 返回 `{focus: id} | {opened: id} | null`，置前由适配层做。
  - `quitFromTray()`：有窗口时 `quitRequested()`；没有窗口时交回 `"check-work"`。
  - 取工作的状态（`#trayQuitCheck`）由壳持有：协调器只提供“此刻有没有窗口、在不在停止”，判断都在壳里。
- `onQuit` 只调一次（`#stopping` 守住）。

**壳**（`shell.ts`）：

- 模式由适配层在收到设置值时交进来（`setCloseLastWindow(mode)`）；启动时用缓存里的值。
- 托盘视图是纯函数 `trayView({owned, mode, stopping, windows, checking}) → {visible, tooltip}`。任一输入变了就重算，交给 port 的 `setTray`。`owned` 与协调器的 `#ownsServer` 同义（自有、还没选“稍后”），服务端意外退出、对话框开着时图标仍在。适配层“图标没建出来”只记诊断、给协调器的 `trayShown()` 用，不作为 `trayView` 的输入（免得同步循环）。
- 托盘退出：取工作（`fetch(<serverUrl>/api/runtime/work)`，8 秒截止，`RunningWorkReportSchema` 校验，不合当取不到），然后按上节分支；对话框经 port 的 `showQuitWork({count, uncertain})`，选择交回 `quitWorkChose`。
- 意外退出对话框按“有没有窗口”给两种正文。

**设置值**：

- `DesktopSettingValuesSchema` 加 `closeLastWindow`。
- 缓存读取逐项读，缺的或不合的项取缺省（旧缓存保留缩放）。
- `sameDesktopSettings` 逐键比较。
- `DEFAULT_DESKTOP_SETTINGS` 与模块头注释跟着改。

**适配层**（`index.ts`）：

- `setTray({visible, tooltip})`：
  - 要显示而还没有托盘对象：`new Tray({title, image, width, height})`。`id` 为 0 就丢掉这个对象、记诊断、告诉壳“没显示出来”。
  - 建成后 `setMenu` 并按它的 id 注册一次点击；之后只在提示文字变了时 `setTitle`。
  - 要隐藏：`tray.remove()`，丢掉对象。
  - 不用 `setVisible`，避免 id 与菜单不跟着重建的问题。
- `trayShown` 读的是这个对象在不在。
- `focus(id)`：最小化时先 `unminimize()`，再 `activate()`。
- `exit`：先 `tray?.remove()`，再 `Utils.quit`。
- 新对话框“有工作在跑”，与“没有响应”同一套本地页面。

**页面**：

- 设置项的声明与中英文字（`src/plugins/desktop/shared/contracts.ts`）。
- 插件说明（`src/plugins/plugins/locales` 的 `nbook-desktop`）补一句。
- 更新文字按模式（`src/web/locales` 的中英两份；页面从配置读模式）。
- 关窗询问不变。

## 切片

1. **Spec**（master）。`desktop-shell` 要改的地方：
   - 目标与非目标；
   - 术语“最后一次关闭”；
   - 输出 16 到 18、21；
   - 新的“托盘与后台”一组输出（上面的表、菜单、事件、应用级退出）；
   - 状态表加“后台”；
   - 不变量；
   - 桌面专属设置加一项；
   - 已知限制；
   - 验收 5、7 与新的“托盘与后台”。

   另外：`browser-host` 不变；`desktop-update` 补模式 `tray` 时的文字与换上时机。
2. **设置值与桥**，测试：
   - 声明；
   - 旧缓存保留缩放、模式取 `quit`；
   - 只改模式的值不被去重；
   - 桥校验。
3. **协调器**，`windows.test.ts` 要覆盖：
   - 模式 `tray`：
     - 关最后一个窗口进后台（`window` 询问）；
     - 托盘没显示时按 `quit`；
     - 强制关闭最后一个进后台；
     - 询问期间模式改成 `quit` 时重问；
     - 询问期间模式改成 `tray` 而原因已是 `quit`：停止。
   - 应用级退出：
     - 模式 `tray` 两个窗口 → 最后一个以 `quit`，停止；
     - 进行中开窗转交回 `closing`；
     - 任一取消后结束；
     - 剩下的都在关闭中时停止；
     - 没有窗口时直接停止。
   - 后台：
     - 开窗转交离开后台；
     - 托盘打开（置前最近焦点的、唯一窗口在关闭中时开新窗口、停止中无效）。
   - 意外退出：
     - 后台时选“稍后”退出；
     - 对话框期间开了窗再选“稍后”，不退出；
     - 重新启动后仍在后台。
   - `onQuit` 只调一次。
4. **壳与适配层**：
   - `trayView` 的组合：连别人的实例、停止中、取工作中、有没有窗口。
   - 托盘退出：
     - 没有工作就退出；
     - 有工作、取不到、形状不对、超时，都弹对话框，三个选择各走一遍；
     - 取时点打开，作废这次退出；
     - 取时开窗转交，作废；
     - 服务端已退出时直接退出。
   - 适配层的 `Tray` 生命周期。
5. **页面**：设置项与文字，更新文字按模式；对应的测试。
6. **Windows**（等 pc-notype 能构建，见 t18）：
   - 先做最小探针：建托盘、菜单、左键、点外面收起、键盘、Explorer 重启、Win11 溢出区、退出后没有残留。
   - 再验收：
     - 两种模式关最后一个窗口；
     - 托盘打开（含最小化窗口还原）；
     - 托盘退出的各分支，含对话框；
     - 后台时从开始菜单再打开；
     - 后台 30 分钟后再打开；
     - 开机自启加模式 `tray`；
     - 后台时结束服务端进程；
     - 改缩放后的图标。

## 验证

- 单元测试：`bun test src/desktop/`、设置与插件的测试；类型检查；`bun run test:affected`。
- e2e：设置窗口里桌面分区的文件（实施时查准）。
- Windows：切片 6，证据放进 `evidences/`。

## 待确认（照推荐做，记进待确认清单）

- 托盘图标只在模式 `tray` 时显示，连别人的实例时不显示。
- 缺省模式不给“留在后台”，那个功能另建 Task。这一条取代清单里“工作完成后退出”那行。
- 左键也弹菜单。
- 注销、关机时被系统结束。
- 托盘菜单与提示只有中文；模式 `tray` 时更新文字改写。
- 托盘退出遇到在跑的工作时，用壳自己的对话框只给项数，不列出每一项（壳没有页面的文字目录）；要看是什么工作就点“打开 NeuroBook”。

## 后续（不在本 Task）

- 缺省模式下有工作在跑时留在后台（或工作完成后退出）。
- 用 bun:ffi 自建托盘窗口：左键直接打开、处理 `TaskbarCreated`、键盘回调、按缩放换图标。
- 处理 `WM_QUERYENDSESSION` 并配合 `ShutdownBlockReasonCreate`，让注销、关机时有序停止。
