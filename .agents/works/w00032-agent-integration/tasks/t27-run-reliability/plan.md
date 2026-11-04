# t27 实施计划：运行可靠性

第一稿（2026-11-04），开发者已确认，待设计审查。

## Context

要解决的问题：Agent 不能长时间无人值守。服务商一次瞬时故障就让运行失败；重复调用同一个工具没有人拦；花多少钱没有告警和上限。来源是开发者对照 omp 设置项后决定开（[t12 决定 30](../t12-builtin-tools/README.md)）。

依据：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（输出 8、9、12、13、20、36、50）、[`harness/models.md`](../../../../../docs/specs/harness/models.md)（输出 1、2、10）、[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md)（输出 5、13、15、18）、[`models/service.md`](../../../../../docs/specs/models/service.md)。

开发者 2026-11-04 已确认（[Task README](README.md) 决定 1–9）：重试放内核；卡死超时只加设置；循环检测、费用上限做成默认装上的扩展；最多重试 10 次，退避 0.5 到 8 秒，服务商要求的等待最长 5 分钟；回复流到一半断了也重试；费用默认不设上限、按会话累计；第一版不做换模型回退和“说了要继续却停了”的检测；不让请求全文留在 `~/.omp`；内层重试能关的关、其余接受叠加；循环检测提醒后再犯就停止运行；请求全文写完立刻删。

工作方式：分支 `feat/w00032-t27-run-reliability`，worktree `.worktree/w00032-t27-run-reliability`。Spec 与 Task 记录在 master 上写。内核改动不影响不接重试的宿主（nb-story）。

### 写计划时实测的事实

用本机假服务端直接调 `pi-ai` 18.14.0，只测 503，非真实服务商。上一次讨论说“关掉内层重试”，实测只有一种接口关得掉：

| 接口 | 缺省 HTTP 请求数 | 耗时 | `maxHttpAttempts: 1` 之后 |
|---|---|---|---|
| `openai-completions` | 12 | 31.5 秒 | 1 次 |
| `openai-responses` | 6 | 15.5 秒 | 不变，没有选项能关 |
| `anthropic-messages` | 45 秒内 10 次，被测试中止前还没停（代码写死最多重试 10 次，即 11 次，按实测间隔推算约 1 分钟） | 约 1 分钟 | 不变，没有选项能关 |
| `google-generative-ai` | 1 | 6 毫秒 | 1 次 |

关不掉的原因是 `pi-ai` 没有统一的“关重试”选项，各接口各写一套：

- `openai-completions`：HTTP 层缺省 6 次，外面再包一层重发 1 次，所以是 12 次。调用处传了 `maxAttempts: options?.maxHttpAttempts`，给了这个选项外层也关，所以能关。
- `openai-responses`：用同一个 HTTP 层（`utils/openai-http.ts`），但调用处没传 `maxAttempts`，永远是缺省的 6 次。
- `anthropic-messages`：自己的循环，上限是写死的常量 `PROVIDER_MAX_RETRIES = 10`，不看任何选项。
- `providerRetryWait` 钩子帮不上：`streamSimple` 转选项时没带它（实测从未被调用），而且 `openai-responses` 的 HTTP 层不用它。

其它事实：

- 卡住时适配器已归 `network`，流到一半卡住时半截内容保留。
- 请求全文的落盘（`~/.omp/logs/http-400-requests/`）没有开关，对 400、413 无条件写，只在 `bun test` 里跳过。`setAgentDir` 改不了这个目录；`PI_CONFIG_DIR` 只在进程启动前设才生效，且只收相对家目录的路径。
- `pi-ai` 流层的思考循环检测（omp 的 `model.loopGuard`）缺省开着：适配器没传 `loopGuard`，只有 `enabled: false` 才关。不用再做。

## 技术选型

- 重试、退避：手写。重试要写日志事件、走注入的时钟、响应中止，通用库都不合适，循环本身十几行。否决 `p-retry`：不能接注入的时钟和写日志的时序。
- `Retry-After` 解析：用 `pi-ai` 的 `extractProviderRetryHint`，不自己解析错误文字。
- 去掉错误文字里的落盘路径：用 `pi-ai` 的 `stripRawHttpRequestDiagnostics`。
- 请求参数的规范化比较（循环检测）：手写键排序（约 10 行，同 omp 的 `canonicalizeToolCallValue`）。否决直接用 omp 的 `ToolCallLoopGuard`：它按 `pi-ai` 的消息形状工作，且状态在对象里，我们要放进可重放的片。

## 关键设计

