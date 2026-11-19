---
schema: nbook.task/v2
taskId: t02-eval
status: planned
updated: 2026-11-19
---

# 浏览器 Agent 的评测体系

## 目标与范围

搭一套浏览器任务的评测：任务集、可复现的运行器、判分与报表，能在同一套任务上对比我们的浏览器插件与 browser-use 1.0（同一个模型），目标是达到接近 browser-use 的水平。来源：开发者 2026-11-19 在 t01 的讨论。

合同：评测工具与任务集，不改产品行为合同。

## 当前状态

2026-11-19 经 nbdev 新建，尚未开工。

## 已知情况

- browser-use 的公开评测：BU Bench V1（100 个难任务）与 V2（200 个，公开在 browser-use/benchmark），按评分细则打分，用冻结的评判模型；它对比 Playwright MCP 等工具时用同一个云浏览器、同一个 Agent（[调研](../../research/2026-11-19-browser-agents-survey.md)“各家做法”与 browser-harness README）。
- t01 已有三个小任务与假作家后台、browser-use 与 omp 的运行脚本（[`t01-design/experiments/`](../t01-design/experiments/)），可以作为起点。

## 下一步

在 w00052 之后、浏览器插件实现之前开工：先读 browser-use/benchmark 的任务格式与评判方式，定任务集（中文小说网站与写作相关的任务、可复现的本地假站点、公开基准的子集）、判分（规则核对优先，评判模型兜底）与报表，再写计划。
