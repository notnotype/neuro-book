# t27 实施计划：运行可靠性

第二稿（2026-11-04）：第一稿经设计审查修订（[处理](evidences/design-review-disposition.md)），开发者已确认。

## Context

要解决的问题：Agent 不能长时间无人值守。服务商一次瞬时故障就让运行失败；重复调用同一个工具没有人拦；花多少钱没有告警和上限。来源是开发者对照 omp 设置项后决定开（[t12 决定 30](../t12-builtin-tools/README.md)）。

依据：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（输出 8、9、12、13、20、28、31、36、50）、[`harness/models.md`](../../../../../docs/specs/harness/models.md)（输出 1、2、10）、[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md)（输出 5、13、15）、[`models/service.md`](../../../../../docs/specs/models/service.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)。

开发者已确认的决定见 [Task README](README.md) 决定 1–16。

工作方式：分支 `feat/w00032-t27-run-reliability`，worktree `.worktree/w00032-t27-run-reliability`。Spec 与 Task 记录在 master 上写。改动只影响新内核的调用方（`neuro-book`）：nb-story 经 `createHarness` 自己调 `streamSimple`，不经过内核与适配器。

### 相对第一稿的变化

1. 重试从“模型调用最里层”挪到运行循环的边界，写法同输出 50（溢出后重发）。每次重发都重新算请求、取走插话、过拦截链，所以费用检查每次都生效，`callModel` 不用改循环。
2. 哪些错误重发，改用 `pi-ai` 的 `AIError.retriable(errorId)`，不再写判断表。
3. 费用累计放进内核（`SessionCore` 上按全部事件累加，同 `requestCounter`），扩展只负责告警与拦截。旧会话的费用自动算对，也不怕反应被丢。
4. `ompCall` 自己做第一事件计时：`anthropic-messages` 的第一事件超时会被内层再重试 10 次，缺省设置下卡死要约 10 小时才收口。
5. 空回复：关掉内层（`acceptEmptyResponse: true`），重发时带一句提醒；用完算失败（码 `empty-reply`），不再当正常结束。
6. 循环检测：停止多一个条件，这段重复里工具结果也都相同。结果在变时只提醒不停。
7. 请求全文落盘：删除只能覆盖“错误文字里带路径”的情况，`anthropic-messages` 内部 400 恢复成功时会留下文件。接受这个残留。
8. 模型重复循环（`ThinkingLoop`）不重发，以码 `thinking-loop` 失败。

### 写计划时实测的事实

用本机假服务端直接调 `pi-ai` 18.14.0，非真实服务商；接手的审查者（Opus）复测过这几组数字。

HTTP 层的重试（503）：

| 接口 | 缺省 HTTP 请求数 | 耗时 | `maxHttpAttempts: 1` 之后 |
|---|---|---|---|
| `openai-completions` | 12 | 31.5 秒 | 1 次 |
| `openai-responses` | 6 | 15.5 秒 | 不变，调用处没传这个参数 |
| `anthropic-messages` | 11 | 46.4 秒 | 不变，上限是写死的常量 |
| `google-generative-ai` | 1 | 6 毫秒 | 1 次 |

其它内层行为：

- 空回复：`pi-ai` 在 `openai-completions`、`openai-responses`、`anthropic-messages` 上自己重发 2 次，`acceptEmptyResponse: true` 后只发 1 次，这条选项经 `streamSimple` 能传下去。`maxHttpAttempts` 关不掉它。
- 第一事件超时：`anthropic-messages` 内层再重试 10 次（超时设 200 毫秒时 11 次、50.6 秒）；两种 OpenAI 接口直接交回。流中途的空闲超时都不被内层重试。
- 超时传 0 表示关闭，三种接口都成立，650 秒内不被任何一层截断。
- `providerRetryWait` 不能用来拦重试：`streamSimple` 没转这个选项。

`AIError.retriable(errorId)` 的实测结论（`openai-completions`，`maxHttpAttempts: 1`）：

