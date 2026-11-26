---
schema: nbook.task/v2
taskId: t03-ui-guide
status: active
updated: 2026-11-26
---

# 第一批实现：快照、界面目录、截图与引导（ui 对象）

## 目标与范围

按 t01 设计稿第四稿与 Spec agent/page-agent 实现 eval 全局对象 ui 的第一批：选当前窗口、文字快照与引用、稳定名、界面目录、截图、高亮引导与等用户；先补内核、harness、agent、设置与工作台的上游缺口

合同：[`agent/page-agent.md`](../../../../../docs/specs/agent/page-agent.md)（planned，新建）；上游几份 Spec 的 planned 条目见 [plan.md](plan.md) 的“Spec 与文档改动”。计划：[plan.md](plan.md)。

## 当前状态

2026-11-26 经 nbdev 新建。Spec 草稿与实施计划已写好，等开发者确认要点后提交并送计划审查；尚未开工写代码。

## 下一步

1. 开发者确认计划要点后，提交 Spec 与计划。
2. 计划审查：内核与跨进程部分（第 2、3、8 片）快速审查（Opus 先审，omp `@review` 后台）；前端部分（第 6、7 片与插件 `web/`）派 Sonnet。
3. 处理审查结论后开 Work 分支 `feat/w00033-page-agent`，从第 1 片做起。