### `packages/nb-harness/src/kernel/run/`：重试

新增 `run/retry.ts`：

```ts
export interface RetryPolicy {
    /** 同一次请求最多再发几次；0 表示不重试。 */
    readonly maxRetries: number;
}
export const RETRY_BASE_MS = 500;
export const RETRY_BACKOFF_CAP_MS = 8_000;
export const RETRY_AFTER_CAP_MS = 300_000;
export const EMPTY_REPLY_RETRIES = 3;
/** 这次回复该不该重发；该就交回要等多久（毫秒），不该交回 null。 */
export function retryDelay(response: ModelResponse, purpose: RequestPurpose, attempt: {failures: number; empties: number}, policy: RetryPolicy): number | null;
```

判断规则（写进 Spec，`retryDelay` 是唯一实现）：

| 回复 | 重发 |
|---|---|
| `network`、`rate_limit` | 是 |
| `provider` 且 `status >= 500` | 是（500 现在归 `provider`，不改归类） |
| `quota` 且 `status === 429` 且服务商给了等待时间 | 是：正文没有信息的 429 会被 `pi-ai` 标成额度用尽，内层关掉后这类网关不能退步成完全不重试；真的额度用尽通常要等很久，超过 5 分钟按下一条失败 |
| 服务商要求的等待超过 5 分钟 | 否 |
| `auth`、其余 `quota`、`context_overflow`（输出 50 处理）、`local`、其余 `provider` | 否 |
| `purpose: "turn"`、`stopReason: "stop"`、没有工具调用、没有非空白文字 | 是，最多 3 次，用完按普通回复写下（行为同现在） |

等待时间取 退避 与 服务商要求 的较大值。退避从 500 毫秒翻倍，封顶 8 秒。不加随机抖动：单人本地应用，抖动防的是大量客户端同时重试。

`run/model-call.ts` 的 `callModel`：重试放在链的最里层（`terminal`）。

```text
for 每次尝试:
    写 modelStarted（新的请求序号、新的 invocation）
    调模型端口
    retryDelay 为 null → 交回回复
    写 modelFailed{request, kind, code?, status?, message?, partial?, usage, retry: {attempt, max, delayMs}}
    host.retrying({attempt, max, resumeAt})；在 core.clock 上等，signal 中止时不再发
    host.retrying(null)
```

- 放在最里层：拦截层只看到一次调用，等待不算它的时限（`chain.ts` 调 `next` 后停表），压缩与审批的请求走同一条路。
- 写法同输出 50（溢出后再发一次）：失败那次留一条 `modelFailed`，下一次是新的 `modelStarted`。`modelFailed` 是 ctrl，不进视图；半截内容不进下一次请求，所以重发没有重复内容。
- 等待时被中止：最后一条 `modelFailed` 已写，`terminal` 交回 `stopReason: "aborted"` 的回复。`loop.ts` 现有的“`signal.aborted` 且请求不在 `openRequests`”分支直接收口，不重复写。`modelCaller` 现在无条件写 `modelFailed`，要加同样的判断（`core.leafState.kernel.openRequests` 不含这次请求就不写）。
- 不变量：写日志走 `host.write`（`guardedWrite`），收口之后写入被拒，重试循环随之结束；重试次数不进状态，每次 `callModel` 从 0 算；崩溃恢复不变（等待中崩溃，重开后运行 `interrupted`）。

`api/events.ts`：`modelFailed` 加可选的 `retry?: {attempt: number; max: number; delayMs: number}`，有它表示这次运行还要接着发（界面据此丢掉这次的半截文字）。

`api/model.ts`：`ModelResponse.error` 加可选的 `retryAfterMs?: number`。

`api/host.ts`：

- `RunStatus` 的 `running` 加可选的 `retry?: {attempt: number; max: number; resumeAt: number}`；不加新阶段，压缩中的重试 `phase` 仍是 `compacting`。`run/control.ts` 给 `RunHost` 加 `retrying(info | null)`，只在 `state === "running"` 时合并进当前状态并推 `status` 帧。
- `SessionEnv` 加可选的 `retry?: () => RetryPolicy`，每次失败时读，设置改了立刻生效。不给就不重试，所以 nb-story 与现有测试的行为不变。`createAgentHost` 把它传给会话，`Complete` 的 `env` 也接上。

`session/complete.ts`：现在直接调 `resolution.call`，不写日志。内层关掉后 `complete()` 就完全不重试了，所以用同一个 `retryDelay` 包一层循环，不写事件。

### `packages/nb-harness/src/kernel/model/omp.ts`、`src/models/target.ts`：适配器

