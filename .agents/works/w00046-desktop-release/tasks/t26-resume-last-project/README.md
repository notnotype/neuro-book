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

## 下一步

计划审查（Sonnet），再按切片实施。
