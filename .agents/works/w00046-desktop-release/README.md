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

## 背景

- [ADR 0033](../../../docs/adr/0033-app-delivered-as-built-npm-package.md) 定了第一种发行：npm 包 `@notnotype/neuro-book`（构建产物、带 `nbook` 命令、要用户先装 Bun）。决定 6 留下两个维度另写提案：运行时用用户的 Bun 还是随发行捆绑 Bun（目录包）；界面在浏览器、浏览器安装的独立窗口还是原生窗口（桌面壳，在 Electrobun、Tauri、Electron 里实测后选，都把 Bun 当独立进程、窗口加载回环页面）。决定 7：不恢复旧 Manager，Windows 一键启动由目录包或桌面壳承担。
- 现有发布链（[w00027 t15](../w00027-plugin-platform/tasks/t15-author-api-round2/README.md) 第三期）：`release:smoke` 打包并冒烟、`release:publish` 由开发者 `npm login` 后手动发 npm；不建 GitHub Release。CI（`.github/workflows/ci.yml`）只跑治理、文档、受影响的包和应用包能打出来，没有发布作业。
- 旧应用的交付链（Windows zip、Manager、`desktop/`）在 v2 分支已删，只作参照，见 [v2 重建提案](../../../docs/proposals/neuro-book-v2-rebuild.md)。
- 已知风险：新应用在 Windows、macOS 上整体未验证（ADR 0033 后果一节：命名管道的实例认领在 Bun 上有失败报告）；`bun build --compile` 的单文件起不来项目子进程。

## 范围

- 发行提案：两个维度的取舍、桌面壳选型、安装包形态、更新方式、签名与公证、版本号与发布顺序。
- 桌面壳与安装包：Electrobun（候选 Electron）；先做 Windows 的 setup 安装程序与便携包，macOS、Linux 在后。
- 外部工具（Git、Python 等）：第一版只检测加提示（2026-11-13 第一轮审查后定），两条安装路径以后再做。
- CI：构建与冒烟；打 `v*` 标签后全自动发布（npm 包、桌面包、GitHub Release）。
- 桌面端体验（开发者 2026-11-13 列的后续）：有界面的安装程序（为当前用户安装、安装位置、快捷方式）、自定义标题栏、桌面端专有设置（开机自启、系统托盘、通知）。

代码分支：`feat/w00046-desktop-release`，worktree `.worktree/w00046-desktop-release`（2026-11-13 从 master 开出）。

非目标：服务器部署（Docker、远端访问，以鉴权为前提另写提案）；后台运行与系统服务（`nbook service`）。

## 授权

- 开发者 2026-11-13 定打 `v*` 标签后全自动发布。流水线本身上线前由开发者确认；push、打标签、配置仓库 Secrets 等远端写入仍要开发者逐次授权。
- 签名证书与 Apple 开发者账号由开发者提供，Agent 不经手密钥原文。

## Task

开发者 2026-11-13 指定 t06 到 t11 用 autonomous-delivery 推进；本该开发者决定的点记在 [待确认清单](pending-confirmations.md)。

| Task | 内容 |
|---|---|
| [t01](tasks/t01-distribution-proposal/README.md) | 发行提案与桌面壳实测选型。已完成：提案 [desktop-distribution](../../../docs/proposals/desktop-distribution.md) 已接受，[ADR 0051](../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md) |
| [t02](tasks/t02-installer/README.md) | 有界面的安装程序：为当前用户安装、安装位置、快捷方式。未开工 |
| [t03](tasks/t03-custom-title-bar/README.md) | 桌面端自定义标题栏。未开工 |
| [t04](tasks/t04-desktop-settings/README.md) | 桌面端专有设置：开机自启、系统托盘、通知。未开工 |
| [t05](tasks/t05-external-tools-wizard/README.md) | 外部工具：第一版只检测加提示。未开工 |
| [t06](tasks/t06-desktop-specs/README.md) | 桌面发行的 Spec（desktop-shell、desktop-update 新建，server-host、browser-host、editor、cli、notifications 等修改）。已完成，omp 三轮设计审查 |
| [t07](tasks/t07-managed-entry-payload/README.md) | 应用包托管入口与桌面载荷组装。已完成 |
| [t08](tasks/t08-desktop-shell/README.md) | Electrobun 桌面壳。进行中：代码与 Windows 实测第 1 轮完成，实现审查中 |
| [t09](tasks/t09-close-handshake/README.md) | 关闭前询问（页面与壳）。计划中 |
| [t10](tasks/t10-auto-update/README.md) | 桌面版自动更新。未开工 |
| [t11](tasks/t11-release-pipeline/README.md) | 打标签自动发布流水线。未开工 |
