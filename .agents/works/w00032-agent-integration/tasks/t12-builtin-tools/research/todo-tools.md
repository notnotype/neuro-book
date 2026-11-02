# 待办工具调研：omp、Codex、Claude Code（2026-11-02）

供 t12 设计 `todo` 工具。omp 部分由主会话读本机安装的源码整理；Codex 与 Claude Code 部分由调研子代理（Claude Sonnet）读一手来源整理：Codex 取自 GitHub `openai/codex` main@`3026a8e54e0f`，Claude Code 取自 npm `@anthropic-ai/claude-code` 各版本发布内容、官方 CHANGELOG 与官方文档。

## omp（`@oh-my-pi/pi-coding-agent` 18.14.1，本机全局安装的源码）

来源：`src/tools/todo.ts`、`src/prompts/tools/todo.md`、`src/session/todo-tracker.ts`、`src/prompts/system/eager-todo.md`、`src/prompts/system/mid-run-todo-nudge.md`。

### 工具

只有一个工具 `todo`，用 `op` 切换九种操作：`init`、`start`、`done`、`rm`、`drop`、`block`、`unblock`、`append`、`view`。审批等级为读（`approval = "read"`），并发为独占，按需加载（`loadMode = "discoverable"`）。

### 参数

| 字段 | 类型 | 用于 |
|---|---|---|
| `op` | 上面九个之一，必填 | 全部 |
| `list` | `{phase: string, items: string[]}[]` | `init`：按阶段建清单 |
| `items` | `string[]` | 不分阶段的 `init`，或 `append` 追加 |
| `task` | `string`，任务的原文 | `start`、`done`、`drop`、`rm`、`block`、`unblock` 的目标 |
| `phase` | `string` | 按阶段操作，或 `append` 的目标阶段 |
| `reason` | `string` | `block` 的原因 |

- 任务按原文标识，不用生成的 id（说明里写 “NEVER generated IDs (task-1)”）。
- 清单分阶段（phase），每项 `{content, status, blocker?}`；状态 `pending`、`in_progress`、`completed`、`abandoned`（`drop`）、`blocked`。
- 漏写 `op` 时按参数形状推断（有 `list` 是 `init`，有 `items` 与 `phase` 是 `append`），推断不了就报参数错误。

### 状态规则

- 每次变更后自动规范：同时只能有一项 `in_progress`（多余的退回 `pending`）；没有进行中的就让最早的 `pending` 开始。
- `blocked` 不会自动开始，`unblock` 后回到 `pending`；完成的不会被重新打开。
- 一批操作里有任何错误，整批不落（防止重试时撞上“已存在”）。

### 交回给模型的结果

纯文本摘要（`formatSummary`），例如：

```text
Remaining items (2):
  - 写测试 [in_progress] (实现)
  - 跑验证 [pending] (验证)
Overall: 3/5 done, 2 open.
Active phase 2/3 "实现" (1/2).
  调研:
    - [X] 读代码
  实现:
    - [X] 改接口
    - [ ] 写测试 (in progress)
  验证:
    - [ ] 跑验证
```

出错时开头加 `Errors: …`；清单空时为 “Todo list cleared.” 或 “Todo list is empty.”。`details` 里带完整的阶段与状态（给界面与恢复用），`view` 不改状态。

### 说明里的关键约束（`prompts/tools/todo.md`）

- `todo` 不单独占一轮：和下一个真正的工具调用放在同一次回复里并行发出（“A response whose only call is todo wastes a full model round trip”）。
- 3 步以上、用户列了多项、或有新指令时，开工前 `init`；用户列出的每一项都要单独成为一项。
- 完成后立即 `done`，按阶段顺序推进；等外部（用户、别的 Agent、服务）时用 `block` 写原因。

### 状态存放与提醒

