---
schema: nbook.task/v2
taskId: t01-distribution-proposal
status: planned
updated: 2026-11-13
---

# 发行提案与桌面壳实测选型

## 目标与范围

写出 ADR 0033 决定 6 要求的发行提案（`docs/proposals/`），供开发者拍板后再拆实现 Task：

- 运行时：桌面包捆绑 Bun；与现有 npm 包（用户自备 Bun）的关系、共用哪些产物。
- 桌面壳：按开发者决定直接用 Electrobun，在 Windows 上做最小原型验证——拉起捆绑的 Bun 服务端、窗口加载回环页面、退出时有序停止、与 `nbook` 的实例认领共存；记下安装包体积、内存、启动时间。原型遇到 Electrobun 解决不了的阻断才转候选 Electron，并写明阻断。
- 安装包与更新：Windows 的 setup 安装程序与便携包（解压即用）；自动更新的来源与校验。
- 签名：Windows 代码签名的选项与费用，没有证书时的退路（SmartScreen 警告）。
- CI 与发布：Windows 构建与冒烟；打 `v*` 标签后全自动发布（npm 包、桌面包、GitHub Release），发布前的门禁全部在 CI 里跑完、半途失败的处理，接现有 `release:smoke` 与 `release:publish`。
- 外部工具向导：见下面“开发者决定”第 3 条，提案里单列一节。

非目标：本 Task 不写产品代码，不改 CI；原型放本地或 `.local/`，结论与测量数值进 `evidences/`。macOS、Linux 桌面包放在 Windows 之后。

合同：本 Task 产出提案，不改 Spec；采纳后视情况新增 ADR 与发行相关 Spec。

## 开发者决定（2026-11-13）

1. 桌面壳直接用 Electrobun，候选 Electron。
2. 先做 Windows，提供 setup 安装程序与便携包。
3. 应用内要有第三方工具的安装向导（Git、Python 等），两种安装路径：随 NeuroBook 安装（NeuroBook 自己管理）；系统安装（装到用户或系统，NeuroBook 装完后只识别）。Agent 提的细化方案待开发者确认，见会话与下一版提案。
4. 打 `v*` 标签后全自动发布。

## 当前状态

2026-11-13 新建，范围按上面的决定收窄，尚未开工。

查到的事实（从代码推断，未在 Windows 上运行）：v2 产品代码不直接调用 git 或 python；但 Agent 的命令工具只有 `bash` 一种方言（`packages/nb-harness/src/kit/commands/dialects.ts`），Windows 上要有 bash 才能用，Git for Windows 自带的 bash 是现成的来源。

## 下一步

1. 先查新应用在 Windows 上能否起来（实例认领的命名管道、项目子进程）：本机只有 Linux，靠 GitHub Actions 的 Windows runner 或开发者的机器。
2. 调研 Electrobun 在 Windows 上的现状（版本、安装包形态、自动更新、签名），做最小原型。
3. 写提案草稿，先给开发者看要点，确认后再交审查。
