# Agent 取消与错误展示修复

## Relative documents refs

- [Task 07 Agent Turn Commit Boundary](../07-agent-turn-commit-boundary/README.md)
- [Task 138 Agent 对话分支投影修复](../138-agent-conversation-branch-projection/README.md)
- [neuro-agent-harness.ts](../../../server/agent/harness/neuro-agent-harness.ts)
- [agent-message.ts](../../../app/components/novel-ide/agent/agent-message.ts)
- [useAgentSession.ts](../../../app/components/novel-ide/agent/useAgentSession.ts)

## User Request / Topic

用户报告三个现象：

1. 界面上出现英文的 `Request was aborted`。
2. 错误气泡有时候会出现两次。
3. 取消（停止）运行有时候不生效。

## 调研结论：三个现象是同一处设计缺陷的三个侧面

「用户主动取消」在整条链路上没有独立身份，它被塞进了「运行出错」的通道。因为它其实不是错误，文案、去重、状态机、消息持久化四处都出现了不一致。

调研基于 `workspace/.nbook/agent/sessions/` 全部 556 个真实会话文件 + 完整代码路径追踪。

### 实测数据（修复前）

| 事实 | 数量 |
|---|---|
| durable Run Error（`invocation_lifecycle: error` 且有正文，会渲染成卡片） | 188 |
| `invocation_lifecycle: aborted` 且有正文（**不渲染**，`chatEntryKind` 不认 aborted） | 40（其中 **38 条**正文是 SDK 英文原文） |
| 出错或取消的 invocation 合计（去重） | 228 |
| aborted 正文分布 | `Request was aborted` 21 / `Request was aborted.` 17 / `user abort` 2 |
| 同一 invocation 同时有 durable assistant error 和 lifecycle error | **0** |
| **取消时保留了半截生成正文的** | **0 / 40** |

错误文案 top：`503 gateway_error` 92 · `Request was aborted` 38 · `400 (no body)` 13 · sidecar 失败 27 · `401 Invalid API Key` 9 · `流式连接异常中断` 4 · `配置未设置 models.default` 4。

## 四个根因

### 根因 1 · 取消被当成错误，SDK 英文原文被持久化

provider SDK `throw new Error("Request was aborted")` → `toRunKernelErrorInfo()` 变成 `InvocationErrorInfo{message, phase}` → 作为「错误详情」写进 `lifecycle: aborted`。`InvocationErrorInfo` 没有字段表达「这是用户主动取消」，取消与出错只在 `lifecycleStatus` 上区分，而所有消费方只读 `message`。

代码里准备了中文兜底两处（`neuro-agent-harness.ts` `executeTurn`、`agent-message.ts` `message_end`），都写成「SDK **没给**详情时才用中文」。SDK 每次都给了详情，所以中文兜底**一次都没轮到过**，i18n key `agent.userInput.assistantAborted` 是死代码。

英文泄漏三个写入点：`failInvocation`（SDK 原文）、`abortInvocationMatching` waiting 路径（硬编码 `"invocation aborted"`）、`forceAbortInvocation`（硬编码 `"invocation aborted after cancellation grace period"`）。

补充：`chatEntryKind()` 只认 `status === "error"`，**不处理 `status === "aborted"`**，所以那 40 条 aborted 账本记录根本不投影成气泡——用户看到的英文来自 **live 流式层**，刷新后整条消失。

### 根因 2 · 半截消息的持久化协议从未生效（Task 07 契约破窗）

[Task 07](../07-agent-turn-commit-boundary/README.md) 定下「provider error / abort 的 assistant 可以在 turn terminal 时写入」，配套实现齐备（`sanitizePartialAssistant()` / `messageStatus: "interrupted"` / `executeTurn` 的 `stopReason === "aborted"` 分支）。**但实测 40 次取消 0 次保存过半截消息。**

原因在 `streamAssistant` 的流式循环：真实 provider SDK 用**抛异常**表达取消，异常一抛 `await stream.result()` 永不执行，已接收文本烂在 stream 内部；异常冒泡后走 `createRuntimeErrorAssistant(error)`（正文为空）→ `sanitizePartialAssistant` 因无非空文本返回 `null` → 什么都不写。

