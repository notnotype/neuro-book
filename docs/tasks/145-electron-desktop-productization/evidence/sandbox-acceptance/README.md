# Windows Sandbox `--delete-data` 验收

验收目标：在全新隔离环境中完成 machine 安装、Provider 本地 smoke、启动验证和
Programs and Features `--delete-data` 卸载，并证明安装/卸载产物全部消失、外部
Project Workspace 保留。**不拿宿主机真实 State Root 做删除测试。**

依赖：Windows Sandbox 功能已启用（`C:\Windows\System32\WindowsSandbox.exe` 存在）。

## 0. 自动化通道（推荐；2026-08-12 已验证）

System32 启动器在本机反复崩溃（见 Task 145 walkthrough 排障记录）；改用 Store 版
`Windows Sandbox`（0.8.107.0）自带的 CLI 后稳定：

```powershell
$wsb = 'C:\Program Files\WindowsApps\MicrosoftWindows.WindowsSandbox_0.8.107.0_x64__cw5n1h2txyewy\wsb.exe'
$id = [guid]::NewGuid().ToString()
& $wsb start --id $id --raw
& $wsb share --id $id -f <host-input-dir> -s C:\NeuroBook\input
& $wsb share --id $id -f <host-evidence-dir> -s C:\NeuroBook\evidence -w
& $wsb exec --id $id -c "cmd /c powershell -NoProfile -ExecutionPolicy Bypass -File C:\NeuroBook\input\run-sandbox-acceptance.ps1 -Automated > C:\NeuroBook\evidence\run-log.txt 2>&1 & exit /b %errorlevel%" -r System
& $wsb stop --id $id
```

`-Automated` 用 `exec --run-as System` 执行安装与卸载（沙盒无交互用户会话，UAC
Host 委托路径无法运行；删除由 Manager CLI 调度的同一 Host 脚本在 System 上下文
执行）。验收脚本内 headless 启动后会等待进程树完全收口再卸载（避免 Host 删除的
lockfile 竞态），并轮询 Host receipt `ok=true`。

证据写入 `t145-sandbox-evidence\t145-sandbox-acceptance.json`
（schema `nbook.task-145-sandbox-acceptance/v1`），要求 `ok=true` 且全部 `checks`
为真；当前通过证据已入库 `evidence/t145-sandbox-acceptance.json`。

## 1. 宿主机准备（一次）

```powershell
.\docs\tasks\145-electron-desktop-productization\evidence\sandbox-acceptance\prepare-host.ps1
```

脚本会：

- 校验最终 Depot ZIP（`sha256:cf7f2b2c...`）并复制到
  `C:\Users\Public\Documents\NeuroBookAcceptance\t145-sandbox-input`；
- 解压 Depot（提取 `install-desktop.ps1` / `windows-bun-stage0.ps1`）；
- 创建可写证据目录 `t145-sandbox-evidence`。

## 2. 启动 Sandbox

```powershell
WindowsSandbox.exe .\docs\tasks\145-electron-desktop-productization\evidence\sandbox-acceptance\neuro-book-sandbox.wsb
```

Sandbox 内映射：`C:\NeuroBook\input`（只读）、`C:\NeuroBook\evidence`（可写）。

## 3. Sandbox 内执行验收

在 Sandbox 打开 PowerShell 并运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
& "C:\NeuroBook\input\run-sandbox-acceptance.ps1"
```

脚本分两个 UAC 交互点，均需在 Sandbox 桌面人工批准：

1. **machine 安装**：脚本提示后在 Sandbox 打开【管理员 PowerShell】（右键以管理员
   身份运行，批准 UAC），执行：

   ```powershell
   & 'C:\NeuroBook\input\depot-extracted\install-desktop.ps1' -Depot 'C:\NeuroBook\input\neuro-book-desktop-depot-win-x64.zip' -Scope machine -Channel canary -Yes
   ```

2. **Manager CLI 卸载（删除数据）**：脚本提示后在 Sandbox 打开 PowerShell，
   执行以下命令并批准 UAC：

   ```powershell
   & 'C:\Program Files\NeuroBook\.runtime\bin\neuro-book.cmd' uninstall --yes --delete-data
   ```

   Programs and Features 卸载入口固定保留 State Root（不会提供“同时删除
   数据”选项）；`--delete-data` 破坏性路径由 Manager CLI 承担，machine
   安装会通过外置 UAC Host 删除 Program Files 与托管用户数据。

脚本自动等待安装/卸载产物出现或消失（各最长 15 分钟），其余阶段（Provider
smoke、headless 启动、消失项断言）自动执行。

## 4. 判定标准

证据写入 `t145-sandbox-evidence\t145-sandbox-acceptance.json`（schema
`nbook.task-145-sandbox-acceptance/v1`），要求 `ok=true` 且全部 `checks` 为真：

- `C:\Program Files\NeuroBook` 已删除；
- `%LOCALAPPDATA%\NeuroBook`（State/Cache/Desktop/WebView）已删除；
- HKLM 卸载项、`neurobook://` 注册已删除；
- 开始菜单与公共桌面快捷方式已删除；
- launcher root（`%LOCALAPPDATA%\NeuroBook\manager\uninstall`）已删除；
- NeuroBook 进程树为空；
- 预创建的 `C:\NeuroBook\evidence\ExternalProject` 保留。

## 5. 结果记录

通过后把 `t145-sandbox-acceptance.json` 复制回仓库
`docs/tasks/145-electron-desktop-productization/evidence/`，并在 walkthrough 与
final-acceptance 中登记 `delete-data` 破坏性路径证据。Sandbox 功能不可用或无法
启动时，本轮停在验收门禁并请求启用，不退化为删除宿主机真实 State Root。
