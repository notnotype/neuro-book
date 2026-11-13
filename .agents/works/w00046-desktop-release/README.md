---
schema: nbook.work/v1
workId: w00046-desktop-release
issueId: null
status: active
updated: 2026-11-13
---

# 桌面端打包、CI 与自动发布

## 目标

让用户不用先装 Bun、不用命令行就能装上并打开 NeuroBook：按 ADR 0033 决定 6 写发行提案，实测 Electrobun、Tauri、Electron 选定桌面壳，做出 Windows、macOS、Linux 的桌面安装包，并由 GitHub Actions 在打标签时构建、冒烟并自动发布（npm 包与桌面包同一版本号）。
