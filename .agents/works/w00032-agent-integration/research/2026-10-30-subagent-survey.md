# 各家 code agent 的子代理设计（2026-10-30）

- 问题：子代理工具的形状、结果怎样交回、续用、审批与提问、运行控制、父子关系，各家怎样做；父代理能不能做人类对子代理能做的操作（[t14](../tasks/t14-multi-agent/README.md) 第一轮第 5 条）。
- 做法：5 个 Haiku 子代理分头调研，主会话在 2026-10-30 的浅克隆（OpenCode、Codex、Kimi CLI 的 main 分支）与本机源码上核对关键处。
- 证据等级：**源码（核实）** 为主会话读过原文；**源码（走查）** 为子代理读源码、主会话没逐行复核；**文档** 为官方文档；**检索** 为搜索摘要，未读原文。

## 1. 对照表

| 产品 | 工具 | 续用与插话 | 结果 | 子代理的审批 | 模型 | 嵌套上限 |
|---|---|---|---|---|---|---|
| Claude Code | `Agent`；续用另用 `SendMessage`；停止 `TaskStop` | 按 id 或名字发消息 | 最后一条回复；后台以通知送达 | 继承主会话的权限模式；弹给用户，后台的在主会话里注明来源；**父代理不能批准、不能改权限** | 参数 `model`、`effort` 覆盖定义 | 3 |
| Codex（v2） | `spawn_agent`、`send_message`、`followup_task`、`wait_agent`、`list_agents`、`interrupt_agent` | `send_message` 排队不触发新一轮；`followup_task` 空闲时触发一轮，运行中在边界送达 | 进邮箱；`wait_agent` 只回摘要 | 继承父当时的审批策略、审批者（用户或审批模型）、目录与权限；父界面列出有待审批的其它线程 | 参数 `model`、`reasoning_effort`，缺省继承父 | 1 |
| OpenCode | 一个 `subagent`：`agent`、`description`、`prompt`、`model?`、`sessionID?`、`background?` | 给 `sessionID`：运行中的是插话，空闲的开新一轮；续用时可换 agent 与模型；只能续用自己的子会话 | 最后一条回复，包成 `<subagent sessionID state>` | 父会话视图汇总整个家族的权限请求，在父会话里答；按 agent 配 `ask`、`deny`，`deny` 的从工具描述里去掉 | 参数 `model`（描述写“用户没要求就不要设”） | 1 |
| Kimi CLI | `Agent`：`subagent_type`、`prompt`、`model?`、`resume?`、`run_in_background?`、`timeout?` | `resume` 按 id 续用 | 最后一条回复；太短时追加一次“请写完整” | 审批带来源（子代理 id、类型）进主界面 | 参数 `model` | 未查到 |
| omp | `task`：批量 `tasks[]`、`outputSchema`、`schemaMode`；子代理用 `yield` 交结果 | 写 `agent://<id>` 即发消息 | `yield` 的结构化结果；没交提醒最多 3 次；超 5000 字只给预览，全文在 `agent://<id>` | 子代理全放行，父的 `task` 调用就是授权边界；用户的工具规则仍生效 | 父不选，看定义与设置 | 2 |
| DeepSeek Harness | `subagent`、`subagent_fork`、`send_message`、`interrupt_agent`、`list_agents` | `send_message`：运行中下一步生效，空闲开新一轮，休眠的冷恢复；`interrupt_agent` 只许祖先调用 | 最后一条回复 | 子代理审批固定为“不问”，要审批的一律拒绝 | 开关打开后可在参数里给 | 1 |
| Gemini CLI | `agent_name`、`prompt` | 本地子代理不续用 | `result` 加终止原因（完成、超时、轮数到顶、中止、出错） | 策略引擎可按子代理配置 | 定义里写 | 不能嵌套 |
| Roo Code | `new_task`（模式、消息）；子任务用 `attempt_completion` 交回 | 不续用 | `attempt_completion` 的文字交回父任务，父任务恢复 | 派生与交回各审批一次，可设自动批准 | 随模式 | 未写 |
| Cline | `spawn_agent` | 未查到 | 最后一条回复 | 批准派生即批准子代理的全部动作 | 未查到 | 可嵌套 |
| Amp | Task | 可对同一子代理追加任务 | 最终摘要 | 缺省不问 | 与父同模型同推理档 | 未查到 |

