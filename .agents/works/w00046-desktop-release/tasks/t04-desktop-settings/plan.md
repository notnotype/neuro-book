# t04 计划：桌面专属设置（机制、界面缩放、开机自启）

r1，2026-11-15。

## Context

开发者 2026-11-15 列的“桌面端专属配置，例如：应用缩放”，加上 2026-11-13 列的“开机自启”。托盘与关窗去向在 t13、系统通知在 t14，它们都要用到这里建的机制：一组只在桌面里显示、壳能读到的配置项。

决定（[Work README](../../README.md) 的“桌面端体验的决定”）：
- Web 与桌面不建统一 facade，按能力分；
- 只有桌面有的东西，在壳不在时不出现。

依据：
- [`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)：声明、层、输出 22 的“本机层（planned）”；
- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)：分区；
- [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)：命令与键位；
- [`runtime/desktop-shell.md`](../../../../../docs/specs/runtime/desktop-shell.md)；
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 输出 11、12。

工作方式：autonomous-delivery。分支 `feat/w00046-t04-desktop-settings` 从 t03 的分支开出：要用 t03 的预加载与桥；t03 合入 master 后变基。

## 技术选型

- **壳读设置**：复用 `plugins/settings/shared/layer-text.ts` 的 `parseLayerText`（`jsonc-parser`，与设置的拥有者同一套解析规则），只交本插件的声明。
  - 否决“页面把值推给壳”：开机自启、启动时的缩放要在任何页面加载之前就知道。
  - 否决壳自己写一份 JSON 解析：注释、尾随逗号、重复键的规则会与拥有者不一致。
- **开机自启**：写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，用 `reg add`、`reg delete`（壳里已经这样查 WebView2）。否决计划任务：要更多权限与清理。
- **缩放**：Electrobun 的 `win.setPageZoom`（WebView2 的 `ZoomFactor`）；档位沿用 Chromium 的一组：0.5、0.67、0.75、0.8、0.9、1、1.1、1.25、1.5、1.75、2。

## 关键设计

### 能力：页面怎么知道自己在桌面壳里，`src/shared/desktop-bridge.ts`、`desktop/src/bun/preload.ts`

- 预加载给所有产品窗口与启动页窗口定义只读的 `__nbookDesktopShell = 1`。它与 t03 的 `__nbookDesktopFrame` 分开：后者只表示“没有系统标题栏”，WebView2 太旧时没有它，但窗口仍在壳里。
- 页面宿主经新的窗口能力 `windowEnvironmentKey`（`src/shared/host.ts`）交出 `{desktop: boolean}`，在窗口启动时定下、不变。插件不各自读全局变量。

### 新的内置插件 `nbook.desktop`，`src/plugins/desktop/`

- **描述**：`locations: ["browser"]`，顶层贡献是配置项与一个设置分区。
- **配置项**（`shared/contracts.ts`，`defineSettings("nbook.desktop", …)`，都只允许用户层，`section: "nbook.desktop.desktop"`）：
  - `zoom`：上面那组档位之一，缺省 1；标题“界面缩放”。
  - `openAtLogin`：布尔，缺省 false；标题“登录 Windows 时打开 NeuroBook”。
  - t13、t14 往这里加项。
  - 为什么用用户层而不是 configuration 输出 22 的“本机层”：桌面版的状态根本来就在本机（`%LOCALAPPDATA%\NeuroBook`），用户层就是本机的。本机层留给以后状态根可以同步的时候。这一条写进 configuration 输出 22，记入待确认清单。
- **分区**：list 分区“桌面”，`category: "app"`，声明里新加 `host: "desktop"`（见下一节）。
- **浏览器入口**（`web/plugin.ts`，`onStartup`），只在 `windowEnvironmentKey` 报告桌面时做事：
  - 公开状态 `nbook.desktop/inDesktop`（布尔），作命令的 `when`。
  - 三条命令：`nbook.desktop.zoomIn`（`Mod+=`）、`nbook.desktop.zoomOut`（`Mod+-`）、`nbook.desktop.resetZoom`（`Mod+0`），`when: {requires: ["nbook.desktop/inDesktop"]}`，`effect: "write"`，`expose.agent: "never"`。它们在档位间移动、写用户层。
  - 窗口上的 `wheel` 监听（`passive: false`）：按住 Ctrl 滚动时 `preventDefault`，按方向执行放大或缩小。WebView2 自带的 Ctrl+滚轮、Ctrl+加减缩放也就被页面接管，缩放只有设置这一份真相。
  - 配置服务的 `onDidChange` 里有本插件的键变化时，发桥消息 `{type: "desktop-settings-changed"}`，壳重读文件。直接改 `settings.json` 时，拥有者监视到文件变化，页面同样收到 `onDidChange`。
- **登记**：`manifest.ts`、`web/plugins.ts` 的定义表与消息目录；`builtin-manifest.test.ts` 随之通过。

### 设置窗口的分区显示条件，`plugins/settings/`

- `SettingsSectionDeclarationSchema` 与 `SettingsPageDeclarationSchema` 加可选的 `host: "desktop"`。
- `buildCatalog`（`web/settings-window.ts:287`）按窗口环境滤掉不适用的分区，不是停用：在浏览器里看到一个永远停用的“桌面”分区没有意义。分区下的配置项也不进“其它”。
- 搜索同样看不到这些项。
- 环境由设置窗口的入口经 `windowEnvironmentKey` 取，可选依赖：没有时按“不是桌面”。

### 壳，`src/desktop/desktop-settings.ts` 与适配层

- **核心**（纯 TS，Linux 上可测）：`readDesktopSettings(stateRoot) → {zoom, openAtLogin, problems}`。
  - 读 `<状态根>/settings.json`，用 `parseLayerText` 与本插件的声明（从 `nbook/plugins/desktop/shared/contracts` 取）。
  - 文件不存在、无效或值不合法时按缺省，并交回原因（壳写日志）。
- **适配层**（`desktop/src/bun/index.ts`）：
  - 启动时读一次，收到 `desktop-settings-changed` 再读。
  - 缩放：每个产品窗口创建与加载页面后 `setPageZoom(zoom)`；变化时对所有产品窗口应用。启动页与对话框不缩放：它们是壳自己的固定小页面。
  - 开机自启：在 `syncLoginItem(openAtLogin, {launcher, identifier, managed})` 里做。
    - 只对安装版：通道根存在，即 t10 的 `channelRoot !== null`。
    - 值名是应用标识，测试标识不碰正式安装的项；值是 `"<安装目录>\bin\launcher.exe"`。
    - 开着而登记缺失或不同时写；关着而登记是本程序的时删。便携版与开发构建不写，并在日志里说明。
    - 读写注册表经 `reg`，失败写日志、不影响运行。

### 页面一侧的约定，`src/shared/desktop-bridge.ts`

- 页面发 `{type: "desktop-settings-changed"}`，进 `HostReply`。

## Spec 与文档改动

- `runtime/desktop-shell.md`：
  - 新输出“桌面专属设置”：壳从状态根读 `nbook.desktop` 的配置项；缩放应用到所有产品窗口；开机自启只对安装版，登记在 HKCU 的 Run 下，值名是应用标识。
  - 输出 13 加 `desktop-settings-changed`。
  - 验收加场景：缩放在几个窗口与重启之间保持；Ctrl+滚轮、Ctrl+加减、Ctrl+0；开机自启的登记与撤销；便携版不登记。
- `runtime/browser-host.md`：
  - 新的窗口能力 `windowEnvironmentKey`；
  - 能力标记 `__nbookDesktopShell`。
- `settings/settings-window.md`：分区的 `host` 字段与“不适用的分区不列、不进搜索”。
- `workbench/commands.md`：键位的主键加 `=`、`-`。
- `settings/configuration.md` 输出 22：桌面版的用户层就是本机的，本机层仍 planned。
- 新的插件文档 `src/plugins/desktop/README.md`（若插件目录惯例要求）。

## 切片

1. **能力与设置分区的条件**：
   - 内容：`__nbookDesktopShell`、`windowEnvironmentKey`；分区的 `host` 字段、`buildCatalog` 的过滤与测试；`nbook.desktop` 插件的骨架、配置项、分区与登记。
   - 验证：设置窗口的单测与 e2e 里的设置分区用例，加一条“浏览器里没有桌面分区”。
   - 提交。
2. **缩放**：
   - 内容：命令、Ctrl+滚轮、`desktop-settings-changed`；壳的核心 `readDesktopSettings` 与测试；适配层应用缩放。
   - 验证：单测；e2e（初始化脚本模拟壳）：命令改写设置、Ctrl+滚轮被接管、设置变化时发桥消息。
   - 提交。
3. **开机自启**：`syncLoginItem` 与适配层；测试只测“该不该写”的判断（纯函数）。提交。
4. **Spec 与 Windows 验收**：
   - 内容：pc-notype 上用 dev 构建与安装版各一次（开机自启只对安装版）。
   - 读取的状态：`ZoomFactor` 经 CDP 读 `devicePixelRatio`；注册表 `reg query`；页面里的按键与滚轮经 CDP 的 `Input.dispatchKeyEvent`、`Input.dispatchMouseEvent` 发给页面，不动系统鼠标。
   - 证据写进 `evidences/`，提交。

## 验收映射

| Spec | 覆盖 |
|---|---|
| desktop-shell 新输出（读设置、缩放、开机自启） | `desktop-settings.test.ts`、登记判断的单测；Windows 验收 |
| settings-window 分区的 `host` | `settings-window` 的单测；e2e |
| 缩放命令与 Ctrl+滚轮 | e2e（假壳）、Windows 验收（真实 WebView2 的 `devicePixelRatio`） |

## 验证

- **单测、类型检查**：`bun run test:affected --since <t03 分支>`。
- **e2e**：新文件 `desktop-settings.e2e.ts`，加受影响的 `settings-window` 相关 e2e 文件（实施时按文件名确认，写进 README）。
- **Windows（pc-notype）**：
  - dev 构建：缩放、几个窗口、重启后保持；
  - 安装版（测试标识）：开机自启的登记与撤销，卸载后登记被清（若卸载程序不清，壳在下次启动时也无法清，记为已知限制）；
  - 便携：不登记。
- **未验证边界**：真实注销再登录后的自启（会打断开发者的会话），只验注册表的值。

## 不做与风险

- **不做**：
  - 登录时以最小化或托盘方式启动（t13 有托盘之后再定）；
  - 每个作品单独的缩放；
  - 浏览器里的缩放接管（浏览器自己的缩放照旧）；
  - 本机层。
- **键位写法要扩展**：`plugins/commands/shared/keybinding.ts` 的主键只认字母、数字、逗号、Escape、Enter、Space 与 F1–F12，不认 `=` 与 `-`。切片 2 给主键加上 `=`、`-`，同时核对工作台的按键分发（`workbench/web/commands/keymap.ts`）按什么比对：`event.key` 在按住 Shift 或别的键盘布局下是否仍是这两个字符。commands.md 的键位写法随之改。仓库里现在没有命令占用 `Mod+=`、`Mod+-`、`Mod+0`（2026-11-15 搜过），编辑器里的富文本快捷键实施时再核对一次命令表的冲突报告。
- **风险：WebView2 的 `ZoomFactor` 在整页导航后是否保持没有实测。** 适配层在每次页面就绪时重设一次，不依赖它保持。
- **风险：卸载留下自启登记。** Electrobun 的卸载程序不知道这个值。缓解是只在安装版写；卸载留下的悬空值指向已删的程序，Windows 登录时静默失败。记为已知限制，写进 desktop-shell。
