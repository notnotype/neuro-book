---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: runtime.cli
owners:
  - application-runtime
---

# `nbook` 命令行

## 目标与非目标

`nbook` 是随应用发布的命令行，给用户与 Agent 用：在前台启动本地服务端并打开浏览器，状态根上已有实例时打开它；离线管理第三方插件（安装、启停、卸载，下一次启动生效）。服务端本身的启动、停止与实例认领见 [`runtime.server-host`](server-host.md)；插件的安装语义见 [`runtime.plugin-install`](plugin-install.md)。插件作者的命令 `nbooke` 在 SDK 包里，不属于本 Spec。

不承诺：

- 不在后台运行：`nbook start` 在前台运行，终端拥有服务的寿命；后台运行（注册成系统服务，`nbook service …`）另行设计。
- 没有停止、查询状态、作品管理、配置的子命令。
- 插件子命令不连运行中的服务端：只写登记表，变化在服务端下一次启动生效；不支持从 npm 包名或 tarball 安装，只收本地目录。
- 不替用户选状态根之外的目录（作品目录见 [`runtime.projects`](projects.md)）。
- 已知限制：Windows 与 macOS 上未实测（状态根缺省由单元测试覆盖）；Windows 没有 SIGTERM 与 SIGHUP，`nbook start` 只能在它自己的控制台里按 Ctrl-C 有序停止，关掉控制台窗口不保证有序停止；Bun 低于最低版本时入口拦下，但 `npm` 与 `bun add` 安装时都不拦。

## 术语与参与者

- **状态根**：见 [`runtime.server-host`](server-host.md)。`nbook` 在命令行这一层定缺省值，服务端进程本身仍要求显式的状态根。
- **实例**：已认领某个状态根的服务端进程（[`runtime.server-host`](server-host.md) 的“实例认领”）；`nbook` 经认领套接字的 `hello` 应答知道它的种类、状态、版本与地址。
- **结果对象**：`--json` 时写到标准输出的那一个 JSON 对象。

## 输入与前置条件

- 运行在 Bun 上，版本满足应用包的 `engines.bun`；入口先核对，不满足时说明需要的版本、以 2 退出。
- **全局选项**（写在子命令前后都可以）：`--state-root <目录>`、`--json`、`-h, --help`、`-v, --version`。
- **状态根**：`--state-root` 优先（给了空串是用法错误，不回落到缺省），其次环境变量 `NBOOK_STATE_ROOT`（空串算没给），都没有时用平台的数据目录：

| 平台 | 缺省状态根 |
|---|---|
| Linux | `$XDG_DATA_HOME/neuro-book`；`XDG_DATA_HOME` 没设或不是绝对路径时 `~/.local/share/neuro-book` |
| macOS | `~/Library/Application Support/NeuroBook` |
| Windows | `%LOCALAPPDATA%\NeuroBook`；没有 `LOCALAPPDATA` 时 `~\AppData\Local\NeuroBook` |

  相对路径按当前目录解析。`start` 在状态根不存在时建出来；只读的命令（`plugin list`）不建。
- **子命令**：

| 命令 | 选项 | 作用 |
|---|---|---|
| `start`（不给子命令时就是它） | `--port <端口>`、`--rpc-port <端口>`、`--no-open`、`--safe-mode` | 前台运行服务端；已有实例时打开它。给了的端口被占用时启动失败，不顺延 |
| `plugin list` | 无 | 列出内置与第三方插件 |
| `plugin install <目录>` | `--yes` | 安装或升级一个本地插件目录 |
| `plugin enable <id>`、`plugin disable <id>` | 无 | 启用、禁用 |
| `plugin uninstall <id>` | 无 | 卸载，保留插件的私有数据 |

