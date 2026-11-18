---
schema: nbook.task/v2
taskId: t31-general-layout-library
status: active
updated: 2026-11-18
---

# nb-layout 做成可复用的通用布局库：提案

## 目标与范围

从 t26 拆出：开发者 2026-11-16 定 nb-layout 是可以发到 npm 的通用布局工具（丙）。写提案取代 ADR 0044 里“工作台的布局工具”的定位：通用层与工作台层的分界，布局文档那一半（区域名、活动栏与状态栏、容器）做成参数还是搬出包，拖动控制器是否进库，错误与诊断、入口、发布物；交开发者看过再做。

合同：提案阶段不改合同；提案接受后改 [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 的 owner 与公开入口，可能新建一份通用停靠布局的 Spec。依据：开发者 2026-11-16 选丙（t26 README“开发者答第 1 件”）；第三方视角的 API 审查 `../t26-layout-deep-review/evidences/deep-review-api.txt`。

## 当前状态

2026-11-18 开工。主会话先写下自己的方案要点（主工作区 `.local/agent/works/w00026-layout-package/tasks/t31-general-layout-library/reports/my-outline.txt`）；同时派 Claude Sonnet 做独立设计（只给目标与仓库，不给主会话的方案，报告 `reports/independent-design.txt`）。两版对照后写提案 `docs/proposals/` 下的草稿，做设计审查，再交开发者看。

## 下一步

等独立设计，对照后写提案草稿。写完停下等开发者。
