# ADR 0013：Desktop Envelope、发行组件与宿主交互

- 状态：Accepted（Spike 基础；生产首发边界由 [ADR 0014](0014-electron-desktop-productization.md) 冻结）
- 日期：2026-08-05
- 更新：2026-08-06（Workbench Chrome、Activity Bar 与 Desktop Bridge v2）
- 关联任务：[Task 143](../tasks/143-desktop-envelope-installation-spike/README.md)、[Task 130](../tasks/130-desktop-application-foundation/README.md)、[Task 145](../tasks/145-electron-desktop-productization/README.md)、[Issue #66](https://github.com/notnotype/neuro-book/issues/66)
- 依赖决策：[ADR 0009](0009-product-runtime-image-generation.md)、[ADR 0010](0010-desktop-storage-loopback-shutdown.md)、[ADR 0012](0012-release-candidate-activation.md)

## 背景

Task 130 已冻结 Product Runtime Image、Manager、State/Cache Root、loopback shutdown 与 Owned Process 的所有权。第一轮 Electron/Tauri spike 证明两个薄壳都能运行同一个 Product，但它只交付 Product-only Portable：没有用户级安装事务、桌面首次配置、Tool Pack、托盘、标题栏、设备设置、远端服务模式或生产级 Supervisor。

NeuroBook 同时需要普通浏览器、连接本机 Product 的 Desktop Local 和连接服务端的 Desktop Remote。桌面壳不能让 Nuxt 页面依赖 Electron/Tauri，也不能获得文件系统、任意命令或 Manager 控制凭据。安装、更新、repair、迁移和 Product 生命周期必须继续由 Manager 拥有，避免两个壳各自形成一套部署系统。

## 决策

### 产品形态

同一套 Nuxt 页面支持三种宿主：

1. B/S：普通浏览器，没有 Desktop Bridge，不渲染桌面标题栏或额外顶部占位。
2. Desktop Local：Envelope 连接 Manager Supervisor 启动的本地 Product。
3. Desktop Remote：Envelope 连接用户配置的服务端。HTTPS 默认允许；HTTP 只允许 loopback 或私有 IPv4，并要求安装时二次确认，运行期间持续显示不安全状态。

Electron 与 Tauri 在 Task 143 内继续并行；本 ADR 不冻结最终框架。自动门禁完成后必须保留两者差异，不用单个 exe 大小、系统 WebView 或 Chromium 的表面数字代替完整安装成本。

### 窗口与标题栏

1. 系统窗口始终由 Envelope 主进程拥有；Vue 只绘制应用菜单、标题、拖动区和 Tauri 需要的窗口按钮。
2. Electron Windows 使用 `titleBarStyle: hidden` 与 Window Controls Overlay，保留 Windows 原生最小化、最大化、关闭按钮和 Snap Layout；macOS 保留 traffic lights。
3. Tauri 按相同菜单和拖动矩阵实现，但不能把自绘按钮冒充为 Windows 原生 Window Controls Overlay。Snap Layout、DPI 和系统菜单差异必须单独记录。
4. Windows/Linux 在标题栏显示 File/Edit/View/Help；macOS 使用原生全局菜单。Renderer 只能提交白名单 command ID，不能传任意 accelerator、脚本或宿主命令。
5. Desktop 页面只绘制一个 36px Workbench 标题栏。应用菜单、连续拖动区、Agent/IDE 模式、Studio 控制和窗口按钮安全区使用同一个四区网格；空间不足时整体切换为单个应用菜单，不逐项隐藏菜单。
6. B/S 不绘制伪标题栏，也不保留 36px 顶部空白。标题栏是否存在只由安全注入的 Desktop Bridge 决定。

### Workbench Chrome 与 Activity Bar

1. 书架、Project、用户资产、IDE 和 Agent 模式共享同一套 Vue Workbench Chrome；Electron/Tauri 差异只留在窗口 Adapter。
2. 左侧 Activity Bar 固定为 48px。Home、Files、Characters、Plot、World 位于顶部；Jobs、Trace、History、User Assets/Profile 位于次要区；Account、Settings 固定在底部。
3. 高度不足时只把次要区折叠进 More。Home、主要 Project 入口、Account 和 Settings 不折叠；无 Project 时 Project 专属入口保持可见但禁用，并解释原因。
4. 当前书籍选择器位于 Primary Side Bar 顶部。Project Picker 不再绘制品牌 Header，也不显示 Primary Side Bar。
5. Desktop 标题栏 Agent 按钮直接切换 Agent/IDE 模式；B/S 的同一动作位于 Activity Bar。IDE 模式不保留独立 Agent Drawer。
6. Inline Editor Agent 由独立 controller 拥有 Session、SSE、模型选择和调用生命周期；不依赖隐藏挂载的 Agent Chat Surface。

### Desktop Bridge v2

`nbook.desktop-bridge/v2` 是页面唯一可见的桌面 Interface，只提供：

- 只读宿主状态与连接形态；
- `platform`、`menuPresentation` 和 `windowControls` 三项受控宿主能力；
- 设备本地设置：75%–200% 缩放、托盘开关、关闭行为；
- 枚举型 `setAppearance("light" | "dark")`；
- 白名单窗口命令；
- 白名单菜单命令与菜单事件。

每次 IPC/command 都验证调用页面的精确 origin。Bridge 不暴露 shell、文件系统、环境变量、Manager secret、shutdown token、任意 URL 导航或任意进程执行。Electron 继续使用 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`；Tauri capability 不授予 shell/fs 权限。

### Manager CLI 与 Supervisor

现有程序统一称为 **NeuroBook Manager CLI**。Task 145 新增的 Manager GUI 是它的薄向导壳，必须复用同一合同；GUI 不拥有安装或 Product 生命周期。

1. 安装、更新、repair、卸载、组件下载、checksum、回滚、migration、管理员创建、Product 启停和进程树均由 Manager CLI 拥有。
2. Envelope 只启动 Manager 的 `Desktop Supervisor Protocol v1`，通过 stdin/stdout NDJSON 接收阶段、ready、完整复核、停止和失败事件；不解析 Product Runtime Contract、不执行 migration、不持有 shutdown token。
3. 安装/更新完成时由 Manager 完整验证 Runtime Image 并写入 verification receipt。普通启动在 migration 和 Product spawn 前消费该 receipt 做 Runtime 控制面 quick authorization：复核 receipt 内容摘要、receipt/manifest identity、ready marker、Runtime Contract 和合同入口存在性，不重复遍历 payload；该授权传给受管子进程，Application execution 仍在 spawn 前复做同一控制面检查。Manager 的安装、更新、Repair、doctor 和显式 `verify` 路径继续执行完整 payload 复核。安装后非控制面 payload 被篡改时，普通启动可能直到下一次 Manager 完整验证才发现；ready 只表示服务可用，不再把“ready 后才验货”作为安全边界。
4. 每次本地启动生成 startup nonce。ready 必须同时匹配动态端口、Product 版本和 nonce；仅返回 HTTP 200 的其他进程不构成 ready。端口竞争最多重试三次，每次都终止本次候选。
5. Supervisor 正常停止先执行认证 graceful shutdown 和 30 秒 drain，再由 Owned Process/Job Object 强制兜底并报告 `graceful` 或 `forced`。

### 单实例与设备 Root

1. 每个登录用户只有一个 NeuroBook Desktop。第二实例转发协议、文件和启动参数并激活首实例。
2. Electron 使用 Electron 系统单实例锁，并把锁身份固定在用户级 Desktop identity root，使其不随 Portable 安装路径或 WebView profile 改变。macOS/Linux 可使用系统提供的应用单实例机制。
3. Tauri 使用官方 single-instance 插件或系统 mutex。禁止磁盘 lock 文件和依赖 `Drop`/`process::exit()` 的清理假设；异常退出后锁必须由操作系统释放。
4. Electron 显式设置 Desktop Local Root 与 WebView/session Root；Tauri 显式设置 WebView2 data directory。Portable 的 Root 随包相对定位，不同 Portable 不共享 cookie。
5. 窗口 bounds、最大化和全屏保存在 Desktop Local Root；恢复时钳制到当前可见显示器。

### 发行与安装清单

`Desktop Distribution Manifest v1` 描述可下载组件；本地 depot 只允许相对 manifest root 的无逃逸路径，联网只允许 HTTPS URL，全部组件记录 SHA-256、字节数、版本和格式。Portable/shell 打包器生成该 sidecar，Manager 的 `desktop install --distribution-manifest` 在进入安装事务前选择 Envelope 组件并复核平台、通道、路径、字节数和摘要；当前本地 Manager 只执行 path archive，HTTPS URL 仍是后续联网下载接口，不得被当作已实现的下载能力。

远端 Desktop 使用独立 `nbook.desktop-shell/v1` shell depot。该 depot 只允许 `manifest.json` 和 `desktop/`，并记录所选 Envelope 的路径、版本、SHA-256 与 WebView 类型；Manager 安装前请求服务端 `/api/app/desktop-capability`，验证 DesktopBridge v2 后才落盘，不把 Product、Bun、Manager CLI 或 Tool Pack 复制进远端安装根。其卸载注册表调用 Manager 的 `desktop uninstall --dir` 逻辑命令，默认保留 State Root。

Spike 阶段的 `Desktop Installation Manifest v1` 只描述本机选择的 Envelope、local/remote、channel、已安装组件和 CLI PATH 决定。生产阶段由 [ADR 0014](0014-electron-desktop-productization.md) 升级为 `Desktop Installation Manifest v3`，额外记录安装范围、用户 Root、组件 receipts、Runtime/Tool provider 和卸载策略；组件路径仍只能相对 Installation Root，远端只持久化规范 origin 和 HTTP 风险确认，不持久化密码或 cookie。旧 v2 candidate 不作为兼容输入。

Canonical 组件只构建一次：Source、平台 Product、Bun、Manager CLI、Electron/Tauri Envelope、Tool Pack 与 WebView2 Runtime Pack。Tool Pack 独立安装，Manager 只把受管 Git/Bash/rg 注入 Product 私有 PATH；只有用户明确选择时才把 NeuroBook CLI 加入用户 PATH。

Windows Installed 固定使用 `%LOCALAPPDATA%\Programs\NeuroBook`，创建当前用户的开始菜单/桌面快捷方式、HKCU 卸载项和 `neurobook://`；不注册未稳定的文件扩展名，不需要 UAC。默认卸载保留 State Root，只有“同时删除数据”才删除托管用户数据。

Task 143 的当前实现由 `install-desktop.ps1` 作为临时 CLI 向导入口，转交 Manager 完成上述安装事务。它已覆盖 Windows x64 本地 depot 的 dirty/image/checksum 复核、stdin/隐藏 TTY 管理员创建、注册失败回滚和卸载资源清理；这不是图形化 Manager，也不构成签名安装器或 updater。

Electron ASAR 只包含 main/preload/本地 Splash/Recovery；Product、Source、Bun 和 native islands 不进 ASAR。Tauri 依赖系统 WebView，缺失 WebView2 时由独立 Runtime Pack 补齐。Portable 是验收输出，不作为后续构建输入。

### macOS

macOS 目标是签名、公证的 `~/Applications/NeuroBook.app`。Source、Product、Bun 和 Manager 位于 `~/Library/Application Support/NeuroBook/installation`，Cache 位于 `~/Library/Caches/NeuroBook`；更新不得修改已签名 `.app`。x64/ARM64 分包，不做 Universal 或 Portable。Task 143 不使用签名凭据，也不声称 macOS 安装已通过。

## 后果

- Nuxt 页面通过 Bridge 存在性决定是否渲染桌面 chrome，Docker/B/S 不需要桌面条件构建。
- 两个 Envelope 共享 Manager Supervisor 和发行清单，框架差异只留在窗口、系统菜单、托盘、WebView 与单实例 Adapter。
- Splash 可以在 Product migration 和完整校验之前立即显示，并用结构化阶段解释等待或进入 Retry/Repair/Open Logs/Quit。
- 远端模式不安装 Product/Source/Tool Pack，但必须先通过 Desktop capability/version 探测。
- Windows 安装可建立注册表、协议和快捷方式；Portable 保持解压即用且不污染其他副本。
- Workbench Chrome 已完成普通 Chromium mock Bridge 和 Electron 可见页面验收；真实窗口拖动、Snap Layout、托盘、原生菜单、文件对话框、下载及完整 SSE/WebSocket 矩阵仍需单独的 OS 级验收，自动测试不能替代。

## 未采用方案

- 让 Electron/Tauri 各自执行 Product 命令：会复制 Manager 的验证、migration、rollback 和关闭所有权。
- 把 GUI Manager 塞进本任务：安装事务和壳交互尚未稳定，先冻结 CLI 合同更容易验证。
- 让网页检测 User-Agent 显示标题栏：B/S、远端和内嵌浏览器会误判；唯一判据必须是安全注入的 Desktop Bridge。
- 用磁盘 lock 文件实现单实例：异常退出与 `process::exit()` 会留下假锁。
- 把所有组件塞进一个 Electron/Tauri 包：重复 Source/Product/Bun，阻碍独立更新、离线组件和真实体积归因。
- macOS Universal/Portable：当前没有签名、公证和双架构 runner 证据，增加产物而不增加可验证能力。
