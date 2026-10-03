# Workflow 与 Job

Workflow 用一段**可重放的 TypeScript 脚本**编排多个 Agent。Job 是承载长任务生命周期的后台工作单元。

这两个概念解决的是同一类问题：有些活不是一次对话能干完的——要并发、要循环、要多轮评审、要跑十分钟。

## 什么时候用 workflow

**用 workflow**：

- 同一种多阶段流程会重复运行（拆书、并行脑暴、写作评审循环）
- 需要固定的扇出、汇合、循环或人工确认点，而不是让主 Agent 临场发挥
- 运行过程需要给你看状态图
- 需要一次拿回自定义结果 + 参与的 session + token 用量

**直接叫子 Agent 就够了**：

- 只有一个短任务，做完把结果交回来
- 流程还在探索，步骤会随调查结果大改
- 不需要可重放编排、并发控制或状态图

::: tip Skill 和 Workflow 的分工
Skill 提供**知识和方法**（怎么做），workflow 提供**确定的执行编排**（按什么顺序、并发几个、循环几轮）。不要为了打包一段说明文字去建 workflow。
:::

## 内置 workflow

| Key | 做什么 |
| --- | --- |
| `parallel-brainstorm` | 并行脑暴：多个临时 Agent 同时出想法，汇总去重 |
| `write-review-loop` | 写作评审循环：写 → 评审 → 修订 |
| `chapter-write-review-revise` | 章级完整链路：真实 writer 按契约把章节写进目标文件，一致性 / 节奏 / 文风三维并发评审，按 major 问题循环修订直到收敛 |
| `consistency-audit` | 一致性审计：逐章并发审计位置、伤势、物品、认知、时间线、设定矛盾，再跨章汇总 |
| `split-book` | 拆书：逐章并发摘要 + 剧情合并分析 |
| `book-deconstruct` | 商业拆书：按章采样，逐章拆解钩子 / 承诺 / 爽点 / 节奏 / 信息披露 / 章末推力，产出竞品分析报告 |
| `character-qa-fanout` | 角色问答批量候选：按组并发为每题生成多个候选答案并汇总矛盾 |

Agent 通过 `WorkflowCatalog` 看到可用列表，用 `run_workflow` 触发。

## adhoc Agent

Workflow 里的大部分步骤不需要完整的内置 profile——只需要"一段提示词 + 一个输出结构"。这类临时 Agent 叫 **adhoc**：声明提示词和 outputSchema 就能跑，用完即弃，不落 profile 目录。

`chapter-write-review-revise` 是个刻意的例外：它的写作环节用**真实的 `writer` profile**，因为要按 Leader-Writer 契约真正落盘写章，adhoc 承担不了。

## 后台 Job 与任务中心

`run_workflow` **默认后台执行**。触发后 Agent 立刻拿到一个 job 句柄并正常结束当前回合——不会卡在那里空转等结果。任务跑完，结果通过系统消息**回流**触发新一轮对话。

Agent 手里有三个 job 工具：`list_jobs`、`get_job`、`cancel_job`。`invoke_agent` 和 `bash` 也支持 `background` 参数走同一套机制。

你这边的入口是顶栏 **Jobs**：

- 徽标显示当前运行中的任务数
- 面板可以按状态分组过滤、查看详情、复制结果、取消任务、清除已结束记录

Workflow 运行时聊天里会有独立气泡展示状态图，双击可以打开完整的运行详情。

::: warning 取消语义
取消是有界的——对不响应中断信号的 provider 或工具，系统会在边界处强制收口，已经发出的迟到写入不会被提交。取消后 job 和 run 的状态以 run 的真实终态为准。
:::

## 写自己的 workflow

每个 workflow 独占一个目录，入口固定是 `workflow.ts`：

```text
agent/workflows/
└── my-workflow/
    └── workflow.ts
```

三层覆盖，按 key 寻址：

| 层 | 位置 |
| --- | --- |
| 系统内置 | 随 NeuroBook 分发 |
| 用户层 | Workspace Root 的 `.nbook/agent/workflows/<key>/workflow.ts` |
| 项目层 | 当前项目根的 `.nbook/agent/workflows/<key>/workflow.ts` |

同名时**整个条目覆盖**，不合并。项目层只在调用方显式绑定该项目时才读取——项目 workflow 不会泄漏到其他项目。

面向用户运行的 workflow 必须提供 `wf.chart` 状态图，这样运行过程才能被看见。

## 继续阅读

- [Workflow Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/workflow/README.md)：选用边界、目录覆盖、`run_workflow` 契约。
- [Workflow 编写](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/workflow/authoring.md)：定义、参数、并发、返回值与确定性约束。
- [状态图规范](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/workflow/chart.md)：`wf.chart` API 与构图规范。
- [Agent 工具](/agent/tools)：`run_workflow` 与 jobs 工具的位置。
