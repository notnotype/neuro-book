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

合同：[`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 33（桌面快捷方式）、34（首次启动向导）、验收场景 19，条目级 planned。计划见 [plan.md](plan.md)。

## 决定

1. （2026-11-18，开发者，会话里）继续用 Electrobun 的安装程序，不做 Inno Setup；安装位置固定，记为已知限制。
2. （同上）首次启动向导里问：桌面快捷方式（新设置，关掉时由壳删除、每次更新后再删）、登录时打开、关窗去向、主题与语言；数据位置只显示，不让改（ADR 0033：桌面版与 `nbook` 共用书架）。
3. （同上）上游 Electrobun 先不提 issue。
4. （同上）向导的形式先出静态稿再定：[评审板](artifacts/review/index.html) 第 1 轮。
5. （2026-11-18，评审板第 1 轮 form）分步向导（欢迎 → 外观 → 桌面 → 数据位置），不用一页对话框；开发者备注“做的高级一点，user-friendly 一点”，第 2 轮按这个打磨外观。
6. （2026-11-18，评审板第 2 轮 shell）外壳用上方舞台：顶上四段进度条，看板娘与内容居中；第一屏居中、看板娘放大，从第一屏切到第二屏时做一个过渡动画（开发者备注）。不用左侧品牌栏。第 2 轮“直接修”表里的几条照做：主题、明暗、语言立刻生效；主题与明暗卡片用真实书架截图；回车下一步、Esc 跳过、上一步保留已选值；换步横向滑入，减少动态效果时直接切换。

## 当前状态

草稿 worktree `.worktree/w00046-t02-drafts`（分支 `t02/drafts`，不合并）里搭了两版静态稿：A 一页对话框、B 分步向导；两轮定稿：分步向导、上方舞台。设计审查第 1 轮（Sonnet 15 条、omp 12 条，[处理](evidences/design-review-r1-disposition.md)）已吸收进计划第 2 稿与 Spec；新增待确认 5 条。切片 2 到 6 已实施，实现审查进行中。

## 实施进度（分支 `feat/w00046-t02-t02-first-run`，worktree `.worktree/w00046-t02-t02-first-run`）

| 切片 | 提交 | 内容 |
|---|---|---|
| 2 安装事实与快捷方式 | ddb7098e8 | 桥的 `install-facts`、配置项 `desktopShortcut`、核心 `install-facts.ts`（频道、便携、程序位置，开机自启共用）、`desktop-shortcut.ts`（判定与串行同步）、Windows 端口（固定 PowerShell 脚本、环境变量传路径）；用户层修回补交一次 |
| 3 打开位置 | 5257133f6 | `revealFolder`（`realpath`、区分不存在与无权访问）、`nbook.projects/projects.revealLibrary`（合同版本 4）、桥的 `open-state-root` 由壳打开 |
| 4 目录与缩略图 | 95a009a55 | `nbook.desktop` 的语言目录与登记、8 张主题缩略图（`scripts/first-run-thumbnails.ts` 从产品页截）与机检 |
| 5 组件 | 7e619bca4 | `FirstRunWizard` 与 `.md`、Lab 11 个场景、dom 测试 9 条 |
| 6 宿主与 e2e | 62f217801、ef5c88678 | 单独的 `first-run` 入口、记录（user/shared）、命令、浮层；`desktop-first-run.e2e` 6 条，六个模拟壳的文件先记下看过向导，`desktop-settings` 加层修回补交、`text-selection` 加向导路径 |

验证（2026-11-18，负载 30 到 45）：类型检查通过；bun 测试 661 条、dom 测试 147 条通过；e2e 8 个文件（新的 `desktop-first-run` 与六个模拟壳的文件、`settings`）通过，中途 `settings.e2e:194`（Lab 冷启动等 `html` 超时，负载 45）单独重跑通过；两条否定断言做了变异（出现条件不看记录、浏览器里也导入向导），都变红，已还原重建。

## 下一步

处理实现审查；Windows 验收（切片 7）；合入 master。