- 状态就是最近一次成功的 `todo` 工具结果的 `details`（会话日志里），恢复、回退、fork 时从当前分支重建；用户在界面上改清单另记一条自定义条目。
- 界面有清单的悬浮显示（HUD），可收起。
- 首轮提醒（eager todo，可配置为不提醒、提醒、强制）：用户第一条消息时注入系统提醒，建议或强制先 `init` 一个分阶段的清单（每项 5 到 10 个词）。
- 运行中提醒：还有未完成项时提示“完成了就标记”。
- 停止时提醒：一轮结束而清单还有未完成项，自动续一轮提醒，有次数上限；压缩之后也会再注入提醒。

## OpenAI Codex CLI

### 工具

只有一个 `update_plan`（`codex-rs/core/src/tools/handlers/plan_spec.rs`、`plan.rs`），没有读取工具、逐条增改与 id。它是检查清单，不是 Plan 模式（Plan 模式是在回复里输出 `<proposed_plan>` 块，Plan 模式下调用 `update_plan` 报错）。

时间线：2025-07-29 引入（`8828f6f08`）；2025-08-13 把行为提示从工具说明挪进主提示词（`30ee24521`）；2026-07-24 加配置 `tools.update_plan.enabled`；2026-08-31 改为默认关闭（`a9519cbcd` “Make the update_plan tool opt-in”），关闭时从各处提示词里去掉它的指引。

### 参数（整份替换）

| 字段 | 类型 | 必填 |
|---|---|---|
| `plan` | `{step: string, status: "pending" \| "in_progress" \| "completed"}[]` | 是 |
| `explanation` | string | 否 |

程序不校验“至多一项进行中”。

### 返回

成功固定为 `Plan updated`，不回显清单；解析失败为 `failed to parse function arguments: …`。同时向客户端发计划更新事件（不落盘），界面显示 “Updated Plan · 已完成/总数 complete”。

### 说明与提示词里的约束

工具说明只有三行：“Updates the task plan. / Provide an optional explanation and a list of plan items, each with a step and status. / At most one step can be in_progress at a time.” 主提示词（`models-manager/prompt.md` 的 “## Planning”）：非平凡的多步任务才用，简单的或单步的不用（“roughly the easiest 25%”跳过）；每步 5 到 7 个词；在全部完成前始终恰好一项进行中，一次调用可以标完多项；调用后不要复述清单（“the harness already displays it”）；改计划时写 `explanation`。

### 状态

服务端不存，清单只在模型的调用参数（对话历史）与界面里；没有再注入当前清单的代码。

## Anthropic Claude Code

### 三代工具

| 代 | 工具 | 时间 |
|---|---|---|
| 一 | `TodoWrite` + `TodoRead` | 0.2.93（2025-04-30）起 |
| 二 | 只有 `TodoWrite` | `TodoRead` 在 1.0.44（2025-07-07）去掉；1.0.90（2025-08-24）起每项是 `content`、`status`、`activeForm`，没有 id 与 priority |
| 三 | `TaskCreate`、`TaskGet`、`TaskList`、`TaskUpdate` | 2.1.16（2026-01-22）起，逐条增改，有依赖 |

2.1.233 起，对较新的模型默认不再提供这些工具；官方文档的理由：“On newer models, Claude keeps track of multi-step work without a written checklist, and the tools' definitions and reminders take up context.”（code.claude.com 的 tools-reference）。

### 参数

- `TodoWrite`（二代）：`todos: {content: string, status: "pending" | "in_progress" | "completed", activeForm: string}[]`，整份替换，`content` 是祈使句（“Run tests”），`activeForm` 是进行时（“Running tests”，进行中时显示在状态行）。
- `TaskCreate`：`subject`（必填，祈使句标题）、`description`（必填）、`activeForm`（可选）、`metadata`（可选）；新任务固定 `pending`，系统分配自增 id。
- `TaskGet`：`taskId`。`TaskList`：无参数。
- `TaskUpdate`：`taskId` 必填，其余可选：`status`（`pending`/`in_progress`/`completed`/`deleted`）、`subject`、`description`、`activeForm`、`owner`、`addBlocks`、`addBlockedBy`、`metadata`。