| 重发 | 不重发 |
|---|---|
| 408、429（含空正文与额度文字）、500、503、529、HTTP 200 但 `finish_reason: "error"`、流中断、`repetition_detected`（本计划改为不重发） | 400、401、402、403、404、413、上下文溢出、`content_filter` |

落盘：`pi-ai` 对 400、413 无条件把请求全文写到 `~/.omp/logs/http-400-requests/`，只在 `bun test` 里跳过，没有开关。`setAgentDir` 改不了这个目录，`PI_CONFIG_DIR` 只在进程启动前设才生效。路径行不一定在错误文字末尾（OpenRouter 的 `metadata.raw` 排在它后面）。`anthropic-messages` 的 strict 工具 400 恢复成功后，文件留下，对外没有任何路径。

`pi-ai` 流层的思考循环检测缺省开着（适配器没传 `loopGuard`）。

## 技术选型

- 重试循环与退避：手写，十几行。要写日志事件、走注入的时钟、响应中止，否决 `p-retry`：接不上这些时序。
- 可重发判断：用 `pi-ai` 的 `AIError.retriable`。它和服务商错误的归类同一处维护；否决第一稿自己写的判断表：实测漏了 HTTP 200 的流内错误。
- `Retry-After`：用 `pi-ai` 的 `extractProviderRetryHint`，不自己解析错误文字。
- 错误文字里的落盘路径：按完整行识别并去掉，手写。`stripRawHttpRequestDiagnostics` 只去掉末尾的行，实测不够。
- 请求参数的规范化比较（循环检测）：手写键排序（约 10 行）。否决直接用 omp 的 `ToolCallLoopGuard`：它按 `pi-ai` 的消息形状工作，状态在对象里，我们要放进可重放的片。

## 关键设计

### `packages/nb-harness/src/kernel/run/`：重试

新增 `run/retry.ts`：

```ts
export interface RetryPolicy {
    /** 一次请求最多再发几次；0 表示不重试。 */
    readonly maxRetries: number;
}
export const RETRY_BASE_MS = 500;
export const RETRY_BACKOFF_CAP_MS = 8_000;
export const RETRY_AFTER_CAP_MS = 300_000;
export const EMPTY_REPLY_RETRIES = 3;
/** 这次失败要不要重发；要就交回等多久（毫秒）。只看 `error.retryable`、`error.retryAfterMs`，不看类别。 */
export function retryDelay(response: ModelResponse, retries: number, policy: RetryPolicy): number | null;
/** 对话回复算不算空：没有工具调用、没有非空白文字，且 `stopReason` 是 `stop`、`tool`，或是 `length` 但内容完全为空。 */
export function isEmptyReply(response: ModelResponse): boolean;
```

等待时间取退避与服务商要求的较大值；退避从 500 毫秒翻倍，封顶 8 秒；服务商要求超过 5 分钟时不重发。不加随机抖动：单人本地应用，抖动防的是大量客户端同时重试。

`run/loop.ts`，对话请求：在现有的失败分支里、`context_overflow` 判断之后加重发，和溢出重发同样的写法：

```text
delay = retryDelay(response, retries, policy)
delay 不为 null：
    写 modelFailed{...现有字段, retry: {attempt, max, delayMs}}（连同 modelFailures）
    host.retrying({attempt, max, resumeAt})
    在 core.clock 上等，signal 中止就不再等
    retries += 1；continue（回到循环顶部：中止检查、外部事实、工具集、steer、压缩、重新解析模型、重新算请求）
```

- 这样退避期间到达的 steer、`compact`、改设置都在下一次请求生效，拦截链也每次都跑。等待期间不提前醒，steer 要等到这次等待结束。
- 半截内容只在 `modelFailed.partial` 里，不进视图，所以下一次请求没有重复内容。工具只在回复完整后才跑，重发没有副作用。
- `retries` 与 `overflowRetried` 一样是 `runLoop` 的局部变量，有一条回复写下后清零；重开不继承。等待中崩溃：重开后运行 `interrupted`，同现有恢复。
- 空回复：`purpose` 是 `turn` 且 `isEmptyReply` 时不写 `assistant`。还有次数就写 `modelFailed{kind: "provider", code: "empty-reply", usage, partial, retry}` 与 `continued{by: "core", text}`（一句提醒，写法同 `RESULT_NUDGE`），隔一次退避再发；3 次用完以 `error`、码 `empty-reply` 收口。