```ts
export interface OmpTransport {
    readonly firstEventTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    /** 只有 `openai-completions` 认：见“写计划时实测的事实”。 */
    readonly maxHttpAttempts?: number;
}
// OmpTarget 加 transport?: OmpTransport；buildResolution 加可选的第四个参数 transport: () => OmpTransport。
```

- `ompCall` 把这三项放进 `SimpleStreamOptions`，不给就不传，nb-story 不变。
- 失败时用 `extractProviderRetryHint(model.provider, errorMessage)` 取 `retryAfterMs`。
- 落盘的处理（`model/request-dump.ts`，约 15 行）：错误文字末尾有 `raw-http-request=<路径>` 行时，只在路径落在 `http-400-requests` 目录下时删这个文件；文字用 `stripRawHttpRequestDiagnostics` 去掉这一行。删除失败时在错误文字末尾写明没删掉及原因，不吞错。放在 `sanitizeProviderText` 之前。这样 nb-story 也受益，且不用改进程环境。改 `PI_CONFIG_DIR` 否决：要在进程启动前设，只收相对路径，跨盘不可用，还会影响 `pi-ai` 其它读这个目录的地方。

### `packages/neuro-book/src/plugins/models/`：卡死超时

`shared/settings.ts` 加两项，`layers: ["user"]`，缺省 300，0 表示不设：`streamFirstEventTimeoutSeconds`、`streamIdleTimeoutSeconds`，范围 0–3600（放不进上限的本地大模型设 0）。不留 omp 的 `-1`（按服务商缺省）：`pi-ai` 的说明写 100、120 秒，代码常量是 300 秒，明确给值才确定。

`backend/core.ts`：`buildResolution` 传 `transport`，每次请求读设置，`maxHttpAttempts` 固定为 1。`检测` 用的 `probe` 同样传。

已有的 `nbook.models` 设置都有自己的页；这两项要确认在哪里出现，没有分区的通用项按设置窗口的现有规则显示，实施时截图核对（只加 schema 与文字，不写组件）。

### `packages/neuro-book/src/plugins/agent/backend/guards/`：默认装上的两个扩展

新目录，`nbook.agent` 自己贡献给 `agent.extensions`（同 t12 的工具：`contributions` 里声明，`activate` 返回实现）。两个扩展的工厂都收一个读设置的函数，不用扩展的 `settings` 字段：`harness/extensions.md` 输出 25 说的“全局缺省”内核还没实现，而这两项本来就是用户级的全局设置。

`shared/settings.ts` 的 `nbook.agent` 加四项，都是 `layers: ["user"]`：`modelRetries`（缺省 10，0 关）、`warnCost`、`maxCost`（缺省 0，美元，0 表示不设）、`toolLoopThreshold`（缺省 5，0 关）。`backend/agent.ts` 把 `retry: () => ({maxRetries: settings.get(modelRetries)})` 传给 `createAgentHost`。

新增这两个扩展会改变 Profile 哈希：旧会话打开时写一条 `profileChanged{plugin-added}`，只影响记录，请求不变。

**`cost-guard.ts`（`nbook.agent.cost-guard`）**

- 事件：`costRecorded`（session、ext，`{cost: number | null}`）、`costWarned`（session、ext，`{spent, limit}`）、`costCapped`（session、ext，`{spent, limit}`）。
- 片（session）：`spent`、`unpriced`（单价未知的请求数）、`warned`。归约只看自己的事件。
- `on`：`assistant`、`modelEnded`、`modelFailed` 有 `usage` 时 `emit("costRecorded", {cost})`。用 path 片不行：回退之后花掉的钱会被算回去（`extensions.md` 输出 5、10）；用 `set` 不行：同一批多条事件读到同一份状态，会丢数（输出 12）。每条发一个事件、由归约累加就没有这个问题。
- 第一次到 `warnCost` 时 `emit("costWarned")`（条件读 `ctx.state`，有幂等键 `warned`）。
- `intercept.model`：`ctx.phase === "preview"` 时一律 `next`；`maxCost > 0` 且 `spent >= maxCost` 时不调 `next`，交回 `{stopReason: "error", error: {kind: "local", code: "cost-limit", message}}`，运行以这个码收口。用户调高或关掉上限后 `start` 接着跑。
- 这是软上限：只在发请求前判断，最后一次可能超出；用户中止时反应的输出被丢弃（输出 18），那次的用量不计入。单价未知的请求不计入，设置说明与 `costWarned` 都写明。fork 出的新会话从 0 算。子代理（t14）合入时再并入，记进 t14。

