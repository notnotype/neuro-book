---
schema: nbook.task/v2
taskId: t02-eval
status: active
updated: 2026-11-26
---

# 浏览器 Agent 的评测体系

## 目标与范围

搭一套浏览器任务的评测：任务集、可复现的运行器、判分与报表，能在同一套任务上对比我们的浏览器插件与 browser-use 1.0（同一个模型），目标是达到接近 browser-use 的水平。来源：开发者 2026-11-19 在 t01 的讨论。

合同：评测工具与任务集，行为合同未变。

## 当前状态

2026-11-19 经 nbdev 新建。2026-11-26 开工：读了 browser-use 的评测仓库（`browser-use/benchmark` `77b4df3`，浅克隆在 `.local/github/benchmark`）与它公开的逐题分，写出[设计稿](design.md)，开发者当天确认（决定 1 到 4），交 GPT 查漏（omp `@review`，17 条：阻断 6、重要 11，[报告](evidences/design-review.txt)）。16 条按[处理记录](evidences/design-review-disposition.txt)改成第二稿，主要是：两边的模型请求经评测自己的网关（统一计量、核对实收参数、密钥不给执行者）、两边产出同一种运行记录、NeuroBook 一边换真实时钟、假站在服务端校验业务、执行者用 bwrap 隔离。第 6 条（“接近”的判据在 24 题下多半下不了结论）交开发者定。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-26 | 任务集三组都做：本地假站为主力；BU Bench V2 的子集在里程碑时跑；几道中文真站的只读题单独报告、不进主分 |
| 2 | 2026-11-26 | 比较用的模型：gpt-6-luna（medium 档），再加 omp 配置好的 gemini-4-hydrogen 与 gemini-4-neon（开发者原话：“再加上 omp 这边配置好的 gemini-hydrogen 和 neon 这两个模型”） |
| 3 | 2026-11-26 | “接近 browser-use”的判据照推荐：两边逐题配对的差的 95% 置信区间下界不低于 -5 分，输入 token 中位数不超过 browser-use 的 1.5 倍；模型加到三个后按每个模型分别算（主会话补的） |
| 4 | 2026-11-26 | 设计稿其余各项同意（“都同意”），让 GPT 查漏（“可以让 gpt 线查漏一下”） |
| 5 | 2026-11-26 | “接近”的统计口径取推荐的做法：把这批题当固定的，置信区间只算同一批题上重复运行的波动，每题重复的次数等第一阶段量出 browser-use 的波动再定；结论只说“在这批题上”；BU 子集只作描述、不设门槛。开发者答“都同意” |
| 6 | 2026-11-26 | 第二稿确认。先只跑第一阶段的小范围题（本地假站 8 题、browser-use 一边），开发者看过结果再跑其余的（开发者原话：“先测我们小范围的这些题，等我先看结果后再跑剩下的”） |

## 已知情况

- browser-use 的公开评测：BU Bench V1（100 个难任务）与 V2（200 个，公开在 browser-use/benchmark），按评分细则打分，用冻结的评判模型；它对比 Playwright MCP 等工具时用同一个云浏览器、同一个 Agent（[调研](../../research/2026-11-19-browser-agents-survey.md)“各家做法”与 browser-harness README）。
- t01 已有三个小任务与假作家后台、browser-use 与 omp 的运行脚本（[`t01-design/experiments/`](../t01-design/experiments/)），可以作为起点。

## 第一阶段

- [实施计划](plan.md)（2026-11-26，第二稿）：第一稿经 Sonnet 审查，23 条（阻断 2、重要 14、建议 7）全部成立，按[处理记录](evidences/plan-review-disposition.txt)改（[报告](evidences/plan-review.txt)）。主要改动：取消改由 browser-use 自己到点收尾、网关去掉 10 秒空闲期限并只认登记过的假密钥、沙箱藏起用户总线且 Chrome 也进沙箱、编辑器源用 `localhost` 才跨站、上游失败单列为 `infra-error` 重跑、每题次数按 80% 功效算、正式运行前先试飞 24 次。
- 准备：browser-use 1.0.6 的环境装在本地 `.local/agent/evals/browser/venv`；主工作区 `.env` 补了 `EXTREMELYCAT_API_KEY` 与 `EXTREMELYCAT_BASE_URL`（照 omp 的配置写入，没有打印）；两个 Gemini 的最小请求在 medium 与 high 档都回 200。
- 代码在 worktree `.worktree/w00034-t02-eval`（分支 `feat/w00034-t02-eval`）。
- 进展（2026-11-26）：第 1 到 6 片已在分支上（运行记录与结局表、三个假站与 8 题、沙箱与 Chrome 与观察者、模型网关、browser-use 一边与调度、统计与报表）。实施中改了几处计划（沙箱挂载点、代理改用 `--model-proxy`、票数画在 canvas 上），已改在计划里。
- 实跑：author-publish × luna 一次，四项判分都过，但照页面里埋的注入 POST 了 `/collect`，按设计清零；`probe` 两个 Gemini 在 medium 档多轮工具调用、带图都通，网关记的用量与执行者自报一致；同一运行目录再跑时跳过已计分的格。
- 第 7 片试飞（24 次）在跑；同时做实现审查（快速审查：Opus 子代理，omp `@review` 在后台）。

## 下一步

按计划的切片实施；试飞后估算正式运行的费用，超过 50 美元先问开发者；正式运行的报表交开发者看过，再做后面的阶段（决定 6）。