- 端口是 0 到 65535 的整数，0 表示由系统分配。只给 `--port` 时 RPC 端口取它加 1（`--port 0` 时也是 0）；都不给时沿用服务端的缺省与成对顺延。`--safe-mode` 等于以环境变量 `NEURO_BOOK_SAFE_MODE=1` 启动（[`runtime.plugin-install`](plugin-install.md) 的安全模式）。
- 应用包另带服务端的托管入口 `server/main.js`，给桌面壳这类托管宿主用，合同见 [`runtime.server-host`](server-host.md) 的“托管宿主”；`nbook` 不经它。桌面版与 `nbook` 共用这里的状态根缺省（[`runtime.desktop-shell`](desktop-shell.md)），桌面壳起的服务端对 `nbook start` 来说是同种类的已有实例。
- Web 产物在应用包里 `nbook.js` 旁的 `../web`；环境变量 `NBOOK_WEB_ROOT` 给出时用它。其余服务端环境变量（`NBOOK_HOST`、项目时限等）照常生效。

## 输出与可观察行为

1. **输出约定。** 命令的结果写标准输出，提示与诊断写标准错误。`--json` 时标准输出只有一个结果对象：成功 `{ok: true, ...}`，失败 `{ok: false, code, message, ...}`；提示照常写标准错误。文本模式的失败写一行 `nbook：<说明>` 到标准错误。
2. **退出码。** 0 成功；1 失败；2 用法错误（不认识的命令或选项、缺参数、参数不合法、Bun 版本过低、需要确认而没有 `--yes`）。`start` 运行服务端时以服务端的退出码结束（0、1、75、76，见 [`runtime.server-host`](server-host.md)）。
3. **用法错误。** 拼错的子命令报“不认识的命令 <它>”与可用的命令或最接近的那个；不认识的选项、缺少的参数、多余的参数同样说明并以 2 退出，带码 `usage`；命令组（`plugin`）不跟子命令时写出它的帮助并以 2 退出。`--help` 与 `help [命令]` 正常结束（0），子命令的帮助也列出全局选项。帮助与错误说明是中文。
4. **版本。** `--version` 打印产品版本、Bun 版本与缺省状态根，以 0 退出。
5. **start：没有实例。** 认领状态根，在本进程里运行服务端（不打印服务端的 `Listening on` 两行，项目子进程转发来的输出写标准错误，标准输出只留给结果）。运行实例可用（health 返回 200）之后：文本模式打印“NeuroBook 已启动：<地址>”与状态根；`--json` 时写结果对象 `{ok: true, url, rpcUrl, pid, version, stateRoot, started: true}`；标准错误提示“按 Ctrl-C 停止”。然后打开浏览器（见第 9 条）。Ctrl-C（SIGINT）、关闭终端（SIGHUP）与 SIGTERM 都走服务端的有序停止。 停止结算之后在标准错误写“NeuroBook 已停止。”（退出码不是 0 时带上退出码与日志目录）；启动失败时不写这句。
6. **start：已有实例在运行。** 实例已就绪时报告它（`started: false`，`pid` 是那个实例的），打开浏览器，以 0 退出；给了 `--port` 或 `--rpc-port` 时提示“已有实例，忽略这两个选项”；给了 `--safe-mode` 而那个实例不是以安全模式运行时，提示先停掉它再以安全模式启动。
7. **start：已有实例在启动或停止。** 提示一行“正在启动，等它就绪”或“正在停止，等它停完”，然后等：启动中的就绪后按第 6 条报告；停止中的停完后按第 5 条自己启动。60 秒内没有变化时以 1 退出，码 `instance-busy`。几个 `nbook start` 同时运行时恰好一个启动，其余报告它。
8. **start：已有实例不能用。** 以 1 退出，不碰那个实例：开发服务占着（码 `development-instance`）；版本与本命令不同（码 `version-mismatch`，结果对象带 `running` 与 `installed`，提示先停掉运行中的服务）；连上了但没有应答（码 `instance-unresponsive`）。状态根不可写（码 `state-root-unwritable`）、认领的其它失败（码 `claim-failed`）同样以 1 退出；服务端配置不合法（例如端口加 1 越界）以 2 退出，码 `config-<服务端的码>`。自己运行的服务端启动失败（例如 Web 产物不存在、端口被占）时以 1 退出，码 `startup-failed`，结果对象带 `causes`（每个失败入口的 `source`、`reason`、`message`），说明里写第一条原因；服务端的致命诊断照样写标准错误。启动中按 Ctrl-C 不算启动失败。
9. **打开浏览器。** 用系统的默认浏览器打开“启动时打开”的路由（地址加 `api/nbook.projects/resume`，[`runtime.projects`](projects.md) 输出 23：进上次的作品或书架）；打印出来的仍是根地址。`--no-open` 时不打开。SSH 会话（有 `SSH_CONNECTION` 或 `SSH_TTY`）里不打开，提示用 `ssh -L <端口>:127.0.0.1:<端口>` 转发；Linux 上没有图形会话（`DISPLAY` 与 `WAYLAND_DISPLAY` 都没有）时不打开并提示。打不开时只提示，不算失败。地址总是打印出来。
10. **plugin 子命令的离线语义。** 不经服务端，直接用插件管理读写状态根的插件登记表（与插件页同一套操作与失败码，[`runtime.plugin-install`](plugin-install.md)）；服务端运行时同时写安全（登记表的写入锁）。结果只说目标状态，并写明“重启服务后生效”。有运行中的实例时，以它 `hello` 应答里的本次启动集合计算待生效的变化，与插件页的列表一致；没有实例时按重启后的目标状态列出。
11. **plugin list。** 列出内置与第三方插件：id、版本、来源、启用与否、待生效的变化、没有登记的原因（清单无效、入口文件缺失、不兼容、安全模式；离线就能算出）。服务端运行时的入口失败只有服务端知道，列表末尾给出日志目录。`--json` 时结果对象是 `{ok: true, safeMode, running, plugins: [...]}`，`running` 是运行中实例的 pid 与地址或 null。
12. **plugin install。** 参数是本地目录（相对路径按当前目录）。先预览：打印“插件完全信任”的说明、与已装版本的关系（新装、升级、降级）、重启后会受阻的插件与没核对的插件。降级或有插件会受阻时要 `--yes`，没有就以 2 退出、码 `confirmation-required`，说明要加的参数；其余情形执行命令本身就算确认。成功后说明写入了哪个状态根、“重启服务后生效”；`--json` 时结果对象是 `{ok: true, preview, plugin, stateRoot, restartRequired: true}`，`preview` 是预览（`id`、`version`、`installed`、`relation`、`blocked`、`unchecked`），`plugin` 是这个插件的目标状态；`confirmation-required` 的失败对象也带 `preview`。失败码原样给出；`manifest-invalid` 逐条列出出错的字段（失败对象带 `problems`）；路径不存在或不是目录时提示确认路径、传 `nbooke build` 构建出的 `dist` 目录；`already-installed` 提示开发中用 `nbooke build --dev` 出新的开发版本号。
13. **plugin enable、disable、uninstall。** 对内置插件得到 `builtin-fixed`，对没装的得到 `not-installed`；重复启用、重复禁用照样成功。卸载保留插件的私有数据。`--json` 时结果对象是 `{ok: true, plugin, restartRequired: true}`。