**为什么测试没照出来**：faux provider 的 abort 行为与真实 SDK **不一致**——faux 推一个 `{type: "error", reason: "aborted"}` 事件并 `stream.end(createAbortedMessage(partial))`（**保留 partial**），真实 SDK 则直接 `throw`（`anthropic-messages.js:225`、`openai-responses.js`、`google-generative-ai.js` 等全部如此）。测试替身比现实更宽容，于是这条路径在 CI 里一直是绿的。

**连带后果（与 Task 138 冲突）**：取消不留任何气泡 → 取消后重试**不会出现分支切换器**。这与 Task 138 ADR-1 已拍板的「报错必须算分支锚点，否则出现『跑挂之后切不回上一个好答案』的单向门」是同一个问题。

### 根因 3 · 错误气泡重复：去重挡不住真正的重复

错误有两个展示出口：live（`message_end` → assistant 气泡内嵌红字）与 durable（`invocation_error` → 独立 `Run Error` 卡片）。

旧去重是「已有 assistant error 就丢弃这条 `invocation_error`」。它在 `deriveMessagesFromChatEntries` 的 durable 折叠里**有效**，但对真正的重复无效：`useAgentSession` 收到 `session_entry` 时

```ts
const projected = applySessionEntryToMessages(messages.value, entry);   // 去重在这里发生
durableEntries.value = mergeDurableEntries(durableEntries.value, [entry]);  // ← 无条件写入，绕过去重
liveOverlay.value = projected.filter((m) => m.projectionSource === "live"); // 只取 live 层
```

去重结果只影响 `liveOverlay`，而 `invocation_error` 是 durable 的——`projected.filter(live)` 本来也过滤不到它。于是 live assistant 的红字 + durable 的 Run Error 卡片同时渲染。

**「有时候」的规律**：只有「模型已开始输出、中途才失败」才双气泡。启动前就失败的（401 / 配置缺失 / 缺 API Key）没有 live assistant，只有一个卡片；刷新页面后 live 层清空，也只剩一个。

durable 层实测 0 例重复，**服务端写入没有问题，纯粹是前端分层合成缺陷**。

### 根因 4 · 取消后前端永久卡在「正在停止」

`liveRunStatus` 的 `aborting` 出口是 `agent_end`。但 `emitRuntimeEvent` 有 fence：

```ts
if (frame.invocationId && !this.ownsInvocation(frame.sessionId, frame.invocationId)) return null;
```

走 `forceAbortInvocation` 时（150ms 宽限期到了运行还没结束），`finishInvocationState` 删除 `activeInvocations` 条目 → 之后 runLoop 的 `agent_end` 被 fence 静默丢弃 → **前端永远收不到终态**。waiting 路径同理：runLoop 早已返回，压根不会再发 `agent_end`。

唯一的备用出口 `applyRunState` 写着 `else if (liveRunStatus.value !== "aborting")`，恰好把 recovery 救援路也堵死。结果 `running` computed 含 `aborting`，停止按钮常亮、输入框禁用，只有切走会话再切回来才恢复。

**附带**：`runTurnTransaction` 的取消检查点问的是 `ownsInvocation`（这次运行还是本会话的当前运行吗），不是「用户按了停止吗」。running 路径的取消只把 `active.status` 改成 `"aborting"`，**不删条目、不换 id**，`ownsInvocation` 恒为 true，**该检查点对用户主动取消永不触发**。

## Decisions

| 编号 | 决策 | 理由 |
|---|---|---|
| ADR-1 | **取消不再走错误通道**：服务端写入点不再持久化 provider 原文；前端 `stopReason === "aborted"` 直接用 i18n 文案，不回落 SDK 文本 | 换 provider / SDK 升级都不会再泄漏英文。加 SDK 文案翻译表是 hack，违反 AGENTS.md |
| ADR-2 | **修复 Task 07 协议，保留半截消息（带 `interrupted` 标记）**，不妥协成丢弃 | 关键在标记而非保留与否——带标记的半截消息不会让 Agent 误以为自己写完了；且它天然是 assistant 锚点，取消后重试的分支切换器自动可用，**无需改 `chatEntryKind`、无需给 `aborted` 加特例、历史观感不变** |
| ADR-3 | **留痕靠 durable，前端只清重复**：Run Error 卡片是权威详情，它一到就清掉同一次运行 assistant 上的错误字段 | 有正文保留正文气泡，无正文整条移除。live 与 durable 两条路径结果相同，刷新前后一致 |
| ADR-4 | **撤回，不需要决策**：不给工具加 abort 响应 | 调研纠正：所有可能长跑的工具**都已响应取消**（bash / web_search / web_fetch / invoke_agent / run_workflow）。未接 signal 的（剧情 / 任务 / 世界引擎 / 记忆 / 本地 SQL）全是毫秒级本地操作。用户感知的「取消不生效」来自根因 4 |

