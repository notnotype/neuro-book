---
schema: nbook.task/v2
taskId: t05-public-api-alignment
status: planned
updated: 2026-11-02
---

# nb-ui 公开 API 一次对齐（附迁移表与对外版本）

## 目标与范围

浮层、尺寸、语调、文案、列表数据的公开 API 各只有一套写法，仓库内调用方一次迁完，插件作者有迁移表

行为合同未变：产品行为不改，改的是 nb-ui 的公开 API 与 `packages/nb-ui/docs/` 的规范；对外是一次不兼容版本，迁移说明随本 Task 写。计划见 [plan.md](plan.md)，接过 [t01 总计划](../t01-plan/plan.md) 的“t04：公开 API 对齐”一节。

## 当前状态

2026-11-02 开发者同意按当前 master 重新核对 t01 计划的 t04 条目、写成本 Task 的计划；核对结果与计划已写进 [plan.md](plan.md)，等开发者确认计划末尾三项，尚未开工。

## 下一步

开发者确认计划后：计划审查（Sonnet 审前端设计，omp 审 API 形状与对外兼容），处理后建 worktree 从 S0 开始。