## 状态与转换

`start` 每一轮问一次状态根上的实例：

| 问到 | 做什么 |
|---|---|
| 没有实例 | 认领；认领到就运行服务端；被别人抢先认领了就进下一轮 |
| 就绪的产品实例，版本相同 | 报告并打开它，以 0 退出 |
| 启动中或停止中的产品实例，版本相同 | 提示后等，进下一轮（至多 60 秒） |
| 开发实例、版本不同、没有应答 | 以 1 退出 |

时序与寿命：

- 结果对象在运行实例可用之后才写出；写出时 `url` 已能打开、health 返回 200。
- `start` 自己运行的服务端停止后，进程以服务端的退出码结束；认领随之放下，下一次 `start` 立即可以认领。
- 已有实例时 `start` 不改变它，只读它的应答。

## 副作用与数据

- `start` 建出缺省状态根（没有时），其余数据由服务端写（[`runtime.server-host`](server-host.md)）。
- 插件子命令写状态根的 `plugins/` 下的登记表与安装目录，诊断写状态根的日志目录。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `usage` | 用法错误（以 2 退出） | 按说明改参数 |
| `bun-too-old` | Bun 低于最低版本（以 2 退出） | `bun upgrade` |
| `development-instance` | 状态根正由开发服务使用 | 用开发服务的页面，或换一个状态根 |
| `version-mismatch` | 运行中的实例版本不同 | 停掉它（在它的终端按 Ctrl-C）再启动 |
| `instance-unresponsive` | 实例连得上但不应答 | 结束那个进程后再启动 |
| `instance-busy` | 实例 60 秒内没有就绪或停完 | 看它的日志，稍后再试 |
| `state-root-unwritable` | 状态根不可写 | 换一个状态根或改权限 |
| `claim-failed` | 认领的其它失败 | 看说明 |
| `config-<码>` | 服务端配置不合法（以 2 退出） | 按说明改端口或环境变量 |
| `startup-failed` | 自己运行的服务端启动失败 | 按 `causes` 修（Web 产物、端口、插件），看状态根的日志 |
| `confirmation-required` | 降级或有插件会受阻，没有 `--yes`（以 2 退出） | 确认后加 `--yes` |
| 插件管理的失败码 | 见 [`runtime.plugin-install`](plugin-install.md) | 同插件页 |