`run/model-call.ts` 的 `modelCaller`（压缩、审批）：在 `callModel` 外包同样的循环，每次重新进链。失败写 `modelFailed{retry}`，等完再来；等待时中止就交回这次的失败回复，不再写第二条。

`Complete`（`session/complete.ts`）：现在直接调 `resolution.call`、不写日志。`env` 加可选的 `retry`，用同一个 `retryDelay` 包循环，不写事件。

`run/model-call.ts` 的两处修正（都是已有问题，费用累计依赖它们）：

- 请求序号：`core.requestCounter + 1` 在写入前读，并发的审批请求实测拿到同一个序号。`SessionCore` 加同步的 `reserveRequest()`（`requestCounter += 1; return`），`terminal` 与被拦下的回复都用它；`apply` 里的 `Math.max` 不变。序号允许有空洞，只要求单调。
- 一层调两次 `next`：第一次的成功用量现在不写任何事件。`terminal` 记下上一次的回复，再次进来时先写一条 `modelEnded` 结算上一次。

`api/events.ts`：`modelFailed` 加可选的 `retry?: {attempt: number; max: number; delayMs: number}`，有它表示这次运行还要接着发（界面据此丢掉这次的半截文字）。

`run/results.ts`：带 `retry` 的 `modelFailed` 只累加用量，不进 `lastFailure`。否则重试成功之后因别的原因收口时，错误文字是已恢复的那条 503。

`api/model.ts`：`ModelResponse.error` 加可选的 `retryable?: boolean`、`retryAfterMs?: number`。

`api/host.ts`：

- `RunStatus` 的 `running` 加可选的 `retry?: {attempt: number; max: number; resumeAt: number}`；不加新阶段，压缩中的重试 `phase` 仍是 `compacting`。`run/control.ts` 给 `RunHost` 加 `retrying(info | null)`，只在 `state === "running"` 时合并进当前状态并推 `status` 帧；下一次 `host.phase` 自然清掉。
- `SessionEnv` 加可选的 `retry?: () => RetryPolicy`，每次失败时读。不给就不重试，现有测试的行为不变。
- `SessionSnapshot` 加 `usage: {cost: number; unpriced: number}`。

### `kernel/dispatch/core.ts`、`kernel/extension/ctx.ts`：会话累计费用

`SessionCore` 加 `spend: {cost: number; unpriced: number}`，在 `apply` 里维护，位置同 `requestCounter`（打开会话时也走这里，不分分支）：`assistant`、`modelEnded`、`modelFailed` 有 `usage` 时，`cost` 是数字就累加，是 null 就 `unpriced` 加一。回退不减；重开后还在；旧会话打开就算对；fork 复制的路径上的用量一起算。

`ReactCtx`、`InterceptCtx` 加只读的 `spend`。这是决定 1 的细化：费用上限仍是扩展，内核只提供累计这个事实，界面以后也要读它。

### `kernel/model/omp.ts`、`src/models/target.ts`：适配器

```ts
export interface OmpTransport {
    /** 0 表示不设。给了就由 ompCall 自己计时，并给 pi-ai 传 0。 */
    readonly firstEventTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    /** 只有 openai-completions 认。 */
    readonly maxHttpAttempts?: number;
}
// OmpTarget 加 transport?: OmpTransport、onRequestDump?: (path: string) => Promise<void>；
// buildResolution 加可选的第四个参数 transport: () => OmpTransport。
```

