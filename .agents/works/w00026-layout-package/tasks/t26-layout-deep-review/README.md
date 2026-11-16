---
schema: nbook.task/v2
taskId: t26-layout-deep-review
status: active
updated: 2026-11-16
---

# 布局工具深入审查：设计与代码质量、文档与规范、API 形状、性能

## 目标与范围

开发者 2026-11-16 试用 t25 后说“接下来没看到什么问题，可以进行一次深度审查”，重点四处：整个布局工具的设计与代码质量；文档与规范完善程度；API 形状，别人用起来顺不顺手；性能，原则是能省则省，避免不必要的样式、布局与重绘，动画帧不多绘，不超过系统刷新率上限和用户自己设的上限。

对象是 nb-layout 整包与工作台里接它的部分（拖动会话、实时布局、外壳表面、布局记录与投影），固定在提交 `954ed9e94`（t25 分支 `fix/w00026-t25-container-feedback` 的 HEAD）。nb-ui 里冻结的旧 Splitter 副本算在“重复”里看。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)；审查本身不改合同，修复改到哪条再写。

## 审查计划（开发者 2026-11-16 批准：“批准这个计划和预算。t25 的审查不用做了”）

- 四个审查者，都是 Claude Sonnet（`claude -p --model claude-sonnet-5-5`），只读，在固定于 `954ed9e94` 的 detached worktree `.worktree/t26-review` 里读，单元测试可以到 t25 worktree 里跑（审查期间那里不改）：
  1. 设计与代码质量；
  2. 文档与规范（三份 Spec 与实现逐条对照，包与组件说明）；
  3. API 形状：以第三方身份只用公开入口写一份接入草稿；
  4. 性能：逐帧路径上的强制排版、多余的样式写入、空转的动画帧、超过刷新率或卡片刷新设置的写入，每条写怎么量。
- 没加 omp 交叉审查（开发者没要，按派给谁的分工 nb-layout 是前端包）；t25 的实现审查开发者说不用做了，不派。
- 上一轮：t06 的两份形状审查（[可维护性](../t06-flat-renderer/evidences/shape-review-maintainability.txt)、[接入与 API](../t06-flat-renderer/evidences/shape-review-api.txt)）；性能另有 [t21](../t21-hover-cpu/README.md)、[t22](../t22-drag-frame/README.md) 的记录。
- 审查结束后主会话在 e2e 环境实测：拖边界、实时拖动、侧栏显隐、静止时每秒的动画帧回调、样式重算与排版次数、卡片尺寸写入是否守住 `dragCardRefresh` 的 60、30 档。无头浏览器固定 60Hz，“不超过 120、144Hz 屏的刷新率”只能从代码确认都挂在动画帧上，记为未验证。实测不和审查同时跑。
- 预算：四份并行约 1 小时，Sonnet 额度约是平常一次实现审查的 4 倍；写说明约 20 分钟，实测约 1 小时，归类与修复看条数（估计半天到一天）。
- 报告：每条发现一个文件，写在主工作区 `.local/agent/works/w00026-layout-package/tasks/t26-layout-deep-review/reports/`（不进 Git），四份到齐后一起归类，扫过密钥再存为本 Task 的 `evidences/`。修复从 t25 合入之后的 master 开分支。

## 当前状态

2026-11-16 开审。

## 下一步

等四份报告到齐，一起归类；之后实测性能。
