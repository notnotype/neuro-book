---
schema: nbook.task/v2
taskId: t01-distribution-proposal
status: planned
updated: 2026-11-13
---

# 发行提案与桌面壳实测选型

## 目标与范围

写出 ADR 0033 决定 6 要求的发行提案（`docs/proposals/`），供开发者拍板后再拆实现 Task：

- 运行时：用户自备 Bun（现有 npm 包）与捆绑 Bun（目录包）各自的适用人群与代价。
- 界面与桌面壳：在 Electrobun、Tauri、Electron 里各做一个最小原型实测——拉起捆绑的 Bun 服务端、窗口加载回环页面、退出时有序停止、与 `nbook` 的实例认领共存；比较安装包体积、内存、启动时间、三平台可用性、自动更新与签名支持、维护活跃度。
- 安装包与更新：各平台的格式（例如 Windows 安装器或 zip、macOS dmg、Linux AppImage 或 deb）、自动更新的来源与校验。
- 签名与公证：Windows 代码签名、macOS 公证需要的账号与费用，没有时的退路。
- CI 与发布：多平台构建矩阵、冒烟、打标签触发的发布流程、npm 包与桌面包的版本号与发布顺序、半途失败的处理，接现有 `release:smoke` 与 `release:publish`。

非目标：本 Task 不写产品代码，不改 CI；原型放本地或 `.local/`，结论与测量数值进 `evidences/`。

合同：本 Task 产出提案，不改 Spec；采纳后视情况新增 ADR 与发行相关 Spec。

## 当前状态

2026-11-13 经 nbdev 新建，尚未开工。

## 下一步

1. 先查新应用在 Windows、macOS 上能否起来（实例认领、项目子进程），这决定桌面壳原型能否在三平台上跑；本机只有 Linux，另两平台靠 CI runner 或开发者的机器。
2. 调研三种桌面壳的现状（版本、Bun 集成方式、更新与签名），再做最小原型实测。
3. 写提案草稿，先给开发者看要点，确认后再交审查。