- 有 `transport` 时给 `pi-ai` 传 `acceptEmptyResponse: true`（外层是唯一一层空回复重试）。
- 第一事件计时：子 `AbortController` 跟随 `signal`；收到第一个非 `start` 事件前到时就中止它，并交回 `failed("network", ..., {code: "first-event-timeout", retryable: true})`。`anthropic-messages` 内层因此只卡一次。
- 失败时：`retryable = AIError.retriable(errorId) && !is(errorId, Flag.ThinkingLoop)`；`ThinkingLoop` 带码 `thinking-loop`。`retryAfterMs` 来自 `extractProviderRetryHint`。
- 建流时抛错的那条路径（`catch`）没有结构化信息，不给 `retryable`，不重发，同现在。
- 落盘：`model/request-dump.ts` 是纯字符串函数，从未截断的错误原文里按完整行取出所有 `raw-http-request=` 路径并去掉这些行，也去掉 `raw-http-request-save-failed=`，其余行保留。放在 `sanitizeProviderText` 之前，`ompCall` 的失败出口都走它。路径交给 `target.onRequestDump`。
- 实际删除在 `src/models/target.ts`（内核的 `model/` 不许用 `node:fs`，`architecture.test.ts` 的规则）：只删路径落在 `http-400-requests` 目录下的文件；`ENOENT` 算达成（`pi-ai` 后台清理也会删）；其它错误追加到错误文字末尾，不吞。

### `packages/neuro-book/src/plugins/models/`、`plugins/agent/shared/settings.ts`：设置

全部 `layers: ["user"]`，0 表示关闭或不设。没有 `section` 的设置会落进“插件设置”、小组标题是插件 id，所以 `nbook.agent` 贡献一个 list 分区“运行可靠性”（`category: "ai"`），六项都指向它（只加声明与文字，不写组件；配置项按 id 引用别的插件的分区 Spec 允许）。

| 设置 | 缺省 | 范围 |
|---|---|---|
| `nbook.agent/modelRetries` | 10 | 整数 0–20 |
| `nbook.agent/toolLoopThreshold` | 5 | 整数 0–100 |
| `nbook.agent/warnCost`、`maxCost` | 0（美元） | `minimum: 0` |
| `nbook.models/streamFirstEventTimeoutSeconds`、`streamIdleTimeoutSeconds` | 300 | 整数 0–3600 |

超时明确给值，不留 omp 的 `-1`（按服务商缺省）：`pi-ai` 的说明写 100、120 秒，代码常量是 300 秒，给值才确定。

`plugins/models/backend/core.ts`：`buildResolution` 传 `transport`，每次请求读设置，`maxHttpAttempts` 固定为 1；检测用的 `probe` 同样传，失败更快。`plugins/agent/backend/agent.ts` 把 `retry: () => ({maxRetries: settings.get(modelRetries)})` 传给 `createAgentHost`，并接上 `Complete`。`agent/shared/settings.ts` 文件头与 `contributions.md` 不承诺里“没有界面”的说法跟着改。

### `packages/neuro-book/src/plugins/agent/backend/guards/`：默认装上的两个扩展

`nbook.agent` 自己贡献给 `agent.extensions`（同 t12 的工具；审查者实测两个扩展都能到 `active`）。工厂收一个读设置的函数，不用扩展的 `settings` 字段：`harness/extensions.md` 输出 25 的“全局缺省”内核还没实现，这几项本来就是用户级的全局设置。闭包读设置不进 Profile 哈希，也不影响重放（归约不读设置）。

新增扩展会改变 Profile 哈希：旧会话打开时写一条 `profileChanged{code-updated}`，已提交的轮逐块一致，请求不变。

拦下的回复写完整：`{content: [], toolCalls: [], stopReason: "error", usage: 全 0 且 cost: 0, model: request.model, error: {kind: "local", code, message}}`。缺字段时 `isResponse` 判不合格，这一层被跳过，请求照发，保护就静默失效了。

**`cost-guard.ts`（`nbook.agent.cost-guard`）**

