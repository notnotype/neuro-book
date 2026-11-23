---
schema: nbook.task/v2
taskId: t44-task-list-followups
status: planned
updated: 2026-11-23
---

# 后台任务清单的余项：补断言晋升、内核停止的收口、验收 2 的偶发

## 目标与范围

补齐 t42 晋升核对里缺的断言后去掉剩下的 planned 标记；内核的停止在收口批写不下时按实际提交的记录结算；查清 agent-subagents 验收 2 的原有偶发

合同：[`workbench/background-tasks.md`](../../../../../docs/specs/workbench/background-tasks.md) 输出 18–21、23、24、26–28、验收 8、Smoke 的 planned 部分；[`agent/jobs.md`](../../../../../docs/specs/agent/jobs.md) 输出 4 的 planned 句、输出 20、失败码 `stop-failed`；[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 输出 30；[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 53 的 planned 句。行为合同不变：只补断言、去标记；内核那一项按 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 的停止收口修实现。

## 输入

- 逐句核对报告：[t42 `evidences/promotion-check.txt`](../t42-task-list-providers/evidences/promotion-check.txt) 的“缺”一节（中 12 条、低约 20 条）。t42 收口时已补并去掉标记的：撤回函数只第一次起作用、旧 `notify` 不再读行、一次变化只读一次、组内排序、状态栏数后台工作（e2e）、输出 17、22、25、`row-gone`、`not-stoppable`、验收 7、9、10、conversation 输出 33、subagents 输出 21、session 输出 22。
- 还缺、要补的中档：范围开关命令与视图头的开关（`nbook.tasks.toggle-all-projects`）；`background` 只带前 20 件与修剪的第 2 步；真实子代理驱动停不下来得 `stop-failed`、`kill` 工具文案与远程 `killJob` 的码；结束而回执未领的任务仍出行、归属是根会话（子会话里起的任务）、停已结束的得被拒；组头与留话行的开始时刻、起标题的会话不出行、运行已收口时用旧键停得被拒；`focus-session` 按祖先判归属、编辑区页面等它的结果与失败提示；提问作参数时按字节裁短（标题与命令输出上游已截，分辨不出）。
- 内核问题（t42 第 3 片 omp 5，[`evidences/s3-review-omp.txt`](../t42-task-list-providers/evidences/s3-review-omp.txt) 第 5 条）：停止等待者找不到已写的命令记录时用旧 `head` 补 seq、`abortCommand` 无条件交回已中止，收口批写不下时仍报已受理。
- 偶发（[t42 README](../t42-task-list-providers/README.md) 的“待查”）：`agent-subagents.e2e.ts` 验收 2 卡片停在“运行中”，第 3 片之前的提交与分支同样约 2/15；窗口收到了最后一份树推送，卡片与这一轮都没跟着变。

## 当前状态

2026-11-23 经 nbdev 新建，尚未开工。

## 下一步

先补中档断言、逐句去标记（核对仍派 Opus 逐句对断言）；内核那一项先写计划，按高风险后端走快速审查；偶发另起探针，查窗口会话宿主的 `publishSubtree` 与过程区收起时卡片的卸载。
