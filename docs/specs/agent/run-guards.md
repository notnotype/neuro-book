---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.run-guards
owners:
  - nbook.agent
---

# Agent 的运行保护

## 目标与非目标

让 Agent 能长时间无人值守：`nbook.agent` 经自己的 `agent.extensions` 贡献点默认装上两个扩展，一个管费用告警与上限，一个管重复的工具调用；并提供一组用户级设置，含模型请求重发的次数（重发本身见 [`harness/runtime.md`](../harness/runtime.md) 输出 62–69）与卡死超时（[`models.service`](../models/service.md)）。

不承诺：

- 费用上限是软上限：只在发请求前判断，最后一次可能超出。
- 单价未知的模型不计入费用，上限对它不起作用，只给一次提示（输出 5）。
- 子代理的费用不并入（还没有子代理）。
- 换模型回退、等额度恢复；“说了要继续却停了”的检测；模型重复循环的纠偏提醒。
- 对话界面怎样显示这些事件不在这里定。

## 术语与参与者

- **费用累计**：内核按会话算的 `ctx.spend`（[`harness/runtime.md`](../harness/runtime.md) 输出 70），不分分支。
- **重复调用**：一条回复里的工具调用，与上一条回复逐个相同（工具 id 与参数相同，参数键的顺序不算，调用的顺序不算）。

## 输入与前置条件

设置项（[`settings/configuration.md`](../settings/configuration.md)）都只允许用户层，0 表示关闭或不设，都显示在 `nbook.agent` 贡献的 list 分区“运行可靠性”（`category: "ai"`）里：

| 设置 | 缺省 | 范围 | 含义 |
|---|---|---|---|
| `nbook.agent/modelRetries` | 10 | 整数 0–20 | 模型请求失败后最多重发几次 |
| `nbook.agent/toolLoopThreshold` | 5 | 整数 0–100 | 连续多少次重复调用算循环 |
| `nbook.agent/warnCost` | 0 | 不小于 0，美元 | 费用告警线 |
| `nbook.agent/maxCost` | 0 | 不小于 0，美元 | 费用上限 |
| `nbook.models/streamFirstEventTimeoutSeconds` | 300 | 整数 0–3600 | 等第一个事件的时限 |
| `nbook.models/streamIdleTimeoutSeconds` | 300 | 整数 0–3600 | 流中途没有事件的时限 |

## 输出与可观察行为

默认装上：

1. 每个会话都装着 `nbook.agent.cost-guard` 与 `nbook.agent.loop-guard`，快照里状态 `active`。设置在每次判断时现读，改了立刻生效，不进 Profile 哈希。
2. `nbook.agent/modelRetries` 交给内核作重发的上限；改了下一次失败就生效。

费用：

3. 费用到告警线（`warnCost > 0` 且累计不小于它）时写 `costWarned{spent, limit}`。同一条线只告警一次；调高告警线后，到新的线再告警。
4. 费用到上限（`maxCost > 0` 且累计不小于它）时，下一次模型请求不发。对话请求的运行以 `error`、码 `cost-limit` 收口；调高或关掉上限后 `start` 接着跑。拦下不算花费：`ctx.spend` 不变，`runResult` 的 `usage.cost` 不会因此变成 null。预览（`phase` 为 `preview`）不被拦。
5. `warnCost` 或 `maxCost` 设了、会话第一次出现单价未知的请求时，写一次 `costUnpriced`。
6. 压缩与审批的请求到上限同样不发，按它们自己的失败处理（压缩换方法或失败，审批走现有退路）；下一个对话请求再以 `cost-limit` 收口。只压缩的运行结果是 `compaction-failed`，日志里那条 `modelFailed` 的码是 `cost-limit`。

重复调用：

7. 连续重复调用到阈值（`toolLoopThreshold > 0`）时，写 conv 事件 `redirected{tool, count, args}`，渲染成一段提醒，在请求里排在这一步的工具结果之后；`args` 是参数摘要，至多 400 字。计数从 0 重新开始。
8. 提醒之后同一组调用又连续重复到阈值，且这段重复里每步的工具结果（状态与文字）都相同：写 `stopped`，这一步的工具照常跑完，下一次模型请求不发，运行以 `error`、码 `tool-call-loop` 收口。结果有不同时只再提醒一次，不停。
9. 中途出现别的调用，或回复没有工具调用：计数与“提醒过”都清掉。
10. 停下之后，`start` 仍以 `tool-call-loop` 收口；用户发新话（开新的一轮，或 steer）后解除。
11. 回退与切分支后，计数与停止状态跟着新叶子走。
12. 预览不被拦。

## 状态与转换

无。

## 副作用与数据

两个扩展的事件都在会话日志里。`costWarned`、`costUnpriced` 是 session 作用域的 `ext` 事件；`redirected` 是 `conv` 事件；`stopped` 是 path 作用域的 `ext` 事件。

新增扩展改变 Profile 哈希：这个版本之前的会话打开时写一条 `profileChanged{code-updated}`，已提交的轮逐块一致。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `cost-limit` | 费用到上限，请求没发 | 调高或关掉 `maxCost` 后 `start` |
| `tool-call-loop` | 重复调用，提醒后仍没有改 | 用户发新话，或把阈值设 0 |

## 边界与兼容

事件与码只加不改。

## 验收与 Smoke

1. 真实内核上：一次 503 之后成功，上限恰好被第一次的费用用完，第二次不发，运行以 `cost-limit` 收口。
2. 真实内核上：这个版本之前写下的、费用已超上限的会话，打开后第一次请求就被拦下。
3. 真实项目子进程：新会话快照里两个扩展都是 `active`。

Smoke：`packages/neuro-book/src/plugins/agent/run-guards.llm.test.ts`（`test:llm`，真实模型）。

## 证据

- 批准依据：[w00032 t27](../../../.agents/works/w00032-agent-integration/tasks/t27-run-reliability/README.md) 的决定与[第二稿计划](../../../.agents/works/w00032-agent-integration/tasks/t27-run-reliability/plan.md)；开发者 2026-11-04 确认。
