---
schema: nbook.task/v2
taskId: t14-multi-agent
status: planned
updated: 2026-10-30
---

# 多 Agent 与 Workflow

## 目标与范围

定子 Agent：派生与授权、前台与后台、结果回流、父子关系与审批冒泡，以及 Workflow 与 Agent 的关系。

来源：需求 8；清单外第 7 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 派生与授权：父会话批准派生就算授权（分支提案的设想）。
- 前台阻塞与后台运行，结果怎样回流；用收尾工具交回结果。
- 父子关系与列表、分离；子代理用的模型。
- 子代理遇到审批：直接失败还是冒泡到父会话的界面。
- Workflow（nb-workflow）与 Agent 的关系。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 5 节多 Agent
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、5 节子代理
- 分支上的 `docs/proposals/agent-harness-kernel.md` 非目标里的子代理设想

后台调用子代理与 shell 后台命令统一放进 [t22](../t22-background-work/README.md)（2026-10-28），本 Task 只讨论前台调用、创建 Profile、审批转父会话与关系。

## 前置

t05、t06、t07。

## 决定

第一轮（开发者 2026-10-30）：

1. 不提供查询 Profile 目录的工具：可派的 Profile 经资源地址给出，模型用 `read` 读（t08 的资源方案）。
2. 结果的三种交回方式：
   - 自由：子代理停下，就把最后一条回复交回（与多数 code agent 相同）。
   - 结构化（可选）：提供“返回结果”工具，子代理一调用就结束运行、交回它的参数；没调用就停下时，交回最后一条回复。
   - 结构化（强制）：必须调用“返回结果”工具；停下时没调用就催一次，仍没有就以最后一条回复作结果并标为 error。
3. 嵌套不另设开关：子代理拥有派子代理的工具，就能再派。
4. 父子是平级的会话：各是一个会话文件，彼此记着关系；父会话知道自己派过哪些子会话，也能经资源地址查到。
5. 父代理能做人类对子会话能做的操作：指定模型角色或模型与推理档、插话、排队、审批等。子代理工具按这条重新设计。

第二轮（开发者 2026-10-30）：

6. 工具设计原则：一个工具只做一件事，宁可工具多，不设计复合工具；以后所有工具都按这条（记在 [t04](../t04-tool-registry/README.md)）。工具描述多出多少做实验量。子代理工具对照前后端的会话接口（提案的 `v5/host.ts`）来设计。

7. 查会话的全部历史另开 [t23](../t23-session-history/README.md)，先搁置；暂时由 Agent 直接读原始日志文件。
8. 审批一律交给用户，父 Agent 不审批。
9. 提问缺省交给调用方（父 Agent），父 Agent 可以自己答；另有开关把提问直接交给用户。
10. 能转后台的工具都有一个转后台的选项，打开时立即返回一个任务 id；所有后台任务（后台 shell、后台子代理）统一由一个任务中心管理，用户在前端也能看到，Agent 用同一组工具等待与停止（方向，细节在 [t22](../t22-background-work/README.md)）。
11. 不要 `agent_settings`；`agent_continue`、`agent_abort`、`agent_status` 与 `agent_answer`、`agent_approve` 看能否合并。

工具形状、审批与提问、运行控制先调研各家 code agent 再定：[调研](../../research/2026-10-30-subagent-survey.md)（Claude Code、Codex CLI、omp、DeepSeek Harness、OpenCode、Gemini CLI、Kimi CLI、Roo Code、Cline、Amp）。

## 当前状态

讨论中（2026-10-30）：第一轮定了上面五条；调研完成，按调研重新设计子代理工具，待开发者讨论。

## 下一步

调研汇总写进 Work 的 `research/`，据此重新设计子代理工具，与开发者讨论后再写计划。