- 事件：`costWarned`（session、ext，`{spent, limit}`）、`costUnpriced`（session、ext，无数据）。
- 片（session）：`warnedAt`（已告警到的线，调高告警线后能再告警）、`unpricedWarned`。
- `on`：`assistant`、`modelEnded`、`modelFailed` 上读 `ctx.spend`。`warnCost > 0`、`spend.cost >= warnCost`、`warnCost > warnedAt` 时 `emit("costWarned")`。`warnCost` 或 `maxCost` 大于 0，且第一次有 `spend.unpriced > 0` 时 `emit("costUnpriced")`，界面据此说明“这个模型没有单价，费用上限对它不起作用”。
- `intercept.model`：`preview` 时一律 `next`；`maxCost > 0` 且 `spend.cost >= maxCost` 时交回 `cost-limit`。对话请求以这个码收口，用户调高或关掉上限后 `start` 接着跑。
- 压缩与审批的请求被拦下时，按它们自己的失败处理：压缩换方法或失败，审批走现有退路；下一个对话请求再以 `cost-limit` 收口。只压缩的运行结果是 `compaction-failed`，日志里 `modelFailed.code` 是 `cost-limit`。接受这个取舍，不为它新开运行级通道。
- 软上限：只在发请求前判断，最后一次可能超出。单价未知的请求不计入（决定 4）。子代理（t14）合入时再并入，记进 t14。

**`loop-guard.ts`（`nbook.agent.loop-guard`）**

- 片（path，回退跟着走）：`hash`、`count`、`sameResults`、`results`（上一步结果的哈希）、`redirectedHash`、`stopped`。
- 归约 `assistant`：有工具调用时按“每个调用 `[工具 id, 键排序后的参数]`、再排序”算哈希，相同加一，不同则全部清零、从 1 算；没有工具调用时清零。
- 归约 `toolResult`：累加这一步结果（`status`、`text`）的哈希；下一条 `assistant` 哈希相同时比较，不同则 `sameResults` 置假。
- 归约解除 `stopped`：`turnStarted` 且 `inputId !== null`，或 `steer`。`start`（`inputId` 为 null）不解除：它没有带来新话。
- `on.assistant`：`toolLoopThreshold > 0` 且 `count` 到了：
  - `redirectedHash === hash` 且 `sameResults`：写 ext 事件 `stopped`，下一次模型请求被拦下。
  - 否则写 conv 事件 `redirected{tool, count, args}`（参数摘要截到 400 字），`render` 成提醒，排在这一步的工具结果后面（`profile.md` 输出 6，审查者实测，重开后逐块一致）。同时 `redirectedHash = hash`、`count = 0`、`sameResults = true`。
- `intercept.model`：`preview` 时一律 `next`；`stopped` 时交回 `tool-call-loop`。这一步的工具照常跑完，运行在下一个边界收口。
- 豁免工具：omp 豁免 `wait`。我们现在没有这个工具；代码里留一个空的常量列表，t14 加 `wait` 时加入，记进 t14。

## Spec 与文档改动

- `harness/runtime.md`：删“不承诺”里的自动重试。输出 8 改为“重试用完之后才收口”。追加 planned 条目 62 起：何时重发（`error.retryable`）、等待与退避、失败那次的事件与 `retry`、`RunStatus.retry`、重发回到边界（steer、设置生效）、等待时中止、空回复（提醒、用完以 `empty-reply` 收口）、`complete()` 同样重试但不写事件、不给 `retry` 时不重试、`SessionSnapshot.usage`。输出 6 补“序号有空洞”。
- `harness/extensions.md`：`ReactCtx`、`InterceptCtx` 的 `spend`。
- `harness/models.md`：输出 1 加 `retryable`、`retryAfterMs`；输出 2 补一句“正文没有信息的 429 归 `quota`”；追加 planned：`transport` 三项、第一事件计时、`acceptEmptyResponse`、`thinking-loop`、请求全文的处理与已知残留；已知限制写入内层重试的实测。
- `models/service.md`：两个超时设置。
- `agent/run-guards.md`（新建，`status: planned`，`capability: agent.run-guards`）：两个扩展的设置、事件、片、失败码 `cost-limit`、`tool-call-loop`、软上限与压缩时的边界。`docs/specs/README.md` 注册表加一行。
- `agent/contributions.md`：内置扩展见 `agent/run-guards.md`；设置有界面了。
- [t17](../t17-conversation-ui/README.md) 记录：显示“第几次重试、还要等多久”；收到带 `retry` 的 `modelFailed` 时丢掉那次的半截文字；显示费用告警、无单价提示、`cost-limit`、`tool-call-loop`、`empty-reply`、`thinking-loop`；显示会话累计费用。新内核的对话界面还没做，t27 不改 `nb-agent-ui`。
- [t14](../t14-multi-agent/README.md) 记录：子代理费用并入、循环检测豁免 `wait`。
- Work README 的后续：nb-story 自己的 400 落盘（它不经过适配器，决定 6 只说 NeuroBook）。

