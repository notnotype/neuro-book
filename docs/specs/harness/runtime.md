---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.runtime
owners:
  - nb-harness
---

# Harness 运行：指令、循环与运行结果

## 目标与非目标

给宿主一台由日志驱动的状态机：指令进、事件与帧出。用户的话先进输入缓冲区，取走时才成为对话里的事实；一次运行是可能有好几轮的 ReAct 循环，每次模型请求前由视图算出请求，回复与失败都写回日志。宿主能等一次运行结束、取它的结果。

本文件随实现逐步补齐：工具与拦截、其余指令（改、删、应答、回退、切分支、fork、压缩、换设置、换 Profile、标题与归档）、中止的宽限期、等用户、预览随后续条目追加。日志与恢复见 [`harness/session.md`](session.md)，扩展见 [`harness/extensions.md`](extensions.md)，模型端口见 [`harness/models.md`](models.md)。

不承诺：

- 运行中途换模型：模型按每次请求时的核心设置解析。
- 自动重试服务商的失败：失败以 `modelFailed` 收口，是否重来由用户或扩展决定。

## 术语与参与者

- **输入缓冲区**：提交了还没取走的用户的话，session 作用域；每条带 `steer` 或 `followup` 模式。
- **运行**：`runStarted` 到 `runEnded` 之间；**轮**：`turnStarted` 到 `turnEnded` 之间，从一条输入开始（没有新输入的“继续”运行除外）。
- **受理批**：指令受理时写下的写入批。
- **帧**：向外吐的东西：`log`（日志事件）、`delta`（流式增量）、`status`（运行状态）、`diagnostic`、`reset`。

## 输入与前置条件

指令的参数、成功值与失败码以 `@notnotype/nb-harness/kernel/contracts` 导出的 `CommandMap` 与 `commandErrors` 为准；每条指令带 `commandId`。会话由 `createSession(env, options)`、`openSession(env, id)` 得到，`closeSession(session)` 关闭；`SessionEnv` 由宿主注入（存储、Profile 解析、模型端口、工具、资源、时钟、审批钩子）。

## 输出与可观察行为

1. `send` 的输入为空（文字去掉空白后为空且没有附件）时失败 `empty-input`，不写日志。
2. 会话空闲时 `send` 的受理批依次是 `inputQueued`、`runStarted`、`inputConsumed`、`turnStarted`、`input`、`commandAccepted`，成功值带新输入与新运行的 id；有运行在进行时只写 `inputQueued` 与 `commandAccepted`，成功值的 `runId` 为 null。
3. `enqueue` 只写 `inputQueued` 与 `commandAccepted`，成功值带它在缓冲区里的位置。
4. `start`：有运行在进行时失败 `already-running`；缓冲区不空时取走第一条开一轮；缓冲区空、且还没有轮或最后一轮已正常结束时失败 `nothing-to-continue`；否则开一次没有新输入的“继续”运行（`turnStarted.inputId` 为 null）。
5. 会开始运行的指令在开始前就能判定的失败是指令失败、不写日志：会话只读得 `read-only`，模型端口解析不到模型得 `no-model`、解析不到凭据得 `no-credentials`。
6. 每次模型请求之前写 `modelStarted{request, purpose: "turn", model, hash, now, invocation, modifiedBy}`；`request` 在一个会话里单调增加。回复写成 `assistant`（内容块、工具调用、停止原因、用量、作答的模型），失败写成 `modelFailed`。
7. 回复里没有工具调用：写 `turnEnded{completed}`；缓冲区里有 `followup` 时，同一个写入批里取走最早的一条开下一轮（`inputConsumed`、`turnStarted`、`input`），同一次运行接着请求；没有时写 `runEnded{completed}`。
8. 模型失败：写 `modelFailed{kind}`（类别见 [`harness/models.md`](models.md) 输出 2），之后 `turnEnded{error}`、`runEnded{reason: "error", error: {kind, code?}}`。
9. `abort` 触发当前运行的中止；模型请求以 `modelFailed{kind: "aborted"}` 收口，之后 `turnEnded{aborted}`、`runEnded{aborted}`。没有运行时成功值为 `{aborted: false}`，不写日志。
10. Profile 的 `prompt`、`system` 或 `turn` 抛错时这次请求算不出来：写 `extensionFailed{entry}`，运行以 `error`、码 `profile-failed` 收口。
11. 对话事件写入时，内核按当时的轮盖位置章：进行中的轮还没有回复时是这一轮的附带内容，有了回复是最后一步之后，没有进行中的轮是“等下一轮”。回复与工具结果不盖章。
12. 流式增量以 `delta` 帧推出，带请求序号与从 1 起递增的编号，不进日志。运行状态的变化（阶段、中止中、损坏）以 `status` 帧推出。
13. `waitRun(runId)` 在运行结束、会话回到空闲之后完成，结果同 `runResult(runId)`：结束原因、停止原因（运行以收尾工具结束时为 `finished`）、最后一条回复的文字、运行结果、错误、用量、这次运行写下的事件的 seq 范围。用量是这次运行全部回复与非对话请求的用量之和，有一条不完整总和就不完整。运行结束后（包括重开之后）`runResult` 照样能取。
14. 请求的样子由 Profile 定（规则在 harness 的 Profile Spec，待建）：不写模板时依次是系统提示词与稳定的槽、开场槽、已提交的轮、进行中的这一轮（附带内容在前、用户的话在最后）、会变的槽。

