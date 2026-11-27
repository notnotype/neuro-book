---
schema: nbook.work/v1
workId: w00057-ui-design-standard
issueId: null
status: active
updated: 2026-11-27
---

# 界面设计标准

## 目标

把公认的界面设计理论与规范（NN/g、WCAG 2.2 AA、HIG、M3 转场模式、格式塔、费茨与希克、Butterick）翻译成能判对错的条目，写进 nb-ui 设计语言与开发规范，接进 UI 自检与前端审查；并改掉按标准查出的对比度、焦点、Button 缺省、减弱动效与加载闪烁问题

## 收尾

t01 已合入（`78832eecf`），worktree 与分支已删除。

后续（开发者挑了再开 Task）：
- nb-layout 在减弱动效下仍把四档时长归零，与 nb-ui “位移换淡入淡出”不一致；放开要先收落点框的位置过渡，连同 nested-grid Spec 输出 59、142 一起改。
- 应用里区域级的加载指示多数没有延时与最短停留，按 nb-ui 的 `useDelayedVisibility` 逐个改。
- `lab:shot` 的三项新报告（目标尺寸、文字间距、偏好截图）全量跑一轮，看条数与误报，再定哪几项转阻断（计划 D11）。