## 切片

每片单独提交，自跑对应包的测试与类型检查。

| 片 | 内容 | 验证 |
|---|---|---|
| 0 | Spec（在 master 上） | `docs:check` |
| 1 | 适配器：`OmpTransport`、第一事件计时、`retryable`、`retryAfterMs`、落盘 | `model/omp.test.ts`；真实子进程测落盘 |
| 2 | 内核修正：`reserveRequest`、两次 `next` 的结算、会话累计费用与 `spend` | `run/`、`dispatch/` 测试 |
| 3 | 内核重试：`run/retry.ts`、`loop.ts`、`modelCaller`、`complete`、`RunStatus.retry`、`results.ts` | `run/` 新测试；nb-harness 全量 |
| 4 | 应用接线：设置与分区、`transport`、`retry` | `plugins/models`、`plugins/agent` 测试；设置窗口截图 |
| 5 | `cost-guard` | 真实内核上的扩展测试 |
| 6 | `loop-guard` | 同上 |
| 7 | 收口：真实模型 smoke、变异检查、实现审查 | 见“验证” |

## 验收映射

新 Spec 条目的编号写 Spec 时定，这里按判据列。

| 判据 | 测试 |
|---|---|
| 真实端点的归类表：状态码或 SSE 形状 → `retryable`、`retryAfterMs`、`kind`（上面那张实测表，含 `retry-after`、空正文 429、`finish_reason: "error"`、`content_filter`、`length`、`repetition_detected`） | `model/omp.test.ts` |
| 真实 HTTP 下 `openai-completions` 503 一次后成功：HTTP 正好 2 次，日志两条 `modelStarted`、一条带 `retry` 的 `modelFailed`、一条回复，用量是两次之和 | `run/retry.test.ts` 接本机端点 |
| `Retry-After: 30`：在注入时钟上等够 30 秒才发；超过 5 分钟直接失败 | `run/retry.test.ts` |
| 退避序列 0.5、1、2、4、8、8…；用完后运行 `error`；`maxRetries: 0` 不重发；设置改了下一次失败就生效 | 同上 |
| 流到一半断开：`partial` 记下，下一次请求不带半截内容 | 同上，看截下的请求 |
| 退避中 `enqueue` 一条 steer、改推理档、要求 `compact`：下一次请求都生效 | 同上 |
| 费用检查每次都跑：第一次失败已达上限，不发第二次 | 同上 |
| 空回复（`stop`、`tool` 无调用、`length` 无内容）：带提醒重发，3 次后码 `empty-reply`；真实端点上 HTTP 总次数 4；`length` 有内容不重发 | 同上加 `model/omp.test.ts` |
| 压缩与审批的请求同样重发；压缩请求的空回复不算空回复 | 同上 |
| 等待中 `abort`：立刻 `aborted`，同一请求只有一条 `modelFailed`（对话、压缩各一） | 同上 |
| 等待中 `RunStatus.retry` 有值，下一次请求开始后清掉；`waiting` 不被覆盖 | 同上，收 `status` 帧 |
| 重试成功后因别的原因收口：错误文字不是已恢复的那条 | `run/retry.test.ts` |
| 等待中 `kill -9`：重开后 `interrupted`，事件一致 | `tests/kernel` 的 `crash-session` 加一个模式 |
| 并发审批的请求序号不同，一个结束一个中止，各收口一次 | `run/tools.test.ts` |
| 一层两次 `next`：实际发的每次都有结算，用量等于总和，`openRequests` 清空 | `run/control.test.ts` |
| 不给 `retry`：行为同现在 | 现有测试不改 |
| `complete()` 重试且不写日志 | `session/complete` 的测试 |
| 第一事件超时：三种接口都只发 1 次、按 `network` 失败；传 0 不计时；空闲超时生效 | `model/omp.test.ts` |
| 400、413 后磁盘上没有请求全文，错误文字不带路径，路径行在中间（`metadata.raw`）时也成立，正文超过 8 KB 时也成立 | 真实子进程（临时 `HOME`，清掉 `XDG_STATE_HOME` 等变量） |
| 费用：累计、回退不减、重开后还在；旧会话超上限，第一次请求就被挡；告警线调高后能再告警；到上限码 `cost-limit`，调高后 `start` 接着跑；拦下不增加 `spend`，`RunResult.usage.cost` 不变成 null；单价未知时发 `costUnpriced`；`preview` 不被拦 | `plugins/agent/guards.test.ts`，真实内核 |
| 手动压缩到上限：`compaction-failed`，日志 `modelFailed.code` 是 `cost-limit`，没有发请求 | 同上 |
| 循环：连续 5 次相同调用后提醒，排在工具结果之后；键序不同算相同；再连续 5 次且结果相同时码 `tool-call-loop`；结果不同只提醒不停；提醒 A 之后 B 重复先提醒；`start` 仍被挡，`send`、steer 解除；回退后计数跟着回去；阈值 0 不检测 | 同上 |
| 默认装上：新会话快照里两个扩展都是 `active` | 真实项目子进程 |
| 设置窗口搜 `maxCost` 能到达可编辑的数字框；超范围被拒 | 截图加 `plugins/settings` 的现有校验 |

