---
schema: nbook.task/v2
taskId: t01-design-standard
status: planned
updated: 2026-11-27
---

# 设计标准写进文档、接进审查，修掉查出的问题

## 目标与范围

开发者 2026-11-23 要求制定设计标准并接进审查（前端反复出现没有动效、细节没打磨、界面写说明文字）。按调研草稿把 NN/g、WCAG 2.2 AA、HIG、M3 转场模式等翻译成能判对错的条目，拆进 nb-ui 设计语言与开发规范、前端规范，接进 UI Skill 与前端审查说明；并修掉查出的问题：`--text-muted` 对比度、焦点指示、`Button` 缺省 `primary`、减弱动效全部归零、加载指示闪烁、`lab:shot` 加只报告的三项机检。草稿第四节 11 项开发者全按推荐通过，见 [plan.md](plan.md) 的 D1 到 D11。

合同：`ui/component-lab` 的 `lab:shot` 加三项报告；nb-ui 的 `Button` 缺省 `variant` 改为 `secondary`（公开接口变化，进 migration-0.4.md）。

## 当前状态

2026-11-27 经 nbdev 新建；计划 [plan.md](plan.md) 已写，等开发者确认。

## 下一步

开发者确认计划后开 worktree，从 S0（组间距摸底、出处复核）做起。
