# t04 计划：桌面专属设置（机制、界面缩放、开机自启）

r2，2026-11-15。r1 经设计审查第 1 轮修订：omp 6 条、Sonnet 14 条，处理见 [evidences/design-review-r1-disposition.txt](evidences/design-review-r1-disposition.txt)。

## Context

开发者 2026-11-15 列的“桌面端专属配置，例如：应用缩放”，加上 2026-11-13 列的“开机自启”。托盘与关窗去向在 t13，系统通知在 t14，它们都要用这里建的机制：一组只在桌面里显示、壳能拿到值的配置项。

决定（[Work README](../../README.md) 的“桌面端体验的决定”）：Web 与桌面不建统一 facade，按能力分；只有桌面有的东西，壳不在时不出现。

依据：
- [`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)：声明、层、输出 22 的“本机层（planned）”；
- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)；
- [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)；
- [`runtime/desktop-shell.md`](../../../../../docs/specs/runtime/desktop-shell.md)；
- [`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 输出 11、12。

工作方式：autonomous-delivery，分支 `feat/w00046-t04-desktop-settings` 从 master 开出（t03 已合入）。

## 技术选型

- **设置怎么到壳**：页面推给壳。`nbook.desktop` 的浏览器入口从配置服务读出有效值，经窗口能力交给宿主，宿主经桥发给壳。设置只有一个拥有者（服务端的 `nbook.settings`），无效层、外部编辑、修订都按它的规则。
  - 否决壳自己读 `settings.json`：等于第二个拥有者，无效层与截断写入时的语义对不上（omp 第 1 条）；启动页阶段与没有页面时也收不到变化（omp 第 3 条）。
- **开机自启**：写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，用 `reg add`、`reg delete`。
- **缩放**：Electrobun 的 `win.setPageZoom`（WebView2 的 `ZoomFactor`）；档位沿用 Chromium 的一组：0.5、0.67、0.75、0.8、0.9、1、1.1、1.25、1.5、1.75、2。

## 关键设计

### 能力：页面一侧怎么知道在桌面里、怎么把设置交给壳，`src/shared/host.ts`、`src/web/host/`

- 新窗口能力 `windowDesktopKey`，值为 `WindowDesktop | null`。没有壳时是 `null`：宿主看桥的发送函数在不在（窗口启动时定）。
  - `WindowDesktop` 只有一个方法 `reportSettings(values: DesktopSettingValues): void`，按值发桥消息 `{type: "desktop-settings", values}`。
  - browser-host 输出 11 写明：插件经它只能交桌面设置，拿不到壳的其它能力（Sonnet 第 1 条）。
- 不另加能力标记：宿主看桥的发送函数是否存在就够了，它只在壳的窗口里有。
- 页面一侧的值形状 `DesktopSettingValues`（`src/shared/desktop-bridge.ts`）：`{zoom: number; openAtLogin: boolean}`，TypeBox 校验，t13、t14 往里加字段。

### 新的内置插件 `nbook.desktop`，`src/plugins/desktop/`

- **描述**：`locations: ["browser"]`，顶层贡献是配置项与设置分区。
- **配置项**（`shared/contracts.ts`，都只允许用户层，分区 `nbook.desktop.window`）：
  - `zoom`：上面那组档位之一，缺省 1，`choices` 写出各档的标题（“100%”等）；标题“界面缩放”。
  - `openAtLogin`：布尔，缺省 false；标题“登录 Windows 时打开 NeuroBook”，说明写“只对安装版、用缺省数据目录时生效”。
- **用户层而不是本机层**：configuration 输出 22 把显示缩放这类只对本机有效的项留给 planned 的本机层，本 Task 不实现本机层。
  - 暂放用户层；Spec 如实写“桌面专属设置暂存于用户层，本机层实现时迁过去”，不说用户层就是本机层（omp 第 5 条）。
  - 状态根被复制到另一台机器时，开机自启的值随之过去，但只有那台机器上装了安装版、用缺省数据目录时才会登记，登记指向它自己的安装目录。
  - 记入待确认清单。
- **分区**：list 分区“桌面窗口”（`category: "app"`），声明新加 `host: "desktop"`。
- **浏览器入口**（`web/plugin.ts`，`onStartup`），依赖 `settingsKey`、`windowDesktopKey`（可选）：
  - **公开状态** `nbook.desktop/inDesktop`：总是声明，值是 `windowDesktopKey !== null`，浏览器里为 false，免得每次启动记“未声明的键”（Sonnet 第 8 条）。
  - **交设置**：在桌面里，激活时、配置服务的 `onDidChange` 里有本插件的键时，`reportSettings` 交出当前有效值。几个窗口各交一次，壳按值去重。
  - **缩放命令**（命令面板与视图菜单可用，`when: {requires: ["nbook.desktop/inDesktop"]}`）：`nbook.desktop.zoomIn`、`zoomOut`、`resetZoom`。
    - 不在命令声明里写键位：声明只能写一个键位，分发器按 `event.key` 精确比对，Ctrl+Shift+=、小键盘与别的键盘布局都命不中（Sonnet 第 3、4 条）。
    - `resetZoom` 删掉用户层的值（回到缺省），不写 1。
  - **缩放快捷键**：入口自己在窗口上听 `keydown`（捕获阶段，只在桌面里）。
    - 按 `event.code` 认：`Equal`、`NumpadAdd` 放大，`Minus`、`NumpadSubtract` 缩小，`Digit0`、`Numpad0` 复位；要求 Ctrl，不要求 Alt 与 Meta，Shift 不限。
    - 认到就 `preventDefault`，执行对应命令。
    - 这条路径与命令表分开，是因为命令的键位合同只有一个字符串；commands.md 不改。
  - **Ctrl+滚轮**：窗口上的 `wheel` 监听，冒泡阶段、`passive: false`。
    - 只在 Ctrl 按下、且事件没有被别人处理过时接管（`defaultPrevented` 为假）：图片查看器（`ImageViewer.vue`）自己处理 Ctrl+滚轮（Sonnet 第 5 条）。
    - 按 `deltaY` 累积，满 100 才换一档，换档后清零：触控板的捏合会合成大量小的 Ctrl+滚轮事件（Sonnet 第 6 条）。
  - **连续缩放**：命令先把目标档位直接交给壳（`reportSettings`，界面立即变），再在 300ms 防抖里写用户层。
    - 防抖期间再按，从“目标档位”继续算，不从还没写回的旧值算（Sonnet 第 7 条）。
    - 写入失败时用工作台通知说明，并把壳拉回配置服务里的值。

### 设置窗口的分区显示条件，`plugins/settings/`

- `SettingsSectionDeclarationSchema` 与 `SettingsPageDeclarationSchema` 加可选的 `host: "desktop"`。
- 设置窗口的数据源（`createSettingsWindow` 的选项）加 `environment: {desktop: boolean}`，入口从 `windowDesktopKey` 算出；Lab 的场景可以传 `desktop: true` 看到这个分区。
- `buildCatalog` 先把不适用的分区收进一个“隐藏”集合，再落位配置项：指向隐藏分区的配置项一并隐藏，不掉进“其它”、不记“分区不存在”的诊断（Sonnet 第 2 条）；搜索也搜不到它们。
- 隐藏而不是停用：在浏览器里看到一个永远停用的“桌面窗口”分区没有意义。

### 壳，`desktop/src/bun/index.ts` 与核心 `src/desktop/desktop-settings.ts`

- **核心**（纯 TS，Linux 上可测）：
  - `DesktopSettingsCache`：读写 `<状态根>/logs/desktop/settings-cache.json`，只存壳最后收到的值。它是缓存，不是设置：用途只有下次启动时在页面交值之前先用上次的缩放。读不到、坏了按缺省。
  - `loginItemPlan({openAtLogin, managed, stateRootSource, existing, launcher, identifier}) → "add" | "remove" | "none"`：纯函数，写单测。
- **适配层**：
  - 收到 `desktop-settings` 时用共用的 schema 校验，与上次相同就不动；否则：
    - 缩放应用到所有产品窗口，写缓存；
    - 按 `loginItemPlan` 同步注册表。
  - 产品窗口创建时与每次页面报就绪时，按当前值 `setPageZoom`：不依赖 `ZoomFactor` 跨整页导航保持。启动页与对话框不缩放。
- **开机自启的范围**（omp 第 4 条）：只对安装版（t10 的 `channelRoot !== null`），并且状态根来自缺省位置（`resolveDesktopStateRoot` 的 `source` 是缺省，不是 `NBOOK_STATE_ROOT`，也不是便携）。
  - 值名是应用标识，测试标识不碰正式安装的项；值是 `"<安装目录>\bin\launcher.exe"`。
  - 不满足条件时，开着的设置不登记、写日志说明；登记里已有指向本程序的旧值时删掉。
  - 读写注册表经 `reg`，失败写日志、不影响运行。
- **卸载**：Electrobun 2.0.6 的卸载程序不知道这个值，没有挂钩子的接口。卸载后留下的值指向已删的程序，Windows 登录时静默失败。
  - 记为已知限制，写进 desktop-shell，记入待确认清单（omp 第 6 条）。
  - 缓解：设置说明里写“卸载前先关掉”。

### 页面与壳的约定，`src/shared/desktop-bridge.ts`

- 页面发 `{type: "desktop-settings", values: DesktopSettingValues}`，进 `HostReply`。

## Spec 与文档改动

- `runtime/desktop-shell.md`：
  - 新输出“桌面专属设置”：值由页面交来、壳缓存上次的值；缩放应用到所有产品窗口、每次页面就绪重设；开机自启只对安装版、缺省状态根，值名是应用标识；卸载留下登记的已知限制。
  - 输出 13 加 `desktop-settings`。
  - 新验收场景。
- `runtime/browser-host.md`：输出 11 改为“插件经 `windowDesktopKey` 只能交桌面设置”；新的窗口能力。
- `settings/settings-window.md`：分区的 `host` 字段，“不适用的分区与指向它的配置项都不列、不进搜索、不进其它”。
- `settings/configuration.md` 输出 22：桌面专属设置暂存于用户层，本机层实现时迁过去。
- 新插件的 `README.md`（插件目录的惯例），写清它在浏览器里只声明配置项、公开状态为 false。

## 切片

1. **能力与设置分区的条件**：
   - 内容：`windowDesktopKey`；分区的 `host` 与隐藏集合；`nbook.desktop` 插件的骨架、配置项、分区、公开状态与登记。
   - 验证：设置窗口的单测（隐藏分区、指向它的项、搜索、Lab 环境），`builtin-manifest.test.ts`，类型检查。
   - 提交。
2. **设置交给壳与缩放**：
   - 内容：桥消息、入口交设置、缩放命令与快捷键、Ctrl+滚轮；壳的缓存与应用缩放。
   - 验证：入口的单测（档位换算、累积阈值、防抖从目标档位继续、`defaultPrevented` 时不接管）；e2e `desktop-settings.e2e.ts`（初始化脚本模拟壳）：浏览器里没有分区与命令；桌面里有分区、改档位后壳收到值、Ctrl+滚轮与快捷键改档、图片查看器里的 Ctrl+滚轮不被接管。
   - 提交。
3. **开机自启**：`loginItemPlan` 与单测；适配层同步注册表。提交。
4. **Spec 与 Windows 验收**：
   - dev 构建：缩放应用到几个窗口、重启后先用缓存再按页面交来的值；CDP 读 `devicePixelRatio`。
   - 安装版（测试标识）：开机自启的登记与撤销；设 `NBOOK_STATE_ROOT` 时不登记。
   - 真实键盘：Ctrl+加减、Ctrl+0、Ctrl+滚轮只改一次缩放、WebView2 自带缩放没有叠加。合成输入证明不了，请开发者在 pc-notype 上按一次（omp 第 2 条）；拦不住时去掉快捷键与 Ctrl+滚轮，只留设置项与命令，记入待确认清单。
   - 证据写进 `evidences/`，提交。

## 验收映射

| Spec | 覆盖 |
|---|---|
| settings-window 分区的 `host` | 设置窗口的单测；e2e |
| desktop-shell 新输出（值的来源、缩放、开机自启） | 缓存与 `loginItemPlan` 的单测；e2e（壳收到的值）；Windows 验收 |
| 缩放快捷键与 Ctrl+滚轮 | 入口单测、e2e；真实键盘由开发者 |

## 验证

- **单测、类型检查**：`bun run test:affected --since master`。
- **e2e**：新文件 `desktop-settings.e2e.ts`，加受影响的设置窗口 e2e 文件（实施时按文件名确认）与 `desktop-frame.e2e.ts`。
- **未验证边界**：
  - 真实注销再登录后的自启（会打断开发者的会话），只验注册表的值；
  - 缩放在 125%、150% 显示缩放下与窗口外框的配合，只在 100% 上测。

## 不做与风险

- **不做**：
  - 本机层；
  - 每个作品单独的缩放；
  - 浏览器里接管缩放（浏览器自己的缩放照旧）；
  - 登录时以最小化或托盘方式启动（t13 之后再定）；
  - HTML 预览的沙箱 iframe 里按的缩放键（会走 WebView2 自带缩放，记为已知限制）。
- **风险：页面的 `preventDefault` 可能拦不住 WebView2 的浏览器加速键。** Electrobun 不暴露 `IsZoomControlEnabled` 与 `AcceleratorKeyPressed`。由开发者真实按键验证，拦不住就按上面的退路处理。
- **风险：缓存与设置不一致的窗口期。** 启动时先用缓存，页面交来值后按值纠正，最多一次可见的缩放跳变。只在设置于没有桌面窗口时被改过（命令行、直接改文件）时出现。