新增不变量：**错误详情只记在 `invocation_lifecycle` entry 上，assistant entry 只承载正文。** 两处都写会让同一段错误在账本里留下两份，跨层合成时渲染成两个气泡。

## Implementation Walkthrough

### 批次 1 · 取消的终态必须送达前端（根因 4）

- `forceAbortInvocation`：在 `finishInvocationState` **之后**补发 `agent_end{status:"aborted"}`。必须在之后补——ownership 释放前补，残留 runLoop 的 `message_update` 会抢在终态之后把前端重新拉回 running。
- `abortInvocationMatching` waiting 路径：`finishInvocation` 后同样补发 `agent_end`。
- `useAgentSession.applyRunState`：删掉 `!== "aborting"` 守卫。服务端报「没有活动 invocation」就是权威终态，加守卫会让界面永久停在「正在停止」。
- `runTurnTransaction` 开头新增 `frame.abortSignal?.aborted` 检查（保留原有 `ownsInvocation` fence，两者语义不同）。放在 turn 开头而非 `executeTurn` 之后，是为了让上一轮已完成的工具结果照常 ingest 落盘，只拦住下一轮。

### 批次 2 · 保留半截消息（根因 2）

- `streamAssistant` 的流式循环包 try/catch，循环内留住最后一份 partial（`lastPartial`）。catch 只接管「用户取消」（`abortSignal.aborted` 且有 partial），其余异常按 provider 故障继续冒泡。
- 取消时构造 `{...lastPartial, stopReason: "aborted", errorMessage: undefined}` 并补发 `message_end`，其余链路**全部复用现成实现**：`executeTurn` 的 `stopReason === "aborted"` 分支 → `messageStatus: "interrupted"` → `createFailedRunLoopResult` 的 `terminalStatus: "aborted"` → `completeInvocation` 的 `lifecycleStatus: "aborted"`。
- catch 里**不跑** `sanitizeProviderAssistant`：流式中断处的 toolCall id 可能只收到一半，会撞上它的 public id 校验。持久化形态由下游 `sanitizePartialAssistant` 负责（它先剥掉 toolCall 再校验）。

### 批次 3 · 取消不再走错误通道（根因 1）

- `failInvocation` / `completeInvocation`：`aborted` 时 `error` 与 `errorInfo` 都传 `undefined`。日志与调用方返回值仍保留技术细节（诊断面不是用户面）。
- `abortInvocationMatching` / `forceAbortInvocation`：删掉英文兜底，只在调用方显式给了 `reason` 时才写正文。
- `executeTurn`：`stopReason === "aborted"` 时 `errorInfo` 用 `{message: "", phase: "model"}`，不再取 `assistant.errorMessage`。
- `agent-message.ts` `message_end`：拆开 `aborted` 与 `error` 两条分支，取消只标 `interrupted` 且 `error: undefined`。
- `MessageStatus` 新增 `"interrupted"`（原为 `"streaming" | "done" | "stopped"`，5 个消费点都只判 `"streaming"`，加宽安全）；`AgentTextBubble` 用中性灰字渲染「已停止生成」，不走 error 配色。i18n 新增 `agent.textBubble.interrupted`（中英）。

### 批次 4 · 错误气泡去重（根因 3）

