# t10 计划：桌面版自动更新

## Context

装好的桌面版要自己发现新版本、经用户同意后下载、下次启动时换上，只升不降；便携版与设了 `NBOOK_STATE_ROOT` 的启动只提示。合同是 [`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md) 输出 1 到 10 与场景 1 到 7（t06 写成，planned），以及：
- [`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 11：页面把壳交来的提示交给工作台显示、把选择交回壳；
- [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 13。

依据提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 4.6、ADR 0051 决定 6；开发者 2026-11-13 定了只升不降、不签名。t06 的待确认条目：提示只有一个动作“下载”、关闭即“以后”、已下载至多一份、`NBOOK_STATE_ROOT` 与便携只提示。

工作方式：autonomous-delivery，代码在 Work 分支 `feat/w00046-desktop-release`。Windows 验收要 pc-notype（11 月 13 日 17:05 起离线），核心逻辑在 Linux 上用测试把关。

更新器的真实行为见 [调研](evidences/electrobun-updater-research.txt)，计划依赖其中几条：
- 只比哈希；
- 下载没有百分比、下载前删旧的；
- `applyUpdate()` 自己退出进程，新版本不继承环境；
- 换上结果下次启动时对账；
- baseUrl 只能在构建时定。

## 技术选型

- 更新：Electrobun 2.0.6 的 `Updater`（ADR 0051）。它的下载、补丁链、换上与回滚都用现成的，不另写。
- 版本比较：`Bun.semver.order`（Bun 自带），只认稳定版本号（不含 `-` 预发布段），不另引库。
- 安装级的“在用”与“换上”：nb-flock 加共享锁模式（`flock` 的 `LOCK_SH`、`LockFileEx` 不带独占标志），一把锁文件、进程退出即放。否决：
  - 每个壳一把独占锁、换上时逐个探测：探测与新启动之间有竞态；
  - 按过期判旧的锁（proper-lockfile）：壳暂停久了会被误判为不在用。
- 页面显示：工作台通知服务（`notificationsKey`，t09 加了 `onClose`）。

## 关键设计

### `packages/nb-flock`

- `tryLock(path, options?: {shared?: boolean})`：共享时 Linux、macOS 用 `flock(LOCK_SH | LOCK_NB)`，Windows 用 `LockFileEx(LOCKFILE_FAIL_IMMEDIATELY)`（不带 `LOCKFILE_EXCLUSIVE_LOCK`），锁同一个字节范围。返回值与独占相同。README 补一节。
- 测试（真实子进程）：两个共享都拿到；有共享时独占拿不到；有独占时共享拿不到；持有者退出后都能拿到。

### `packages/neuro-book/src/desktop/update.ts`（新增，核心，不依赖 Electrobun）

端口：
- `UpdaterPort`：
  - `localVersion`；
  - `check()` → `{ok: true, version, hash} | {ok: false, error}`；
  - `download()` → `{ok: true} | {ok: false, error}`；
  - `prepared()` → `{version, hash} | null`：读更新器的已准备记录，离线可读；
  - `apply()`：只在失败时返回 `{error}`，成功时进程随即退出；
  - `onResult(listener)`：上次换上的对账结果，`complete` 或 `failed` 带版本；
  - `downloadPageUrl`。
- `HintPort`：把提示交给“最近一次获得焦点的产品窗口”、撤回提示；由 `WindowCoordinator` 记最近焦点、窗口关掉或页面重新就绪时重发（下面“窗口”一节）。

`UpdateController`（输出 1 到 7、9、10）：
- 模式：`auto`（安装版，没设 `NBOOK_STATE_ROOT`）或 `notify-only`（便携、设了环境变量）。
- 时机：壳进入运行中后检查一次，之后每 24 小时一次；计时用注入的 `DeadlineClock`（`at` 分段）。
- 判定：远端版本须是稳定版本号且高于本地，有已下载的更新时还须高于已下载的版本。检查失败只写壳的日志。
- 状态：空闲、提示中、下载中、已下载，转换按 Spec 的状态表。“以后”只对这次运行里的同一个版本生效。
- 下载：
  - 选“下载”时调 `download()`；下载期间的提示是不确定进度（更新器不给百分比）。
  - 失败时重新 `check()`：远端更高就按新版本提示，同一版本就提示“没有下载成功”加“重试”。
  - 成功后提示“已下载，下次打开时安装”。
- 显式下载会清掉“换上失败”的记录（见下一节）。
- 对账结果：`complete` 在第一个产品窗口提示“已更新到 X”（输出 9）；`failed` 提示“更新没有完成”（输出 8）。

### 启动时换上：`src/desktop/shell.ts` 与 `update.ts` 的 `applyAtStartup`

在 `run()` 里、取桌面锁之前（输出 8）。安装级文件放在通道根（`%LOCALAPPDATA%\<identifier>\stable\`，换上时 `app` 目录整个被替换，不能放在里面）：

- `nbook-install.lock`：在用的壳持共享锁，换上的壳持独占锁；
- `nbook-updating.json`：换上进行中的标记，写着目标版本与时刻；
- `nbook-update-failed.json`：换上失败过的哈希。

步骤：
1. 读标记。
   - 标记的版本等于本地版本：我就是刚换上的新版本，删标记，接着走。
   - 标记的版本不等于本地版本、且不到 5 分钟：启动页显示“正在更新”，然后以 0 退出。
   - 超过 5 分钟：当作上次换上没走完，删掉，接着走。
2. 只提示的启动、没有已准备的更新、已准备的版本不高于本地，或它的哈希在失败记录里：不换。
3. 要换：试独占锁。
   - 拿不到（有人在用）：不换。
   - 拿到：写标记，启动页显示“正在更新到 X”，调 `apply()`。
     - 返回失败：删标记，放独占锁，写日志，记下失败的哈希，启动照常走，第一个产品窗口里提示“更新没有完成”。
     - 成功：进程由更新器退出。
4. 不换时取共享锁，持有到进程退出。拿不到共享锁说明别人正在换：显示“正在更新”，以 0 退出。

这一步在 `before-quit` 否决处理器生效之前（适配层先做这一步再注册否决），否则 `applyUpdate` 的退出请求会被壳自己拦下。

失败记录的作用：换上失败后，同一个已准备的更新不在每次启动时反复尝试。重新检查后用户再点“下载”时，更新器复用这份准备好的更新，我们清掉失败记录，下次启动再试（输出 8 的“丢弃”由此实现，见“Spec 与文档改动”）。

### 页面与壳之间：更新提示（`src/shared/desktop-bridge.ts`、`src/web/host/`）

- 桥加三种消息：
  - 壳到页面 `{type: "update-hint", id, hint}` 与 `{type: "update-hint-end", id}`；
  - 页面到壳 `{type: "update-choice", id, choice}` 与 `{type: "page-ready"}`。
- `hint` 的种类：`available`、`notify-only`（带 `stateRootEnv` 标志）、`downloading`、`downloaded`、`download-failed`、`updated`、`update-failed`，都带版本。
- `choice`：`download`、`later`、`open-page`、`retry`。
- 新文件 `src/web/host/desktop-updates.ts`：
  - 窗口就绪后经运行实例取工作台的 `notificationsKey`，把提示按种类发成通知，文案在宿主目录 `nbook.host` 的 `update.*`；
  - 通知的动作与 `onClose` 交回 `update-choice`；同一个 `id` 再来时用 `update()` 改那条通知；`update-hint-end` 时 `dismiss()`；
  - 页面就绪时发 `page-ready`，壳据此重发还没处理的提示。
  - 不就绪的窗口（加载页、宿主页）不显示更新提示（Spec“通知只在产品窗口里出现”），壳会在下一个就绪的窗口里发。
- 页面里的插件拿不到这些（输出 11）。

### 壳的窗口：最近焦点与重发（`src/desktop/windows.ts`）

- `WindowCoordinator` 记各产品窗口的焦点顺序（适配层送 `focused(id)`）与 `pageReady(id)`。
- `UpdateController` 经 `HintPort.deliver(hint)` 交提示：协调器把它交给最近焦点的、页面已就绪的产品窗口；那个窗口关掉、或页面重新就绪（刷新）时，还没处理的提示重发到当时最近焦点的就绪窗口。

### Electrobun 适配与构建（`desktop/`）

- `desktop/src/bun/index.ts`：
  - `UpdaterPort` 接 `Updater`：`check` 用 `checkForUpdate()`，`download` 用 `downloadUpdate()`，`prepared` 读 `<appDataFolder>/self-extraction/.electrobun-prepared-update.json` 并核对暂存目录存在，`apply` 用 `applyUpdate()`，`onResult` 用 `onStatusChange` 的 `complete` 与 `error`，启动早期注册；
  - 焦点事件、桥的三种新消息；
  - “打开下载页”用 `Utils.openExternal`。
- `electrobun.config.ts`：
  - `release.baseUrl` 缺省 `https://github.com/notnotype/neuro-book/releases/latest/download`；
  - 构建时环境变量 `NBOOK_UPDATE_BASE_URL` 可覆盖，给本地测试用；
  - `release.generatePatch: true`。
- 下载页：`https://github.com/notnotype/neuro-book/releases/latest`。

## Spec 与文档改动

- desktop-update：
  - 输出 4 写明下载进度是不确定进度（更新器不给百分比）；
  - 输出 8 的“丢弃这份已下载的更新”改为“不再自动换上这份更新；重新检查后用户再选下载时，复用它或下载新的”；
  - 实现合同写 `update.ts`、安装级的三个文件、适配层的更新器用法。
- desktop-shell：启动页加“正在更新”两种状态。
- nb-flock README：共享锁。
- 待确认清单：
  - 下载进度为不确定进度；
  - 换上失败后不删更新器的已准备更新，改为记失败哈希；
  - 换上标记 5 分钟算过期；
  - 安装级锁放通道根。

## 切片

1. **nb-flock 共享锁**，带测试。提交。
   验证：`cd packages/nb-flock && bun test`。
2. **核心**：`update.ts`（控制器与 `applyAtStartup`）、`shell.ts` 接入、`windows.ts` 的焦点与重发，带测试。提交。
   验证：`bun test src/desktop`。
3. **桥与页面**：`desktop-bridge.ts` 的新消息、`desktop-updates.ts`、宿主文案、`boot.ts` 接线。提交。
   验证：`desktop-bridge.test.ts`、`desktop-updates` 的窗口测试、`e2e/desktop-update.e2e.ts`（假壳派发提示，看通知与回交的选择）。
4. **适配与构建**：`index.ts`、`electrobun.config.ts`、`scripts/build.ts` 传覆盖地址。提交。
   验证：打包主进程。
5. **Windows 验收**：pc-notype 上起固定端口的本地更新源，同一地址构建 A、B、C，跑 desktop-update 场景 1 到 7。证据只用 UI 自动化读文字。提交 Spec 与证据。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| desktop-update 输出 1、2、3、5、6、7、9、10，状态表 | `update.test.ts` 的控制器部分（要点 1） |
| desktop-update 输出 8、场景 4 的锁与标记 | `update.test.ts` 的 `applyAtStartup`（要点 2）；`shell.test.ts`：换上在取桌面锁之前 |
| desktop-update 输出 3、4 的重发 | `windows.test.ts`（要点 3） |
| browser-host 输出 11 | 窗口测试与 `e2e/desktop-update.e2e.ts`（要点 4） |
| desktop-update 场景 1 到 7 | pc-notype 上的真实安装与本地更新源 |

测试要点：

1. 更新器与提示用测试实现，形状照适配层，时间用手动时钟：
   - 启动时检查与每 24 小时；
   - 失败只写日志；
   - 远端低于、等于本地，预发布版本，缺版本号；
   - “以后”只压这个版本，更高版本照常提示；
   - 下载失败后目标移动与重试；
   - 已下载后只在更高时提示；
   - 只提示模式与“打开下载页”；
   - 对账结果的两种提示。
2. 真实 nb-flock、真实文件，另起真实子进程持锁：
   - 有人在用不换；
   - 换上中再启动，显示“正在更新”后退出；
   - 标记过期；
   - 新版本删标记；
   - `apply` 失败后照常启动、记失败哈希、下次不再换；
   - 显式下载清掉失败记录。
3. 提示交给最近焦点的就绪窗口；窗口关掉或刷新时重发；没有就绪窗口时等。
4. 提示变成通知；关闭回 `later`，“下载”回 `download`；同一 id 再来时更新、结束时撤下；就绪时发 `page-ready`；加载页不显示。

## 验证

- 每片跑上面列的测试；收口跑 `bun run test:affected` 与 `governance:check`。
- e2e：合入前跑 `e2e/desktop-update.e2e.ts` 与 `e2e/desktop-close.e2e.ts`。
- Windows：pc-notype 恢复后做。依次构建 A、B、C，`release.baseUrl` 用固定端口的 `http://127.0.0.1:<端口>`；发布顺序先传 tar.zst 与 patch，最后传清单。
- 未验证边界：
  - GitHub `latest/download` 的重定向与更新器追加的 `?cache=` 参数要等第一次真实发布（t11）；
  - 新版本起来后崩溃的情形更新器不回滚，我们也不处理（Spec 没要求）。

## 不做与风险

- 不做更新频道、预发布、关闭自动检查（Spec 非目标）。
- 风险：读更新器的私有文件 `.electrobun-prepared-update.json`，Electrobun 升级可能改格式。由适配层的读取函数与 Windows 实测把关，Electrobun 版本固定在 2.0.6（ADR 0051）。
- 风险：`applyUpdate` 在窗口创建之前调用时的退出时序没有实测证据（调研第 3 节），Windows 验收第一个就测它；不行就先开启动页窗口再换。