### 返回

| 工具 | 成功返回 |
|---|---|
| `TodoWrite`（1.0.11 起） | “Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable”，不回显清单（0.2.93 时回显新清单 JSON） |
| `TaskCreate` | `Task #{id} created successfully: {subject}` |
| `TaskGet` | 多行：编号与标题、状态、描述、依赖 |
| `TaskList` | 每行 `#{id} [{status}] {subject}`，带负责人与未完成的依赖 |
| `TaskUpdate` | `Updated task #{id} {改了的字段}` |

### 说明里的约束（`TodoWrite`）

- 3 步以上、非平凡、用户要求或给了多项任务、收到新指令时用；单一、琐碎、纯对话的不用；附正反例。
- “Exactly ONE task must be in_progress at any time (not less, not more)”；完成后立即标记，不攒着；只有完全做完才标完成，测试失败、实现不全、有未解决的错误都不算；遇到阻塞保持进行中，另建一项写要解决什么；不再相关的项从清单删掉。
- 主系统提示词另有 “Task Management” 一节，要求频繁使用。
- 三代的 Task 工具说明里没有“只能一项进行中”。程序层面两代都不校验。

### 状态与提醒

- `TodoWrite`：每会话每 Agent 一个 JSON 文件（`~/.claude/todos/`）；Task 工具：每任务一个文件（`~/.claude/tasks/<清单>/<id>.json`，有文件锁，可跨会话共享清单）。
- 提醒：距上次用清单工具满 10 个助手轮次、且距上次提醒也满 10 轮时，附一条系统提醒（“hasn't been used recently… This is just a gentle reminder - ignore if not applicable”），后面带清单全文。
- `TodoWrite` 在压缩后重新附上清单；Task 工具存在磁盘上，模型可以调 `TaskList`。
- 界面：清单面板，进行中项的 `activeForm` 显示在状态行；工具调用本身不在对话流里显示。

## 对照

| 项 | omp `todo` | Codex `update_plan` | Claude Code `TodoWrite` | Claude Code `Task*` |
|---|---|---|---|---|
| 工具个数 | 1（`op` 切换 9 种） | 1 | 1 | 4 |
| 更新方式 | 按操作增改，任务按原文定位 | 整份替换 | 整份替换 | 逐条增改，有依赖 |
| 每项字段 | `content`、`status`、`blocker?`，分阶段 | `step`、`status` | `content`、`status`、`activeForm` | `subject`、`description`、`activeForm`、`status`、`owner`、依赖、`metadata` |
| 状态 | pending、in_progress、completed、abandoned、blocked | pending、in_progress、completed | 同 Codex | 同 Codex 加 deleted |
| 只能一项进行中 | 程序自动规范 | 只写在说明里 | 只写在说明里 | 没有 |
| 返回 | 剩余项加整份清单 | `Plan updated` | 固定句子 | 一句话，`TaskList` 才回显 |
| 状态存放 | 会话日志里最近一次结果 | 不存 | 文件 | 文件 |
| 提醒 | 首轮、运行中、停止时、压缩后 | 无 | 10 轮提醒带清单、压缩后附上 | 10 轮提醒带清单 |
| 默认提供 | 是 | 2026-08 起默认关 | 较新模型默认不给 | 较新模型默认不给 |

## 未查到与局限

- Codex 压缩时对 `update_plan` 历史有没有特殊保留：未查到。
- Claude Code 的事实都读自发布产物（2.1.316 是编译后的二进制，只做了字符串搜索），按模型决定是否提供的完整判定逻辑没读到，以官方文档和 CHANGELOG 为准。
- 调研留档（源码与 npm 解包）在本机 `/tmp/research-todo/`，不入库。