**`loop-guard.ts`（`nbook.agent.loop-guard`）**

- 片（path，回退跟着走）：`hash`、`count`、`redirected`、`stopped`。
- 归约 `assistant`：有工具调用时按“每个调用 `[工具 id, 键排序后的参数]`、再排序”算哈希，相同加一、不同重置；没有工具调用时重置。归约 `turnStarted`：全部重置（用户说了新的话，`stopped` 解除）。
- `on.assistant`：`toolLoopThreshold > 0` 且 `count` 到了：
  - 第一次：写 conv 事件 `redirected{tool, count, args}`（参数摘要截到 400 字），`render` 成提醒，它进“这一步之后”（`profile.md` 输出 6），排在工具结果后面。`count` 清零、`redirected` 置真。
  - 第二次（提醒之后又连续重复到阈值）：写 ext 事件 `stopped`，下一次模型请求被拦下。
- `intercept.model`：`preview` 时一律 `next`；`stopped` 时交回 `{kind: "local", code: "tool-call-loop"}`。这一步的工具照常跑完，运行在下一个边界以这个码收口。
- 豁免工具：omp 豁免 `wait`。我们现在没有这个工具；代码里留一个空的常量列表，t14 加 `wait` 时加入，记进 t14。

和 omp 的差别：omp 主会话只提醒、不停，它只在顾问会话里提醒后再犯就停。t27 的目标是无人值守，只提醒的话模型不听就一直烧钱，所以这里两次到阈值就停（连续 10 次相同调用）。开发者已确认（决定 8）。

## Spec 与文档改动

- `harness/runtime.md`：删“不承诺”里的自动重试。输出 8 改为“重试用完之后才收口”。追加 planned 条目 62 起：何时重发（上面那张表）、等待与退避、失败那次的事件与 `retry` 字段、`RunStatus.retry`、等待时中止、拦截层只看到一次调用、`complete()` 同样重试但不写事件、不给 `retry` 时不重试。
- `harness/models.md`：输出 1 加 `retryAfterMs`；输出 2 不变，补一句“正文没有信息的 429 归 `quota`”；追加 planned：`transport` 三项；请求全文不留在磁盘、错误文字不带路径；已知限制写入内层重试的实测（只有 `openai-completions` 能关）。
- `models/service.md`：两个超时设置。
- `agent/run-guards.md`（新建，`status: planned`，`capability: agent.run-guards`）：两个扩展的设置、事件、片、失败码 `cost-limit`、`tool-call-loop`、软上限的边界。`docs/specs/README.md` 注册表加一行。
- `agent/contributions.md`：写明内置扩展见 `agent/run-guards.md`。
- [t17](../t17-conversation-ui/README.md) 记录：界面要显示“第几次重试、还要等多久”，收到带 `retry` 的 `modelFailed` 时丢掉那次的半截文字，显示费用告警、`cost-limit`、`tool-call-loop`。新内核的对话界面还没做，t27 不改 `nb-agent-ui`。
- [t14](../t14-multi-agent/README.md) 记录：子代理费用并入、循环检测豁免 `wait`。

## 切片

每片单独提交，自跑对应包的测试与类型检查。

| 片 | 内容 | 验证 |
|---|---|---|
| 0 | Spec（在 master 上）：runtime、models、service、run-guards、contributions、注册表 | `docs:check` |
| 1 | 适配器：`OmpTransport`、`retryAfterMs`、落盘处理 | `model/omp.test.ts`；真实子进程测落盘（`bun test` 里不落盘，用临时 `HOME` 起 `bun` 脚本） |
| 2 | 内核重试：`run/retry.ts`、`callModel`、`modelCaller`、`complete`、`RunStatus.retry`、`SessionEnv.retry` | `run/` 新测试；nb-harness 全量；nb-story 验收门 |
| 3 | 应用接线：两组设置、`buildResolution` 传 `transport`、`createAgentHost` 传 `retry` | `plugins/models`、`plugins/agent` 测试；设置窗口截图 |
| 4 | `cost-guard` | 真实内核上的扩展测试 |
| 5 | `loop-guard` | 同上 |
| 6 | 收口：真实模型 smoke、变异检查、实现审查 | 见“验证” |

## 验收映射

新 Spec 条目的编号写 Spec 时定，这里按判据列。