## 验证

- `nb-harness`、`neuro-book` 的受影响测试与类型检查；`docs:check`、`governance:check`。
- 真实模型 smoke：DeepSeek 一轮，确认 `transport` 不影响正常请求（按真实模型调用的规定）。
- 重试在真实进程上跑一次：本机端点前几次回 503，经 `createAgentRuntime` 跑完一次运行，看日志与 `status` 帧。
- 变异检查：每条判据改坏实现，确认对应测试失败。

留下的未验证边界：真实服务商的错误标记是否与本机端点一致；Windows 上的落盘路径。

## 不做与风险

不做：换模型回退与等额度恢复（`retry.fallbackChains`、`waitForUsageReset`）；“说了要继续却停了”的检测；模型重复循环的纠偏提醒（omp 有，这里直接失败）；重试的随机抖动；对话界面的显示（t17）；提示词缓存与 `gc.*`（t27 之后再定）。

风险：

1. **内层 HTTP 重试关不干净。** 外层每次尝试前，内层先重试一轮：`openai-responses` 最坏约 66 个请求、约 4 分钟；`anthropic-messages` 最坏约 121 个请求、约 10 分钟（11 × 46 秒，加外层退避）。这段时间没有“重试中”的显示，用户可以中止。第一事件计时同时兜住这一轮的总时长。omp 主流程同样是两层叠加。否决 fetch 包装（要重做错误归类）与 `bun patch`（决定 7）。
2. **卡死的总时长。** 缺省下每次卡死等 5 分钟，用完 10 次重试约 55 分钟才失败，这期间有状态帧。
3. **真的额度用完会多等约 1 分钟。** 429 的额度文字 `retriable` 也判为真，要先退避完 10 次；402 不重发。服务商给了超过 5 分钟的等待时直接失败。
4. **落盘的残留。** `anthropic-messages` 内部 400 恢复成功时文件留在 `~/.omp`，7 天后由 `pi-ai` 清理；`~/.omp/logs/http-400-requests/` 目录本身仍会建。`pi-ai` 改了诊断行写法时，子进程测试会在升级时失败。
5. **软上限。** 见 `cost-guard`。
