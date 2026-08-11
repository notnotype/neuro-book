# Windows Sandbox `--delete-data` 验收

验收目标：在全新隔离环境中完成 machine 安装、Provider 本地 smoke、启动验证和
Programs and Features `--delete-data` 卸载，并证明安装/卸载产物全部消失、外部
Project Workspace 保留。**不拿宿主机真实 State Root 做删除测试。**

依赖：Windows Sandbox 功能已启用（`C:\Windows\System32\WindowsSandbox.exe` 存在）。

## 1. 宿主机准备（一次）

```powershell
.\docs\tasks\145-electron-desktop-productization\evidence\sandbox-acceptance\prepare-host.ps1
```

脚本会：

- 校验最终 Depot ZIP（`sha256:968cba74...`）并复制到
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
& "C:\NeuroBook\input\depot-extracted\run-sandbox-acceptance.ps1"
```

脚本分两个 UAC 交互点，均需在 Sandbox 桌面人工批准：

1. **machine 安装**：脚本提示后在 Sandbox 打开【管理员 PowerShell】（右键以管理员
   身份运行，批准 UAC），执行：

   ```powershell
   & 'C:\NeuroBook\input\depot-extracted\install-desktop.ps1' -Depot 'C:\NeuroBook\input\neuro-book-desktop-depot-win-x64.zip' -Scope machine -Channel canary -Yes
   ```

2. **Programs and Features 卸载**：脚本提示后在 Sandbox 打开【设置 → 应用 →
   已安装的应用】，找到 NeuroBook 卸载，确认【同时删除数据】，批准 UAC。

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