| 判据 | 测试 |
|---|---|
| 503 一次后成功：两条 `modelStarted`、一条带 `retry` 的 `modelFailed`、一条回复；用量是两次之和 | `run/retry.test.ts`，`createTestModel` |
| 真实 HTTP 下 `openai-completions` 503 一次后成功：HTTP 正好 2 次 | `model/omp.test.ts` 的本机端点加 `SessionEnv` |
| 429 带 `Retry-After: 30`：在注入时钟上等够 30 秒才发；超过 5 分钟直接失败 | `run/retry.test.ts` |
| 退避序列 0.5、1、2、4、8、8…；用完 `maxRetries` 后运行 `error` | 同上 |
| 不重发：`auth`、`quota`、`local`、400、`context_overflow`（走溢出分支） | 同上 |
| 流到一半断开：`partial` 记下、下一次请求不带半截内容 | 同上，看截下的请求 |
| 空回复重发 3 次后按普通回复写下；压缩请求的空回复不重发 | 同上 |
| 等待中 `abort`：立刻 `aborted`，同一请求只有一条 `modelFailed` | 同上（对话请求、压缩请求各一） |
| 等待中 `RunStatus.retry` 有值，下一次请求开始后清掉；`waiting` 状态不被覆盖 | 同上，收 `status` 帧 |
| 重开后事件一致；等待中 `kill -9`：重开后 `interrupted` | `tests/kernel` 的子进程用例 |
| 拦截层只看到一次 `next` 结果；等待超过 30 秒不算它超时 | `run/retry.test.ts` |
| 不给 `retry`：行为同现在 | 现有测试不改 |
| `complete()` 重试且不写日志 | `session/complete` 的测试 |
| `transport` 进请求：超时设 1 秒时卡住按 `network` 失败；`maxHttpAttempts` 让 HTTP 只发一次 | `model/omp.test.ts` |
| 400 后磁盘上没有请求全文，错误文字不带路径，`modelFailed` 里也没有 | 真实子进程（临时 `HOME`） |
| 费用：累计、回退后不减、重开后还在；到告警线只告警一次；到上限下一次请求不发、码 `cost-limit`；调高后 `start` 接着跑；单价未知计入 `unpriced`；`preview` 不被拦 | `plugins/agent/guards.test.ts`，真实内核 |
| 循环：连续 5 次相同调用后请求里出现提醒，排在工具结果之后；参数键序不同算相同；再连续 5 次后码 `tool-call-loop`；用户发新话后解除；回退后计数跟着回去；阈值 0 不检测 | 同上 |
| 默认装上：新会话的快照里两个扩展都是 `active` | `builtin-tools-project.test.ts` 同类的真实项目子进程 |

## 验证

- `nb-harness`、`neuro-book` 的受影响测试与类型检查；`nb-story` 验收门；`docs:check`、`governance:check`。
- 真实模型 smoke：DeepSeek 一轮，确认 `maxHttpAttempts: 1` 与超时设置不影响正常请求（按真实模型调用的规定）。
- 重试在真实进程上跑一次：本机端点前几次回 503，经 `createAgentRuntime` 跑完一次运行，看日志与 `status` 帧。
- 变异检查：每条判据改坏实现，确认对应测试失败。

留下的未验证边界：真实服务商的 429 正文是否按代码归类；`anthropic-messages` 内层重试到底多久才停（实测 45 秒没停，收口时跑到结束，把数字写进证据）。

## 不做与风险

不做：换模型回退与等额度恢复（`retry.fallbackChains`、`waitForUsageReset`）；“说了要继续却停了”的检测；重试的随机抖动；对话界面的显示（t17）；提示词缓存与 `gc.*`（t27 之后再定）。

风险：

1. **内层重试关不干净。** `openai-responses`、`anthropic-messages` 的内层关不掉，每次外层尝试前内层先重试一轮：`openai-responses` 最坏约 11 × 6 = 66 个请求、约 4 分钟；`anthropic-messages` 最坏约 11 × 11 = 121 个请求、约 12 分钟（按实测间隔推算，收口时实测）。失败的请求不计费，代价是内层重试期间没有“重试中”的显示（内层不产生事件）和多打服务商。用户可以中止。omp 主流程同样是内外两层叠加（它只在记忆模块传 `maxHttpAttempts`）。否决两种做法：fetch 包装截断内层，要在外面重做一遍错误归类；`bun patch` 改 `pi-ai`（仓库有先例，只改两处），但这个依赖升级频繁，每次要重做补丁，而叠加不影响无人值守的目标。
2. **删除落盘文件靠一行约定的文字。** `pi-ai` 改了这行写法时文件就留下了；验收的子进程测试会在升级时失败。
3. **软上限。** 见 `cost-guard`。