- `applySessionEntryToMessages` 的 `invocation_error` 分支反过来写：不再丢弃 entry，而是清掉同一次运行 assistant 上的 `error`（有正文保留正文气泡，无正文整条移除），再追加 Run Error 卡片。同时作用于 live 与 durable 两条路径。
- `sanitizePartialAssistant` 落地新不变量：持久化的 partial 不再带 `errorMessage`。
- `messageFromChatEntry` 的 assistant 分支去掉 `content: entry.content.preview || entry.error?.preview` 回落——正文就是正文，不再用错误文本冒充正文。
- 删除死代码 `toLocalMessage`（唯一调用方是测试）与 `hasAssistantErrorForInvocation`。

## Verification / Test

- `bun run test app/components/novel-ide/agent/ app/utils/`：59 files / 371 tests 全绿。
- `bun run test server/agent/`：145 files / 1318 tests 全绿。
- `bun run typecheck`：**零错误**。
- 真实数据只读回归（556 个会话跑发货代码 `chatEntryKind` + `projectAgentChatEntry`）：
  - Run Error 卡片数 **188**，与修复前基线一致（本轮未改 `chatEntryKind`）。
  - 历史 40 条 `aborted` lifecycle **全部不新增气泡**，历史会话观感不变。
  - `(chatEntryKind(e) === null) === (projectAgentChatEntry(e) === null)` 不变量违例 **0**。
- 新增 / 改写测试：
  - `neuro-agent-harness.test.ts`「取消保留已生成的半截正文，且 lifecycle 不写 provider 原文」：断言半截正文以 `interrupted` 落盘、assistant 不含 `Request was aborted`、lifecycle 也不含。修复前两条断言都会失败。
  - `agent-message-projection.test.ts`「用户取消不展示 provider 英文原文，只标成 interrupted」。
  - `agent-message-projection.test.ts`「同一次运行的错误只展示一次」+「失败时没有正文的 assistant 整条移除」：取代旧的「已有 assistant error 时不重复展示 invocation error」（旧用例编码的是相反行为）。
  - 用真实 live 路径 `applyRuntimeEventToMessages` 重写了原先测试死代码 `toLocalMessage` 的用例。

### 测试覆盖的诚实边界

`streamAssistant` 新增的 catch 分支**没有被自动化测试覆盖**：faux provider 取消时推 error 事件并保留 partial，不抛异常，无法触发该分支。真实 provider 全部抛异常（已逐个核对 `node_modules/@earendil-works/pi-ai/dist/api/*.js`），该分支的正确性依据是代码走查 + 40/40 真实会话零保留的实测证据。要真正覆盖它需要引入一个会在流式中途抛异常的 provider 替身，属于测试基建改动，本轮未做。

### 待用户浏览器验收

- 模型开始输出后点停止 → 半截内容保留在气泡里，底部显示灰色「已停止生成」，**不是**英文 `Request was aborted`；停止按钮立即熄灭，可以马上发下一条。
- 取消后点重试 → 该消息上出现分支切换器，可切回被取消的那一版。
- 让慢工具（bash / web_fetch / 子 Agent）跑起来再点停止 → 界面不再卡在「运行中」。
- 制造一次流式中途的网关错误 → 只出现**一个**错误展示。
- 刷新页面 → 显示与刷新前一致。

## 已知边界

- 取消时若尚未生成任何正文，durable 不留任何气泡（`sanitizePartialAssistant` 无正文返回 `null`，`aborted` lifecycle 也不投影）。刷新后该次取消不可见——一条信息量为零的空卡片没有价值，属 ADR-2 的刻意取舍。
- `chatEntryKind` 仍不处理 `status === "aborted"`。这是刻意的：半截 assistant 消息已经承担了锚点与展示，给 aborted 再加一种气泡会给 40 条历史会话新增此前不显示的卡片。
- 工具执行中的取消仍受 150ms 宽限期约束；宽限期到点走 `forceAbortInvocation` 释放 admission，残留 runLoop 不污染会话（写入门禁 `write-plan.ts` 会 throw、事件 fence 会丢弃），但会继续消耗额度直到工具自己结束。

## TODO / Follow-ups

- [ ] 浏览器验收（用户执行或授权）。
- [ ] faux provider 的 abort 语义与真实 SDK 不一致（faux 保留 partial 且不抛，真实 SDK 抛异常）。这是本轮 bug 能长期存活的直接原因，值得让测试替身贴近真实行为，属测试基建独立任务。
