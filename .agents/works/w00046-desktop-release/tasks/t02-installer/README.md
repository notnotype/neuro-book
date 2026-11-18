---
schema: nbook.task/v2
taskId: t02-installer
status: active
updated: 2026-11-18
---

# 安装程序：为当前用户安装、可选快捷方式与安装位置

## 目标与范围

开发者 2026-11-13 要的：有界面的安装程序，为当前用户安装（不要管理员权限）、选择安装位置、是否创建桌面与开始菜单快捷方式等，并与 Electrobun 的更新与卸载对上。提案 docs/proposals/desktop-distribution.md 4.5 定第一版先接受无界面安装。

2026-11-18 调研（[research-r1](evidences/research-r1.md)）后范围改为：**继续用 Electrobun 的安装程序，加首次启动向导**。Electrobun 2.0.6 的安装、更新器与卸载都把位置写死在 `%LOCALAPPDATA%\<identifier>\<channel>`，每次更新重建两个快捷方式，界面文字写死、没有配置项；为当前用户安装、不要管理员权限已经满足。

合同：`runtime.desktop-shell` 加首次启动向导与桌面快捷方式设置（条目级 planned），设计定稿后写。

## 决定

1. （2026-11-18，开发者，会话里）继续用 Electrobun 的安装程序，不做 Inno Setup；安装位置固定，记为已知限制。
2. （同上）首次启动向导里问：桌面快捷方式（新设置，关掉时由壳删除、每次更新后再删）、登录时打开、关窗去向、主题与语言；数据位置只显示，不让改（ADR 0033：桌面版与 `nbook` 共用书架）。
3. （同上）上游 Electrobun 先不提 issue。
4. （同上）向导的形式先出静态稿再定：[评审板](artifacts/review/index.html) 第 1 轮。

## 当前状态

草稿 worktree `.worktree/w00046-t02-drafts`（分支 `t02/drafts`，不合并）里搭了两版静态稿：A 一页对话框、B 分步向导；评审板第 1 轮等开发者答。

## 下一步

定了形式后写 Spec（desktop-shell 的首次启动向导、桌面快捷方式设置）与 `plan.md`，按 autonomous-delivery 做设计审查与实施。
