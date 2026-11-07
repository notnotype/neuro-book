---
schema: nbook.task/v2
taskId: t22-drag-frame
status: active
updated: 2026-11-07
---

# 拖动重整：跟手的东西不走渲染，标签条都能实时布局

## 目标与范围

开发者 2026-11-07 试用 t20 后的四条：让出的位置不画卡片；样式重算要降到刷新率；一拖动就缩成卡片且可配置；标签条排序受手感设置控制，活动栏和别的标签组也实时布局。代码不要再修修补补。

合同：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 要改，见 [`plan.md`](plan.md)。

## 当前状态

计划开发者看过要点（2026-11-07）：让出的位置、卡片时机按推荐；活动栏与别的面板的标签条走同一条逻辑，指针上去就被吸收，别的面板这条优先级最低，难实现可以禁用。下一步设计审查，产品代码没动。

诊断：拖视图时每帧 5.2 次样式重算、0.69 次布局，拖编辑器标签 3.8 次（[`evidences/frame-cost.txt`](evidences/frame-cost.txt)，脚本 [`scripts/diag-drag-frame.mjs`](scripts/diag-drag-frame.mjs)）。主因是卡片矩形每帧经属性穿过 NestedGrid，所有面板头跟着重渲染，`TransitionGroup` 每次都量。t20 的 `drag-cost.txt` 里 `RecalcStyleCount` 已经是每次移动 5.5 次，当时只看了耗时，漏了次数。

## 下一步

设计审查（一个 Sonnet），再按切片实施。
