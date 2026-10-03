# 桌面版与 Manager

普通 Windows 用户优先从 GitHub Release 下载 `neuro-book-windows-x64.zip`，解压后按[快速开始](/quick-start)运行。服务器、多实例和已有 Source checkout 使用 NeuroBook Manager：

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

Manager 提供 `windows-portable`、`ghcr`、`product-bun`、`source-dev`、`source-product` 和 `source-docker` 六种安装 Profile。自动化可先执行只读审计：

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --dry-run --json
```

Electron 与 Tauri 是 Desktop Envelope 的两个宿主实现；它们不改变作品仍保存在本地 Workspace 的数据合同。公开 Desktop 正式发行、自动更新和跨平台安装仍以 [PROJECT-STATUS](https://github.com/notnotype/neuro-book/blob/master/PROJECT-STATUS.md) 为准。部署与运行细节见[部署方式](/deployment)和[运行、数据与隐私](/operations)。
