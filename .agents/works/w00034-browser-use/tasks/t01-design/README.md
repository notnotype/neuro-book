---
schema: nbook.task/v2
taskId: t01-design
status: active
updated: 2026-11-19
---

# 设计：引擎、浏览器配置与登录态、对外操作的确认、域名范围

## 目标与范围

按 Work README 的“要讨论的问题”出设计。先调研并实测（开发者 2026-11-19：模型的 browser use 能力提升很大，这次要勤于实践），再与开发者讨论，之后写计划。

合同：只做设计，行为合同未变。

## 当前状态

2026-11-19 开工，调研与第一轮实测完成：[调研与实测](../../research/2026-11-19-browser-agents-survey.md)。

- 克隆到 `.local/github/`：browser-use、browser-harness、Agent-Reach、reader、bilibili-cli、opencli、page-agent（浅克隆，只读）。
- 实验脚本在 [`experiments/`](experiments/)：假作家后台（`author-backend/`，提交与提示注入的请求记进日志）、browser-use 与 omp 的运行脚本、注入与快照探针 `inject-probe.ts`、任务说明 `tasks/`。原始输出在本地 `.local/agent/works/w00034-browser-use/tasks/t01-design/`（`runs/`、`logs/`、`probe*/`），browser-use 装在同目录的 `venv/`。
- 实测结论摘要见调研的“结论先行”；开发者问的“opencli 为什么打开浏览器”在调研的同名一节。
- 没做：opencli 的扩展没在本机装起来跑（这台机器没有图形界面）；Gemini 经 `.env` 的中转超时，改经 omp 的渠道只跑了发布任务一次；没有绕过起点的反爬检测（权限分类器拦下，设计上也不做反检测伪装）。

## 下一步

把调研“对设计的含义”里的推荐交开发者定：引擎、给模型的接口（薄还是厚）、浏览器与登录态、对外操作的确认、computer use 是否另开插件、与网页工具的关系；定了再按 implementation-planning 写计划。w00033 的快照格式与这里共用，编号推荐用 `backendNodeId`。
