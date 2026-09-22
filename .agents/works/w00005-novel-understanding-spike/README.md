---
schema: nbook.work/v1
workId: w00005-novel-understanding-spike
issueId: null
---

# Novel Understanding Spike

继续小说理解 Brief、候选图和摘要密度研究；current Task 从 legacy `00161-novel-understanding-spike` 迁入，既有 evidence、walkthrough 与脚本随 Task 保留。`t02` 在 `t01` 证据之上建立小说记忆模型并交付数据结构 spike 与查看器，模型已获开发者审查通过。`t03` 在此之上提出抽取管线设计，让 LLM 自动生成与维护该图，等待开发者审查。

2026-09-22 并发 Agent 停止后的清理范围：开发者决定本轮**不提交**本 Work。工作树 `.worktree/w00005-novel-understanding-spike` 与分支 `feat/w00005-v6-ingest-viewer` 原样保留；其未跟踪实验产物（约 2.2 GB / 6.4 万文件，含 `tasks/t18-ingest-roles/experiments/**`）未入库，也未加忽略规则，后续由本 Work 决定取舍。