出处：Claude Code 为文档与本机二进制 2.1.312 的字符串；Codex 为源码（核实）`codex-rs/core/src/tools/handlers/multi_agents_spec.rs`、`core/src/agent/child_config.rs:178`、`tui/src/bottom_pane/pending_thread_approvals.rs`；OpenCode 为源码（核实）`packages/core/src/tool/plugin/subagent.ts`、`packages/tui/src/routes/session/index.tsx:206-214`；Kimi CLI 为源码（核实）`src/kimi_cli/tools/agent/`、`subagents/runner.py`；omp 为源码（走查）`pi-coding-agent/src/task/`；DeepSeek Harness 为源码（走查）`packages/subagent/`；Gemini CLI 为 raw 源码（走查）与文档；Roo Code 为 GitHub 网页上的源码（走查）与文档；Cline、Amp 为文档，Cline 的工具名文档与检索摘要不一致。

## 2. 分维度的结论

### 2.1 工具形状

- 两派：一个工具包办（OpenCode、Kimi、Claude Code 的新建）与按操作拆开（Codex v2 六个、DeepSeek Harness 五个）。一个工具的写法里，“给已有 id 就是续用”是共同做法（OpenCode `sessionID`、Kimi `resume`）。
- 并行都靠“一个回复里多个调用”，只有 omp 在参数里批量。
- 类型目录多数写进工具描述（Claude Code、OpenCode、Codex、omp、Kimi）；OpenCode 把没权限的类型从描述里去掉，Gemini 不列、调用时按名字查。

### 2.2 结果

- 缺省都是“最后一条回复”。结构化结果只有 omp（`yield` 加 schema，严格与宽松两档）与 Roo（`attempt_completion`，只有文字）。
- 没交结果时：omp 提醒最多 3 次后接受并附警告；Kimi 嫌回复太短时追加一次；其余直接用最后一条。
- 过长：omp 超 5000 字只给预览、全文放可寻址的地址；Gemini 附终止原因与轮数、耗时。

### 2.3 续用与插话

- 能续用的都按子会话 id（Claude Code、Codex、OpenCode、Kimi、omp、DeepSeek Harness、Amp）。
- 插话与排队有两种：OpenCode、DeepSeek Harness 按目标状态自动决定（运行中是插话，空闲开新一轮）；Codex v2 让模型选（`send_message` 只排队，`followup_task` 触发一轮），v1 用 `interrupt` 开关表示“先打断再送达”。
- OpenCode、DeepSeek Harness 只许对自己的后代操作。

### 2.4 审批与提问

三种做法：

| 做法 | 谁 |
|---|---|
| 冒泡给用户，标明来源 | Claude Code、Codex、OpenCode、Kimi |
| 派生即授权，子代理里不再审批 | omp、Cline |
| 子代理里要审批的一律拒绝 | DeepSeek Harness；Codex 的非交互模式 |

- 都继承父会话当时的审批模式；Codex 还继承“谁来审”（用户或审批模型）。
- **没有一家让父代理替用户批准。** Claude Code 文档明确禁止父代理批准子代理的权限请求、改权限，并把来自其它代理的消息标为“非用户来源”。
- 子代理向用户提问：Claude Code、Kimi 未查到；omp 子代理没有界面，推断不能问；没有一家把子代理的提问交给父代理回答。

### 2.5 运行控制

- 父被中止：OpenCode、omp、DeepSeek Harness 把中止信号传给子代理；Codex 的 `close_agent` 连同后代关闭。
- 单独中止子代理：都能（用户在面板上，或父代理用工具）。
- 用户直接对子代理插话：Claude Code 可以打开子代理直接发消息；Amp 不行，只能经主代理转达。
- Codex v2 的 `wait_agent` 在用户往父会话插话时提前结束，父代理先处理用户的话。

### 2.6 父子关系与界面

- 子会话都是独立的会话或转录文件，头部记父会话（omp、DeepSeek Harness、OpenCode、Roo）；Codex 另有父子边的 SQLite 表。
- 界面：Claude Code 输入框上方的面板；OpenCode 在父子会话间用键盘切换；Codex `/agent` 切换线程，并列出有待审批的其它线程。

### 2.7 上下文与上限

- 缺省空白上下文（多数）；Codex v2 缺省继承父的全部历史（`fork_turns: all`），Claude Code、DeepSeek Harness 另有 fork。
- 嵌套都设上限：Claude Code 3、omp 2，Codex、OpenCode、DeepSeek Harness 1，Gemini 不允许。并发上限：Claude Code 20、Codex 6、DeepSeek Harness 8。

## 未验证边界

- Claude Code、Amp 闭源，只有文档与二进制字符串；父代理被中止时子代理怎样、子代理能否提问未查到。
- Roo Code、Gemini CLI 经网页读源码，行号不可靠；Cline 的工具名文档与检索不一致。
- Codex v2 的工具在实验开关后面，缺省用哪一版未核实。
