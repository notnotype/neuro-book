---
schema: nbook.task/v2
taskId: t26-resume-last-project
status: active
updated: 2026-11-25
---

# 打开 NeuroBook 时回到上次的作品

## 目标与范围

桌面版启动、托盘或 Dock 开窗、nbook 命令打开浏览器时，直接进最近打开的那部作品；手动打开地址、回到书架、出错页的链接仍是书架；设置里加“启动时打开：上次的作品 / 书架”，缺省上次的作品。

合同：改 runtime.projects、workbench.bookshelf、runtime.desktop-shell、runtime.cli（见 plan.md 的“Spec 与文档改动”）。

## 当前状态

2026-11-25 计划第 1 稿写好（[plan.md](plan.md)），开发者 2026-11-25 回“可以”，计划要点全部按推荐：设置放“作品”分区；已有窗口时再开是书架；上次的作品打不开时停在出错页；冒烟改完要演练（推 master）。此前已定：开发者已定：只在启动类入口恢复、只恢复最近一部、加“启动时打开”设置且缺省上次的作品。

## 计划的设计审查（2026-11-25）

Claude Sonnet 一份，11 条（阻断 1、重要 5、建议 5），全部成立，已改进 [plan.md](plan.md)：拼地址用 `new URL`（字符串相加会成 `//api/…`、静默进书架，阻断）；路由任何失败都 302 到 `/`；“作品”分区是手写页面，要改 `WorksSettingsPage`；开窗规则只落在 `windows.ts`、关闭中的窗口不算、启动期间只第一个启动窗口 resume；记录照 `projects.stats` 自愈、先核对登记表、不存时间；查询串丢弃；路径常量放无导入的小文件；Spec 补齐要同步改的原句；`smoke-windows` 加一次重启覆盖真实壳的 302，`smoke-update` 在它备份的 `settings.json` 里设 `startupOpen: shelf`；目标地址用 `projectUrl`。报告：[evidences/design-review.txt](evidences/design-review.txt)。

## 下一步

按切片实施，执行位置 `.worktree/w00046-t26-resume-last`（分支 `feat/w00046-t26-resume-last`）。e2e 基线：起点上 `bookshelf.e2e.ts` 7 条全过。