## 状态与转换

| 运行状态 | 事件 | 下一状态 |
|---|---|---|
| `idle` | 开始运行的指令被受理 | `running` |
| `running` | `abort` | `aborting` |
| `running`、`aborting` | `runEnded` 写下、循环结束 | `idle` |
| 任意 | 写日志失败 | `broken` |

时序与寿命：

- 指令的受理（校验与写受理批）在单写者队列的一项里做；两条指令的校验看到的状态不会交错。
- 运行循环在队列之外：它每次写日志都排进队列并等写完；等模型的时候不占队列，所以运行中的入队不必等运行结束。
- 中止不经队列：立刻触发信号，收口作为队列里的一项写入。
- `waitRun` 完成时会话已经空闲：紧接着发下一条不会得到 `already-running`。

## 副作用与数据

只写日志（[`harness/session.md`](session.md)）与推帧。模型请求经模型端口发出。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `empty-input` | 输入为空 | 不发 |
| `already-running` | 有运行在进行 | 等它结束，或先 `abort` |
| `nothing-to-continue` | 没有可继续的 | 发一条新的话 |
| `read-only` | 会话只读 | 换一个能用的 Profile 或新建会话 |
| `no-model`、`no-credentials` | 模型或凭据没配 | 去设置里配 |
| `log-broken` | 日志写失败过 | 关闭后重开 |
| `session-closed` | 会话已关闭 | 重新打开 |

运行以 `error` 结束时 `runEnded.error.code` 的内核码见 `runErrorCodes`（`profile-failed`、`no-model`、`internal` 等）。

## 边界与兼容

- 公开接口：`createSession`、`openSession`、`closeSession`、`SessionApi`（`/kernel`），指令与帧的类型和码表（`/kernel/contracts`）。
- 指令与失败码只加不改；远程服务把它们逐个暴露成方法与错误码。

## 验收与 Smoke

1. 内存存储与会话目录上的 JSONL 存储各跑一遍：一轮对话的受理批与收口；第二轮的请求带上第一轮；重开之后接着聊；重发同一个 `commandId` 只生效一次（重启之后同样）。
2. 空闲时入队的 followup 在这一轮结束后开下一轮，同一次运行，用量是两次回复的和。

Smoke：`packages/nb-harness/tests/kernel/kernel.llm.test.ts`（`bun run test:llm`）。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)
