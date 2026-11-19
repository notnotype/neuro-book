# t10 计划：桌面版自动更新

## Context

装好的桌面版要自己发现新版本、经用户同意后下载、下次启动时换上，只升不降；便携版与设了 `NBOOK_STATE_ROOT` 的启动只提示。合同是 [`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md) 输出 1 到 10 与场景 1 到 7（t06 写成，planned），以及：
- [`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 11：页面把壳交来的提示交给工作台显示、把选择交回壳；
- [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 13。

依据提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 4.6、ADR 0051 决定 6；开发者 2026-11-13 定了只升不降、不签名。t06 的待确认条目：提示只有一个动作“下载”、关闭即“以后”、已下载至多一份、`NBOOK_STATE_ROOT` 与便携只提示。

工作方式：autonomous-delivery，代码在 Work 分支 `feat/w00046-desktop-release`。Windows 验收要 Windows 开发机（11 月 13 日 17:05 起离线），核心逻辑在 Linux 上用测试把关。

更新器的真实行为见 [调研](evidences/electrobun-updater-research.txt)，计划依赖其中几条：
- 只比哈希；
- 下载没有百分比、下载前删旧的；
- `applyUpdate()` 自己退出进程，新版本不继承环境；
- 换上结果下次启动时对账；
- baseUrl 只能在构建时定。

## 技术选型

- 更新：Electrobun 2.0.6 的 `Updater`（ADR 0051）。它的下载、补丁链、换上与回滚都用现成的，不另写。
- 版本比较：先按 SemVer 2.0 的语法严格解析（`主.次.修订`，没有前导零、没有预发布段，构建元数据可有可无），解析不了算检查失败；比较用 `Bun.semver.order`（Bun 自带）。`order` 本身接受 `2`、`v2.0.0`、`02.0.0` 这类写法（omp 设计审查第 8 条实测），不能拿它当校验。
- 安装级的“在用”与“发起换上”：nb-flock 加共享锁模式（`flock` 的 `LOCK_SH`、`LockFileEx` 不带独占标志），一把锁文件、进程退出即放。它只管“有人在用时不发起换上”；壳退出之后的那段由更新器的换上程序与 Windows 的文件占用承担（开发者 2026-11-14 选定的方向 A）。没拿到共享锁的壳不启动（第二轮第 3 条）。否决：
  - 每个壳一把独占锁、换上时逐个探测：探测与新启动之间有竞态；
  - 按过期判旧的锁（proper-lockfile）：壳暂停久了会被误判为不在用。
- 换上的终态：读更新器的换上程序写在通道根的结果文件 `.electrobun-update-<事务号>.result.json`（`schema_version: 1`，字段 `transaction_id`、`success`、`phase`、`message`、`version`、`hash`；Electrobun 2.0.6 `Updater.ts` 的 `validateNativeUpdateResult`、`scanNativeUpdateResults`）。SDK 只经状态事件交出它，且用 `.electrobun-observed-update-result.json` 记“已观察”，第一个调 `getLocalInfo` 的进程（可能只是转交后就退出的壳）就把它消费掉，所以由我们按同样的校验规则自己读（第二轮第 2 条）。这是对固定版本私有文件格式的依赖，适配层集中在一处、带格式用例，升级 Electrobun 时重核。否决：
  - 只按本地版本判断：换上程序还在重试换目录时与已经失败的情形分不开；
  - 按墙钟猜（发起后若干分钟内算进行中）：电脑睡眠时换上程序被挂起、醒来后还会接着动准备目录，超过时限不等于它已结束（第三轮第 3 条）。改为看它的进程还在不在：它被复制到 `%TEMP%\electrobun-update-<事务号>.exe` 运行（`Updater.ts` 的 `copyUpdateHelper`），计划任务没有触发器、只按需运行一次（`WindowsUpdateTask.ts`），重启后不会再起。
- 页面显示：工作台通知服务（`notificationsKey`，t09 加了 `onClose`）。

## 关键设计

### `packages/nb-flock`

- `tryLock(path, options?: {shared?: boolean})`：共享时 Linux、macOS 用 `flock(LOCK_SH | LOCK_NB)`，Windows 用 `LockFileEx(LOCKFILE_FAIL_IMMEDIATELY)`（不带 `LOCKFILE_EXCLUSIVE_LOCK`），锁同一个字节范围。返回值与独占相同。README 补一节。
- 测试（真实子进程）：两个共享都拿到；有共享时独占拿不到；有独占时共享拿不到；持有者退出后都能拿到。

### `packages/neuro-book/src/desktop/update.ts`（新增，核心，不依赖 Electrobun）

端口：
- `UpdaterPort`：
  - `local`：`{version, hash}`（`Updater.localInfo`）；换上与对账一律比哈希，版本只用于显示与只升不降（第二轮第 5 条：同版本不同包）；
  - `check()` → `{ok: true, version, hash} | {ok: false, error}`；
  - `download(target)` → `{ok: true} | {ok: false, error}`。`downloadUpdate()` 成功、失败都 resolve 为 `undefined`（失败被它自己 catch 后写进 `updateInfo.error`），适配层在 await 之后读 `Updater.updateInfo()`：`updateReady` 为真、`error` 为空、`hash` 等于 `target.hash` 才算成功，其余都按失败，`error` 取它的文字只进日志（第二轮第 6 条）；
  - `apply()` → `"exiting" | {failed: string}`。适配层取这次调用开始之后新增的状态记录：走到“正在启动新版本”就是 `exiting`，壳不再做任何事、等进程被结束；其余返回与抛错都是同步失败（被否决、没有可换的、发起不成）；
  - `results()` → 通道根里校验过的结果文件 `{version, hash, success, phase, modifiedAt}` 列表（见技术选型“换上的终态”）；目录读不了、条目太多时返回 null，按“还没有结果”处理并写日志。遍历全部合格的候选，不用 SDK 按当前构建筛过的 `selected`（装回旧版的那一行要读到成功的结果）；
  - `helperRunning()` → 有没有映像名以 `electrobun-update-` 开头的进程（`tasklist /fo csv /nh`，不经 PowerShell）；查不了时返回 null，按“还在”处理；
  - `downloadPageUrl`。
  - 不按更新器的 `onStatusChange` 事件判断结果（omp 第 4 条：`error` 是检查、下载、换上共用的通道）。
- `UpdateStatePort`：安装级的更新状态文件（见下一节），整份读、整份原子替换。
- 便携版与只提示的启动不碰安装级文件，`UpdateStatePort` 为 null（第 7 条；第二轮第 1 条的单写者靠这一点）。

`UpdateController`（输出 1 到 7、9、10）：
- 模式：
  - `auto`：受管安装，没设 `NBOOK_STATE_ROOT`；
  - `notify-only`：便携，或设了环境变量。只和本地版本比，不看已下载的更新（第 12 条）。
- 寿命：挂在壳的运行中区间（第 9 条）。
  - `start()` 在壳进入运行中时调；`stop()` 在进入停止中时同步调；`close()` 在壳放桌面锁之前调（`#releaseAndExit` 第一步）。
  - `stop()` 取消计时、封住选择、不再发提示。每次 `await` 返回后先核对还在运行中，不在就不再提示、不再检查。
  - 例外是在途下载的结果（第二轮第 9 条）：`stop()` 之后、`close()` 之前完成的下载照样写进状态文件（停服务端最长要 90 秒，这段时间里下完是常见的）；`close()` 之后完成的丢掉。壳不为下载多等。
  - 已知限制：`close()` 时还没下完的，下一次检查重新提示，用户再点一次“下载”（更新器发现已准备好的同一份会直接完成）。
- 时机：运行中检查一次，之后每 24 小时一次。计时用注入的 `DeadlineClock`（`at` 分段）。
- 判定：
  - 远端版本须是严格的稳定版本号，且高于基线。
  - 基线：本地版本；`auto` 模式下还有状态文件里“已下载”且不在失败、被取代名单里的那个版本，取两者较高的。
- 同一时刻只做一件事（检查、下载串行，第 3 条）。下载要绑定目标：
  - 用户选“下载”时先重新 `check()`；
  - 远端仍是提示里的那个版本与哈希才调 `download(target)`；
  - 变了就回到判定，按新结果提示，不直接下；
  - 开始下载前，把状态文件里现有的“已下载”记为被取代（第 17 条：更新器在准备开始之前就失败时，旧的文件还在，但不会再被换上）；
  - 下载成功后把这个版本与哈希记为“已下载”，并把这个哈希从失败、被取代两个名单里移除：用户明确选了下载、下载也成功，就是重新授权换上它（第二轮第 4 条）。开始下载时不移除，否则下载失败会让旧的那份复活。
- 有未对账的 `attempt`（换上程序可能还在动安装目录与准备位置）时，`auto` 模式不检查、不提示、不下载（第二轮第 2 条）；运行中每 30 秒按对账表重新判一次，出了终态就在这次运行里对账、发通知、恢复检查（第三轮第 1 条：换上失败后换上程序重新启动的旧版本会转交给已在运行的壳，等下一次启动可能要等几天）。
- 状态、“以后”、目标移动与重试按 Spec 的状态表。
- 页面选择的唯一判定（第 11 条、第二轮第 7 条）：
  - 每次阶段变化发一个新 id，“以后”不换 id；
  - 壳只接受最新那个 id 的选择，不论它是当前提示还是已被关掉（“以后”、通知被关）；旧 id 写诊断后忽略；
  - 选择须是这一种提示允许的：`available` 收 `download` 与 `later`，`download-failed` 收 `retry` 与 `later`，`notify-only` 收 `open-page` 与 `later`，别的种类不收选择；不符的写诊断后忽略；
  - 重复的 `download`、`retry` 在下载进行中不重复下载。
  - 协调器（下一节）不另判，直接交给这条规则。

### 启动时换上：`src/desktop/update.ts` 的 `applyAtStartup` 与 `reconcileAtStartup`

状态文件 `nbook-update-state.json` 与锁文件 `nbook-install.lock` 放在通道根（`%LOCALAPPDATA%\<identifier>\stable\`，换上时 `app` 目录整个被替换，不能放在里面；Setup 重装也只替换 `app`，不动它们）。内容：
- `downloaded`：`{version, hash}` 或 null；
- `attempt`：`{version, hash, from, at}` 或 null：发起过换上、还没对账。`from` 是发起时本地的哈希，`at` 是发起时刻（写在调 `apply()` 之前）；
- `failed`、`superseded`：哈希列表，至多各留 8 个；
- `pendingNotice`：`{kind: "updated" | "update-failed", version, forHash}` 或 null，等产品窗口显示；`forHash` 是该显示它的那个构建的哈希。

单写者（第二轮第 1 条）。共享锁加原子替换不保证读改写互斥，所以不靠它，而是让任何时刻至多一个进程写：
- 只有 `auto` 模式（受管安装、没设 `NBOOK_STATE_ROOT`）的壳读写状态文件；便携版没有这个文件，设了环境变量的壳只取共享锁、不读不写（只提示模式本来就只比本地版本）。
- `auto` 模式的壳只在两段时间里写：持有安装独占时（`applyAtStartup` 第 3 步），持有缺省状态根的桌面锁时（`reconcileAtStartup` 与控制器，到 `close()` 为止）。
- 这两段互斥：持桌面锁的壳从第 4 步起一直持有共享锁，有共享锁时别人拿不到独占；缺省状态根的桌面锁同一时刻只有一个壳持有（desktop-shell 输出 1）；转交后退出的壳两段都不进。
- 测试用两个真实进程各占一个状态根，断言只有不设环境变量的那个写过状态文件；并把 omp 第二轮的交错（P 写 `downloaded`、Q 用旧快照清通知）作为回归用例，断言它在这套规则下不可达。

`applyAtStartup`（第 1 到 3 步只在 `auto` 模式，设了环境变量的壳只走第 4 步，便携版都不走；在取桌面锁之前，输出 8）：
1. 状态文件里有未对账的 `attempt`，或没有可换的 `downloaded`（哈希等于本地，或在 `failed`、`superseded` 里，或版本不高于本地）：跳到第 4 步。
2. 试独占锁。拿不到（有人在用）：跳到第 4 步。
3. 拿到之后重读状态文件（别的壳可能刚换过，第 2 条）：
   - 仍然可换：写 `attempt`，启动页显示“正在更新到 X”，调 `apply()`。
     - `exiting`：停在这里，等更新器结束进程。
     - `{failed}`：把哈希记进 `failed`、清 `attempt`、写 `pendingNotice: update-failed`（`forHash` 为本地哈希），放独占，写日志，照常启动。
   - 不可换：放独占，跳到第 4 步。
4. 取共享锁，持有到进程退出。拿不到说明别人正在发起换上（它持有独占，调完 `apply()` 就退出），每秒重试；30 秒还拿不到，启动页报“另一个 NeuroBook 正在更新”，按钮“重试”“退出”，不拉起服务端、不开产品窗口（第二轮第 3 条：30 秒只是等待上限，不是无锁启动的许可）。
   - 不显示“正在更新”、不等结果：壳退出之后换上真正进行时，新打开的旧程序由文件占用让这次换上失败（方向 A）。

`reconcileAtStartup`（只在 `auto` 模式、取到桌面锁之后，第 5 条）。有 `attempt` 时按下表取终态，`local` 是本地的哈希，“结果”是哈希等于 `attempt.hash`、修改时间不早于 `attempt.at` 的最新一份结果文件：

| 情形 | 结论 |
|---|---|
| `local` 等于 `attempt.hash` | 成功：`pendingNotice: updated`（`forHash` 为它），清 `downloaded` |
| `local` 等于 `attempt.from`，结果为失败 | 失败：哈希进 `failed`，`pendingNotice: update-failed`（`forHash` 为 `local`） |
| `local` 等于 `attempt.from`，结果为成功 | 换上之后又装回了旧的：不提示 |
| `local` 等于 `attempt.from`，还没有结果，换上程序的进程还在，或 `at` 在 2 分钟内 | 进行中（计划任务可能还没把它拉起来；它可能睡眠后醒来接着换）：保留 `attempt`，不提示；运行中每 30 秒再判 |
| `local` 等于 `attempt.from`，还没有结果，进程不在，且 `at` 已过 2 分钟 | 换上程序没有留下结果就没了（没跑起来、被杀、重启了电脑）：按失败处理 |
| `local` 两个都不等 | 用户手动装了别的构建：不提示 |

- 除了“保留”那一行，都清 `attempt`；手动重装的两行另清 `downloaded`（它是对旧安装准备的，Spec 输出 8 的“下一次启动再试”只对没被替换的安装成立）。
- 新版本起来之后崩溃、下一次才对账，仍落在第一行，不算失败（输出 8 最后一条）。
- `pendingNotice` 的 `forHash` 不等于 `local` 时直接清掉不显示（装回旧版本后不再说“已更新到 B”）；等于时交给控制器作为一次性提示，收到页面的 `update-hint-shown` 才清，没有产品窗口就退出的壳留着它给下一次。

退出拦截（第 14 条）：
- 适配层的 `before-quit` 处理器从一开始就注册，由核心的阶段决定放不放行：
  - `pre-lock` 与 `applying` 放行，这样 `applyUpdate` 的退出请求能通过；
  - 取桌面锁之后到已停止之前一律否决。
- `apply()` 只在 `pre-lock` 阶段调用，一定在拉起服务端之前。

### 壳的提示状态（`src/desktop/update.ts` 的一部分）与窗口（`src/desktop/windows.ts`）

提示是状态，不是事件（Sonnet 设计审查第 1、3、6 条）：
- `UpdateController` 至多持有一条“当前提示” `{id, kind, version}`，每次阶段变化换一个新 id；
- 协调器为它记一个“持有窗口”。

交付与转交：
- 当前提示变化时，交给最近获得焦点的、已就绪的产品窗口，它成为持有窗口；没有就绪窗口时等。
- 只在三种情况把提示转给当时最近焦点的就绪窗口：持有窗口关掉、刷新（同一窗口又报一次就绪）、离开就绪。
- 别的窗口第一次就绪时，只在没有持有窗口时接手；正在关的窗口不选。
- 转交时对旧窗口发 `update-hint-end`；旧窗口已关掉的不发。

结束：
- 带选择的提示（`available`、`notify-only`、`download-failed`）由用户的选择结束。
  - 选“以后”时壳记下这个版本不再提示，清掉当前提示，但不发 end：中心里留下的“下载”仍可点，壳仍接受这个 id 的 `download`（场景 7）。
- 一次性的提示（`downloaded`、`updated`、`update-failed`）在页面回 `update-hint-shown` 后清掉，不再转交。
- `downloading` 一直留到阶段变化。

壳对页面的消息只信形状与窗口（第 7 条），选择是否接受只按控制器的“页面选择的唯一判定”，协调器不另立规则。

### 页面一侧（`src/shared/desktop-bridge.ts`、`src/web/host/`）

- 桥加这些消息：
  - 壳到页面：`{type: "update-hint", id, hint}`、`{type: "update-hint-end", id}`；
  - 页面到壳：`{type: "update-choice", id, choice}`、`{type: "update-hint-shown", id}`、`{type: "page-ready"}`、`{type: "page-gone"}`。
- 就绪的定义（第 4 条）：窗口状态是 `ready`，且 `mountWindowUi` 挂好了页面（`PageOutlet`，不是启动失败页）。
  - 每个运行实例只报一次 `page-ready`，连接在在线与离线之间变化不再报；
  - 离开 `ready`（服务端重启、项目已关闭、版本不一致）与 `pagehide` 时报 `page-gone`；
  - 发送失败写诊断，下一次状态变化时再试。
- 监听在 `boot.ts` 最早建立，与关窗询问同时。就绪之前来的提示先缓冲，就绪后再显示。
- 通知服务的取法（第 5 条）：`window.ts` 加一个非必需的启动门禁，依赖 `notificationsKey`，与现有的 `workbench-root` 同一种写法；`BrowserWindow` 加 `notifications(): Notifications | null`，离开 `ready` 即为 null。
  - 选宿主取工作台的服务而不是让工作台贡献出口：宿主本来就依赖工作台交根界面（`workbenchRootKey`），通知只给宿主自己用，不经本地能力交给插件。
- 新文件 `src/web/host/desktop-updates.ts`：按下表把提示发成通知，记“壳 id → 通知句柄”。
  - 同一 id 再来时，句柄还在就不重发；句柄已失效（点了动作、被用户关掉、到时消失）也不重发，壳会在需要时换新 id。
  - `update-hint-end` 时 `dismiss()`，连中心记录一起删：这条提示已被新阶段取代，留着它的“下载”只会让人点到旧版本。
  - 发出后回 `update-hint-shown`。

| hint | 色调 | 常驻 | 动作（choice） | 用户关闭（`onClose`） |
|---|---|---|---|---|
| `available` | info | 是 | 下载（`download`） | `later` |
| `notify-only` | info | 是 | 打开下载页（`open-page`） | `later` |
| `downloading` | info，不确定进度 | 是 | 无 | 不回（下载照常） |
| `download-failed` | warning | 是 | 重试（`retry`） | `later` |
| `downloaded` | success | 否 | 无 | 不回 |
| `updated` | success | 否 | 无 | 不回 |
| `update-failed` | warning | 否 | 无 | 不回 |

- `notify-only` 设了 `NBOOK_STATE_ROOT` 时，正文另加一句“不设这个环境变量打开 NeuroBook 时可以自动更新”。
- 文案放宿主目录 `nbook.host` 的 `update.*`，`zh-CN` 与 `en-US` 两份，带版本参数。

### Electrobun 适配与构建（`desktop/`）

- `desktop/src/bun/index.ts`：
  - `UpdaterPort` 接 `Updater`：
    - `check` 用 `checkForUpdate()`，只取 `version`、`hash` 与 `error`，不用 `updateAvailable`；
    - `download` 用 `downloadUpdate()`，之后按 `updateInfo()` 判断（见端口）；
    - `apply` 用 `applyUpdate()`：调用前记下状态记录的长度，返回或抛错后只看这之后新增的项里有没有“正在启动新版本”（`launching-new-version`），不按英文文字分支；
    - `results` 按 `scanNativeUpdateResults` 的规则自己读结果文件：只认文件名 `.electrobun-update-<32 位十六进制>.result.json`、普通文件、不超过上限，内容按 `validateNativeUpdateResult` 的字段与 `success` 等于 `phase === "complete"` 校验，不合格的跳过；不写、不删这些文件，也不写“已观察”标记。
  - 受管安装的判断：`Updater.appDataFolder()` 能取到，即程序在 `%LOCALAPPDATA%\<identifier>\<channel>\app\` 下。取不到的当便携或开发构建，不建安装级文件。
  - 状态文件的读写；`before-quit` 按核心阶段放行；焦点事件与桥的新消息；“打开下载页”用 `Utils.openExternal`。
- `electrobun.config.ts`：
  - `release.baseUrl` 缺省 `https://github.com/notnotype/neuro-book/releases/latest/download`；
  - `release.generatePatch: true`；
  - 构建时环境变量覆盖：`NBOOK_UPDATE_BASE_URL`（本地更新源）、`NBOOK_DESKTOP_IDENTIFIER`（测试包用另一个应用标识，隔开安装目录与 WebView 数据；缺省状态根 `%LOCALAPPDATA%\NeuroBook` 不随标识变，隔离靠验收前的检查，见“验证”）。
- 版本的来源（第 13 条、第二轮第 8 条）：产品版本只有两处，`src/shared/product.ts` 的 `PRODUCT_VERSION` 与 `packages/neuro-book/package.json` 的 `version`，`product.test.ts` 核对两者相同；应用包（`scripts/pack-app.ts`）、壳的 `bundle/version.json`（`desktop/scripts/build.ts`）、服务端与网页都取 `PRODUCT_VERSION`。所以测试构建不加 `--version` 参数，而是在独立的检出副本里把这两处一起改成测试版本、跑 `product.test.ts`，再按正式的发布链从头构建。改了 package.json 的版本还要 `bun install` 刷新根 `bun.lock` 里的工作区版本，否则 `release:smoke` 报依赖与 bun.lock 不一致（切片 5 实测；t11 的发布版本号改动同样要带上 bun.lock）。构建后核对：壳的 `version.json`、`nbook --version`、服务端 hello 里的版本、应用包清单，四处都是这个测试版本。
- 下载页：`https://github.com/notnotype/neuro-book/releases/latest`。

## Spec 与文档改动

- desktop-update 的合同按方向 A 已改（2026-11-14，提交 `8f93ab879`）：
  - 术语“安装的使用与换上”；
  - 输出 4 的不确定进度；
  - 输出 7 的“旧的不再换上”；
  - 输出 8 的发起与失败；
  - 时序、失败表与场景 4。
- 实现后补实现合同：`update.ts`、状态文件与锁文件、适配层的更新器用法。
- desktop-shell：启动页加“正在更新到 X”，启动错误加“另一个 NeuroBook 正在更新”（重试、退出）。
- nb-flock README：共享锁。
- 待确认清单：
  - 下载进度不确定；
  - 状态文件与锁放通道根；
  - 拿不到共享锁时等至多 30 秒，之后报启动错误（重试、退出），不无锁启动；
  - 换上结果读更新器结果文件（固定版本的私有格式）；没有结果时看换上程序的进程，在就算进行中，不在且发起已过 2 分钟算失败；
  - 发起换上后、对账出终态前不检查更新，运行中每 30 秒重判；
  - 手动重装（本地哈希既不是原来的也不是目标）时清掉 `attempt` 与 `downloaded`，不提示；
  - 停止中还没下完的下载不等，下一次重新提示；
  - 测试包用另一个应用标识；自动更新验收与正式安装共用缺省状态根（Windows 开发机上已有这个目录，开发者定直接用）。

## 切片

1. **nb-flock 共享锁**，带测试。提交。
   验证：`cd packages/nb-flock && bun test`。
2. **核心**：`update.ts`（控制器与 `applyAtStartup`）、`shell.ts` 接入、`windows.ts` 的焦点与重发，带测试。提交。
   验证：`bun test src/desktop`。
3. **桥与页面**：`desktop-bridge.ts` 的新消息、`window.ts` 的通知门禁与 `notifications()`、`desktop-updates.ts`、宿主文案、`boot.ts` 与 `mount.ts` 的就绪接线。提交。
   验证：`desktop-bridge.test.ts`、`window.test.ts`、`desktop-updates` 的测试、`e2e/desktop-update.e2e.ts`。
4. **适配与构建**：`index.ts`、`electrobun.config.ts`、`scripts/build.ts` 传覆盖地址。提交。
   验证：打包主进程。
5. **Windows 验收**：Windows 开发机上起固定端口的本地更新源，同一地址构建 A、B、C，跑 desktop-update 场景 1 到 7。证据按“验证”一节的 Windows 部分（界面用 UI 自动化读文字，不按区域截屏；更新的不变量看状态文件、结果文件、请求日志与进程）。提交 Spec 与证据。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| desktop-update 输出 1、2、3、5、6、7、9、10，状态表 | `update.test.ts` 的控制器部分（要点 1） |
| desktop-update 输出 8、9、场景 4 的锁、状态与对账 | `update.test.ts` 的 `applyAtStartup` 与 `reconcileAtStartup`（要点 2）；`shell.test.ts`：换上在取桌面锁之前，取锁之后到就绪之前的退出请求被否决并有序停止 |
| desktop-update 输出 3、4 的重发 | `windows.test.ts`（要点 3） |
| browser-host 输出 11 | 窗口测试与 `e2e/desktop-update.e2e.ts`（要点 4） |
| desktop-update 场景 1 到 7 | Windows 开发机上的真实安装与本地更新源 |

测试要点：

1. 更新器与提示用测试实现，形状照适配层，时间用手动时钟：
   - 启动时检查与每 24 小时，进入停止中后不再检查、不再提示；
   - 在途下载在 `stop()` 之后、`close()` 之前完成时写进“已下载”，`close()` 之后完成时丢掉；
   - 失败只写日志；
   - 版本解析：低于、等于本地，预发布，缺版本号，`2`、`v2.0.0`、`02.0.0`、尾部换行、带构建元数据；
   - “以后”只压这个版本，更高版本照常提示；
   - 下载前重新检查：目标变了改提示新版本，降级了不下载；
   - 下载失败后目标移动与重试；
   - 已下载后只在更高时提示；失败与被取代的不算基线；只提示模式只比本地；
   - 失败名单与被取代名单各走一遍：自动换上被挡住，明确重新下载并成功后解除，下一次启动确实发起；下载失败时不解除；
   - 有未对账的 `attempt` 时不检查；
   - 三种可关闭提示在关闭后的中心动作（`download`、`retry`、`open-page`），以及被新阶段取代后旧 id 的同一动作被拒；
   - 一次性提示收到 shown 后从状态里清掉。
2. 真实 nb-flock、真实状态文件，另起真实子进程持锁：
   - 有人在用不发起换上；
   - 独占拿到后重读状态，别人刚换过就不换；
   - 同步失败（`{failed}`）：照常启动、记失败、下次不再换；
   - 对账表的六行各一例（含 2 分钟的边界、进程查不了按“还在”），运行中 30 秒重判：换上程序晚于产品窗口写出失败结果、它重新启动的旧版本被转交，这次运行里通知“更新没有完成”并恢复检查（结果文件按 Electrobun 2.0.6 的格式写成夹具），另加：新版本起来后崩溃再打开仍是成功；`pendingNotice` 的 `forHash` 不是本地时清掉不显示；没有窗口的壳不消费通知；
   - 结果文件：文件名不合、内容不合、`success` 与 `phase` 矛盾、修改时间早于 `attempt.at` 的都不算；
   - 共享锁被独占挡着：每秒重试，持有者退出后接着启动；持有者一直不放（暂停的子进程）超过 30 秒时报启动错误，服务端与窗口都没起来，“重试”之后持有者退出就能启动；
   - 单写者：默认状态根与设了环境变量的两个真实壳进程并存，只有前者写过状态文件；
   - 便携版不建、不读安装级文件；
   - 状态文件截断、坏 JSON、没有权限时按“没有可换的”处理并写日志。
   - 适配层：`downloadUpdate()` resolve 之后 `updateInfo` 为失败（`updateReady` 为假、`error` 有字）、哈希不是目标时都报失败；`apply` 只看调用之后新增的状态记录。
3. `windows.test.ts`：
   - 交给最近焦点的就绪窗口；
   - 持有窗口关掉、刷新、离开就绪时转交并对旧窗口发 end；
   - 新开窗口不夺走提示；
   - 两个就绪交错；
   - 正在关的窗口不选；
   - 没有就绪窗口时等。
   `update.test.ts` 另测：`later` 之后仍接受这个 id 的选择；一次性提示收到 shown 后不再转交；旧 id 与不符的选择被忽略。
4. 窗口测试与 `e2e/desktop-update.e2e.ts`（假壳记下页面回的消息序列）：
   - 七种提示各成表里的形状；
   - 场景 7 整条链：关掉弹出、回 `later`，中心里点“下载”、回 `download`，刷新后不再弹出；
   - 通知视图开着时只进中心；
   - `page-ready` 在界面挂好之后、每个实例一次，在线与离线的变化不重发；
   - 离开就绪发 `page-gone`；
   - 就绪前来的提示被缓冲；
   - 关窗询问进行中来提示。

## 验证

- 每片跑上面列的测试；收口跑 `bun run test:affected` 与 `governance:check`。
- e2e：合入前跑 `e2e/desktop-update.e2e.ts` 与 `e2e/desktop-close.e2e.ts`。
- Windows：Windows 开发机 恢复后做（第 13、15 条）：
  - 在三个独立检出副本里把版本改成 `0.90.1`、`0.90.2`、`0.90.3`；
  - 测试应用标识、固定端口的 `http://127.0.0.1:<端口>`（先探测空闲）作 `release.baseUrl`；
  - 交替构建与发布：构建 A、发布 A、构建 B（生成补丁）、发布 B、构建 C；发布时先传 tar.zst 与 patch，最后传清单；
  - 经 Setup 装进受管目录；
  - 数据隔离（第三轮第 2 条）：自动更新只在不设 `NBOOK_STATE_ROOT` 时生效，测试包因此用缺省状态根 `%LOCALAPPDATA%\NeuroBook`，与正式安装共用。Windows 开发机上这个目录已经存在，开发者 2026-11-14 定直接用它（选项 C：里面没有要保护的真实数据）。开始前仍核对没有别的 NeuroBook 在跑；验收中记下每个 UI 所属进程的路径与版本，结束后列出这个目录里测试建出的内容，交开发者决定是否删；
  - 证据除 UI 自动化读的文字外，另记：状态文件、更新器的结果文件、`version.json`、壳日志、更新源的请求日志（走了补丁还是完整包）。
- 未验证边界：
  - GitHub `latest/download` 的重定向与更新器取清单时追加的查询串要等第一次真实发布。交给 t11 作发布完成的门禁（第 16 条、第二轮第 10 条），t11 的计划照抄：
    - 公开资产之后、宣布发布完成之前，照更新器的取法各发一次 GET：清单是正式 baseUrl 下的 `stable-win-x64-update-v2.json?<16 位十六进制>`（Electrobun 2.0.6 `checkForUpdateOperation`：查询串只有随机的十六进制、没有参数名；404 时退回 `-update.json`）；补丁与完整包带另一种查询串：`stable-win-x64-<上一版哈希>.patch?cache=<32 位十六进制>`、`stable-win-x64-NeuroBook.tar.zst?cache=<32 位>`；下一次构建时 Hutch 取上一版也用 `?cache=<32 位>`（`stable-win-x64-update.json` 与 tar.zst）。两种都要发。跟随重定向（至多 5 跳）拿到 200、长度与清单一致（2026-11-14 切片 4 核对源码时改正清单的查询串，切片 5 在 Windows 上看请求日志补上补丁、完整包与构建时的查询串，见 [windows-update-r1.txt](evidences/windows-update-r1.txt)）；同时用装好的这一版做一次检查，壳日志里是“没有更新”而不是检查失败；
    - 证据存 `version.json` 里的 baseUrl、请求与应答头；
    - 不通过：不标发布完成，Release 说明不写“自动更新可用”，停下交开发者（baseUrl 发出后改不了，只能另发一版修）；
    - 真正的下载与换上要有上一个正式桌面版才能走，按 Spec 的 Smoke 在第二个正式版时补；
  - 新版本起来后崩溃的情形更新器不回滚，我们也不处理（Spec 没要求）。

## 不做与风险

- 不做更新频道、预发布、关闭自动检查（Spec 非目标）。
- 更新器的私有文件只读结果文件这一种（终态没有别的可靠来源）；“有没有可换的”看我们自己的状态文件，不读准备记录，真正能不能换由更新器在 `applyUpdate` 里自己校验，校验不过就是同步失败。
- 风险：`applyUpdate` 在窗口创建之前调用时的退出时序没有实测证据（调研第 3 节），Windows 验收第一个就测它；不行就先开启动页窗口再换。
- 风险：适配层判断 `exiting` 依赖更新器状态记录里“正在启动新版本”这一项；Windows 验收核对它与真实退出的先后。
- 已知限制（方向 A）：换上进行中又打开旧程序会让这次换上失败、还原，用户看到“更新没有完成”，下一次再换。