## 边界与兼容

- 公开接口是命令、选项、退出码、失败码与结果对象的字段；字段只加不改。文本模式的措辞不是接口。
- 认领套接字上的 `hello` 应答是 [`runtime.server-host`](server-host.md) 的接口，`nbook` 只读它。
- 信任边界：插件以完全信任运行（[`runtime.plugin-install`](plugin-install.md)），`plugin install` 打印这一点；执行命令就算用户确认。

## 验收与 Smoke

1. **启动与再启动。** 在临时状态根上 `nbook start --json`：结果对象写出时 health 为 200、首页可取，“启动时打开”的路由 302 到书架（新状态根上没有上次的作品），浏览器打开的是这条路由；再运行 `nbook --json`（不给子命令）得到同一个 pid、`started: false`，浏览器再打开一次；对第一个发 SIGHUP，以 0 退出，状态根上不再有实例。
2. **不打开浏览器。** `--no-open` 与 SSH 会话里都不打开，SSH 时提示端口转发；SIGINT 以 0 退出。
3. **缺省状态根。** 不给 `--state-root` 与 `NBOOK_STATE_ROOT` 时，状态根是主目录下的平台数据目录，结果对象里的 `stateRoot` 就是它。
4. **等已有实例。** 状态根上的实例还在启动：`start` 提示后等，实例就绪后报告它；实例正在停止：`start` 等它停完后自己启动。
5. **不能用的实例。** 版本不同、开发服务占着：以 1 退出，码分别是 `version-mismatch`、`development-instance`。
6. **用法。** 拼错的命令、不认识的选项、越界的端口、空的 `--state-root` 以 2 退出、码 `usage`；`--version`、`--help`、`help <命令>` 以 0 退出。服务端启动失败时结果对象是 `startup-failed`、以 1 退出。
7. **插件。** 服务端运行时 `nbook plugin install` 一个用 `nbooke build` 构建的插件、`list --json` 列出待生效的安装，重启服务后插件页列出它；降级不带 `--yes` 以 2 退出。
8. **托管入口。** 从 tarball 装好的应用包里，以 `--stop-stdin` 运行 `server/main.js`：认领应答就绪后 `nbook start --json` 报告它（`started: false`、同一个 pid），页面打开书架（新状态根，经“启动时打开”的路由落到书架）；标准输入写 `stop` 或关闭标准输入都以 0 退出；同一状态根上再起一个以 1 退出、致命诊断是 `runtime.state-root.busy`。

Smoke：`bun test src/cli` 把命令行与项目宿主构建到临时目录，用真实进程运行场景 1 到 7（场景 7 用临时目录里只有清单的插件，以重启后的实例应答核对登记）；`e2e/app-package.e2e.ts` 用 `scripts/pack-app.ts` 打出的 tarball `bun add -g` 装上 `nbook`，在本机 Chrome 上跑场景 1 的启动与打开作品、场景 7 的安装与重启生效。`bun run release:smoke`（仓库根）用发布前打好的 tarball，在仓库外的临时 `BUN_INSTALL` 下装上应用，跑场景 1 的启动与打开书架、场景 8 的托管入口（装好的包与组装出的桌面载荷各一次），再用 `bunx -p` 装 SDK 生成插件，跑场景 7 的安装与重启生效；发布后 `--from registry` 对 registry 上的版本再跑一遍。

