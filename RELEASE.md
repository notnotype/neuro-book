# 更新日志

这里只放当前版本。更早的版本见 [docs/changelog/](docs/changelog/)。

## 0.9.6-canary（限量 canary） - 2026-08-14

这一轮把 Windows x64 桌面 beta 收口为可复核的内部候选包，并修复跨平台发布与 Agent 取消测试中的可靠性问题。它仍是限量 canary：现有公开发布流程提供五平台 Product、Windows Portable、Source、安装脚本、manifest、SHA256SUMS 和容器镜像；Electron Desktop ZIP/Depot 仍是内部 beta 产物，不是签名安装器。

### 新功能

- Windows x64 桌面 beta 支持当前用户安装、全局安装和 Portable；安装管理器提供安装、校验、迁移、修复、卸载和本地 Product 生命周期，Provider 配置可在引导流程中完成。该 beta 未承诺公开签名安装器、自动更新或 macOS 应用包 (#88)。

### 改进

- 桌面安装、修复和卸载共用同一套状态与权限边界；普通卸载默认保留用户 State Root，只有明确选择同时删除数据时才清理作品、配置和账号信息 (#88)。

### 修复

- 修复干净 Windows 上 PowerShell 5.1 读取引导脚本、缺少 VC++ Runtime，以及超过 MAX_PATH 的卸载目录导致安装或卸载失败的问题；发行包现在对这些输入和路径 fail closed 或使用 app-local 运行库 (#88)。
- 修复 Agent 取消黑盒测试的同步竞态：测试现在等待 Provider 真正取走挂起响应后再取消，并在结束时释放 gate，避免新 invocation 误取旧响应而撞上 30 秒超时 (#99)。
- 修复 Windows Portable 构建下载 GitHub Release 资产遇到正常临时 302 重定向时失败的问题；Manager 0.1.0-canary.54 现已通过公开 provenance 校验 (#103)。

### 内部维护

- 将只在 Bun 运行时可执行的部署测试移出 Node 根测试套件，改由专用 Bun 门禁执行，避免 `Bun is not defined` 污染全量测试 (#96)。

### 升级须知

- 这是限量 canary。升级前请备份完整 State Root 和重要 Project Workspace 的 `.nbook/`、`project.yaml`；先在可丢弃的 Project 上测试。
- 公开 Windows ZIP 是现有 Portable/Manager 发布包，不是 Electron Desktop ZIP；内部 beta 的 Electron Portable/Depot 不代表签名安装器、后台 updater 或最终 Desktop 框架选择已经完成。
- 真实外部 Provider 连接、完整 Agent/Workflow 浏览器流程、macOS 实包、原生 Snap 和公开签名仍未完成；不要把自动化门禁结果当成人工全流程验收。
- 桌面安装卸载默认保留用户 State Root；需要连同作品、配置和账号一起删除时，必须明确选择“同时删除数据”，并先备份重要数据。
