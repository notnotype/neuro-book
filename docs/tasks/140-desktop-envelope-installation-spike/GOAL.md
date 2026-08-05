# Task 140 unattended goal

将以下全文作为长时间无人值守执行指令。它是 Task 140 的执行合同，不是生产发布授权。

```text
/goal 在 Windows 上完成 Electron 与 Tauri Desktop Envelope 的可比较 spike，并以同一个 verified NeuroBook Product Runtime Image、同一个 Product Runtime Contract、同一个 State/Cache Root fixture 和同一份场景矩阵为证据；保持 Product、Manager、Owned Process、Profile、Workspace、数据库迁移和 shutdown 的所有权不变。

执行范围：只在本 worktree 和 .agent/tmp 的带 owner marker 临时目录中工作。允许新增 desktop/spikes/**、该 Task 140 的 README/GOAL/evidence、spike 专属 package/lockfile、`shared/desktop-contract.ts`、Manager CLI 的桌面安装适配、根 `package.json` 的专用合同测试脚本和必要的自动化测试；不得新增根 Electron/Tauri 依赖，不得修改 Task 130 的 Product 合同来迁就 spike，不得写入真实 workspace、用户 State Root、Cache Root、WebView profile、完整 Source 或 sibling 仓库。

前置条件：先检查 bun/node、stable rustup MSVC、cargo/rustc、Visual Studio C++/Windows SDK、WebView2 和仓库外 verified Product 是否存在。若缺任何必要工具，记录版本和安装建议后停止，不要在无人值守阶段弹出安装器或修改系统 PATH。Electron 依赖必须只在 desktop/spikes/electron 下以 bun 安装；Tauri 使用 stable MSVC，不安装 nightly。

实现边界：两个 envelope 都必须通过现有 Product Runtime Contract resolver 启动 Manager/Bun Product，使用随机动态端口和每次启动随机 256-bit shutdown token；不得固定 token、把 token 写入磁盘/URL/localStorage、绕过 verified image、依赖根 node_modules 或复制业务逻辑。Electron 必须 nodeIntegration=false、contextIsolation=true、sandbox=true、CSP 白名单；Tauri 必须最小 capability、显式 loopback 权限和 sidecar/resource 路径。桌面壳只拥有窗口、单实例、WebView profile、原生系统交互和桌面 lease。

迭代顺序：
1. 先读 Task 130、ADR 0009/0010、Product Runtime Contract、AGENTS.md，并写下当前 source/image identity 和环境版本。
2. 建立 shared fixture、resolver adapter、measurement schema 和配置审计；先用假的 Product child 做单元测试，再接仓库外 verified image。
3. 建立 Electron 最小 main/preload/renderer，覆盖 spawn、health/version、单实例、异常退出、graceful shutdown 和 forced fallback；只有这些通过后再接 WebView 资源。
4. 建立 Tauri 最小 Rust/WebView2 envelope，覆盖同样的 spawn、health/version、单实例、异常退出、graceful shutdown 和 forced fallback；不把 Tauri command 当作任意系统 shell。
5. 在同一 Windows 机器、同一 Product image、临时 State/Cache Root 下分别执行 S1-S9。每次运行都保存脱敏 JSON、版本、计时、文件数/字节和失败分类；删除 token、cookie、用户内容和完整 profile。
6. 对无法在无用户交互环境中可靠验证的 UI 场景生成明确的 manual acceptance checklist 和 harness 命令，但不要自动点击真实浏览器、不要启动长期 dev server、不要宣称 UI 已验收。
7. 运行 focused tests、cargo/npm build、静态安全审计和 Product 仓库外 health/shutdown smoke；先修复本任务引入的错误，再重跑受影响场景。不要因为已有基线失败而改无关代码。
8. 生成比较报告：每个壳的版本、安装/解压文件数、逻辑/压缩大小、冷启动、稳定 RSS、WebView 分发假设、权限边界、失败/未验证项；把 Tauri 的 WebView2 Evergreen/Fixed/Bootstrapper 取舍与 Electron Chromium 体积单独列出。

证据规则：每个通过项必须有命令、时间、环境、输入 identity 和输出摘要；只看配置不算功能通过。所有构建机绝对路径、.bun/.pnpm 泄漏、明文 token、固定端口、根 node_modules 回退和越权 capability 都是 fail-closed。任何失败都写最小复现、日志路径、阻断级别和下一步，不用黑名单或容错吞错。

停止条件：若工具缺失、verified Product 无法打开、Product/Manager 合同需要修改、出现未授权的用户数据写入，立即停止当前实验并报告；不要自行安装系统组件、修改主工作区、创建发布资产或改变 ADR。若某一框架连续三次失败且没有新证据，停止该框架并保留失败报告。完成后只报告结果和 PR/worktree 状态，不合并、不关闭 Issue、不宣称人工浏览器验收完成。
```

## Human gates before starting the goal

1. 用户已经确认同时试验 Electron 与 Tauri；本 goal 以 Windows-first 为第一证据平台。真实 UI/浏览器验收不是无人值守阶段的前置条件，未获单独授权时只生成自动化结果和人工验收清单。
2. 用户已经允许安装/下载 spike 本地依赖；Electron runtime 只写入 spike 目录，根 Product 依赖不变。
3. 目标 task worktree 可长期保留；goal 运行期间必须为 Electron runtime、Tauri target、临时 verified Product 和脱敏日志保留足够空间。

当前机器已满足 Rust/MSVC、Windows SDK、WebView2 前置；Electron 仍需在 worktree 内安装。goal 启动前必须重新执行版本检查并把结果写入 walkthrough。

## Portable Packaging continuation

本阶段在同一 Task 140 中生成两个 Product-only Desktop Envelope portable ZIP。先从空 `NEURO_BOOK_OUTPUT_DIR` 构建并用 `ProductRuntimeImageVerifier` 验证 Windows Product Image，再复制同一 image、Bun runtime、Electron Chromium 或 Tauri release executable，生成包相对 launcher、`manifest.json`、`data/` State Root、`.cache/` Cache Root 和 `data/.desktop/` Desktop/WebView root。

Portable launcher 自己选择动态端口、生成内存 shutdown token，并提供普通 GUI 与 `--headless` smoke；用户无需设置 `T140_*` 环境变量。Electron 包不把 Bun Product 放进 ASAR；Tauri 包不安装 WebView2，manifest 明确 `system-evergreen` 前置条件。两个包必须在仓库外且祖先没有 `node_modules` 的目录解压，清空 `NODE_PATH` 后通过 Contract、health、migration/Profile、shutdown、Application Root digest、进程/端口收口和无绝对路径泄漏门禁。

这两个 ZIP 只是未签名的 Windows spike 交付，不是正式 Release、签名图形安装器、updater、正式卸载器或最终框架决策。Task 140 的收口实现另提供 `install-desktop.ps1` 作为 CLI 向导入口；它只调用 Manager 完成 Windows 用户级安装事务，不改变 Portable ZIP 的性质。没有 verified image、出现源码/根依赖 fallback、固定 token、用户数据写入、WebView2 缺失或 Product 合同需要修改时立即停止并记录阻断。