## 实现合同

- **实现 owner 与入口**：application-runtime。入口 `packages/neuro-book/src/cli/main.ts`（commander 的命令表、中文帮助与错误、退出码），打包成应用包的 `server/nbook.js`（与托管入口 `server/main.js` 一次打包、共用 chunk，`scripts/pack-app.ts`），应用包的 `bin` 指向它；`start.ts` 的 `start(context, options)`，`plugin.ts` 的 `listPlugins`、`installPlugin`、`setPluginEnabled`、`uninstallPlugin`，`state-root.ts` 的 `resolveStateRoot`、`defaultStateRoot`，`output.ts` 的 `CliFailure(code, message, exitCode)` 与 `createOutput(json)`。依赖方向：命令行依赖服务端的认领与进程入口（`src/server/instance.ts` 的 NeuroBook 认领档案，认领本身在 `@notnotype/nb-host/server`；`src/server/process.ts`）和插件平台的插件管理（`createPluginInventory`、`previewInstalledPlugins`），它们都不依赖命令行。
- **关键不变量**：
  - `start` 在本进程里运行服务端，不另起子进程：先认领状态根，认领到才运行；认领报 `running` 时回去问实例，不当作失败。
  - 状态根的缺省只在命令行这一层定，服务端进程仍要求显式的状态根；`--state-root` 的空串是用法错误，不回落到缺省。
  - 插件子命令与插件页用同一套插件管理与失败码，只写登记表、不连服务端；列表的待生效变化有实例时按实例应答里的启动集合算，没有时按下一次启动算。
  - commander 的错误不让它自己打印，按错误码换成中文、以 2 退出；`--json` 时标准输出只有一个结果对象，提示与诊断走标准错误。
- **合同测试**：`src/cli/cli.test.ts`（真实进程，命令行与项目宿主构建到临时目录：场景 1 到 7）、`src/cli/state-root.test.ts`（三个平台的缺省与取值顺序）；应用包 `scripts/pack-app.test.ts`（含场景 8 的标准输入结束、状态根被占用与打包时托管核对的失败分支）。
- **实际 smoke**：`bun test src/cli`；`e2e/app-package.e2e.ts`（`bun run test:e2e`）从 tarball 装上 `nbook`，在本机 Chrome 上跑场景 1 与 7；发布前后的 `bun run release:smoke`（`scripts/release/pack-smoke.ts`）在仓库外装上应用与 SDK 跑场景 1 与 7。

## 证据

- 批准依据：开发者 2026-10-24、2026-10-25 与 2026-10-27 的决定，见 [t15 第二期计划](../../../.agents/works/w00027-plugin-platform/tasks/t15-author-api-round2/plan-phase2.md) 的 Context（D1 到 D4）；[ADR 0033](../../adr/0033-app-delivered-as-built-npm-package.md)。
- 实现入口：[`main.ts`](../../../packages/neuro-book/src/cli/main.ts)、[`start.ts`](../../../packages/neuro-book/src/cli/start.ts)、[`plugin.ts`](../../../packages/neuro-book/src/cli/plugin.ts)、[`state-root.ts`](../../../packages/neuro-book/src/cli/state-root.ts)
- 合同测试：[`cli.test.ts`](../../../packages/neuro-book/src/cli/cli.test.ts)、[`state-root.test.ts`](../../../packages/neuro-book/src/cli/state-root.test.ts)、[`pack-app.test.ts`](../../../packages/neuro-book/scripts/pack-app.test.ts)
- Smoke：[`cli.test.ts`](../../../packages/neuro-book/src/cli/cli.test.ts)（`bun test src/cli`）、[`app-package.e2e.ts`](../../../packages/neuro-book/e2e/app-package.e2e.ts)（`bun run test:e2e`）、[`pack-smoke.ts`](../../../scripts/release/pack-smoke.ts)（`bun run release:smoke`）
