---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.models
owners:
  - nb-harness
---

# Harness 模型端口与 OMP 适配器

## 目标与非目标

给 harness 内核一个与服务商无关的模型接口：内核只交出 `ModelRequest`、只收回 `ModelResponse`；宿主经模型端口决定用哪个模型、凭据从哪来；本包提供一个经 OMP `streamSimple` 实现的适配器。服务商的失败不抛错，以带类别的失败回复交回；错误文字里回显的密钥在交回之前遮盖。

不承诺：

- 模型目录与凭据的管理：由宿主实现端口（Agent 插件经 `nbook.models`，nb-story 用它自己的解析）。
- 图片：只有工具消息里的图片接上了（[`harness/runtime.md`](runtime.md) 输出 58–61）；用户与助手消息里有图片时以 `unsupported-content` 失败，回复里的图片块不收。
- 服务商层看不见的重试不单独审计；用量可能漏计，以 `complete: false` 表示（输出 10）。
- 关掉服务商层的 HTTP 重试：只有 `openai-completions` 认 `maxHttpAttempts`；`openai-responses` 缺省 6 次、`anthropic-messages` 11 次，关不掉，与内核的重发（[`harness/runtime.md`](runtime.md) 输出 62）叠加。
- 请求全文完全不落盘：`anthropic-messages` 内部 400 恢复成功时，`pi-ai` 写的文件没有路径交回，留到它自己清理（7 天）；目录 `~/.omp/logs/http-400-requests/` 仍可能被建出来。
- 流式增量不给扩展、不进日志。

## 术语与参与者

- **模型端口**：宿主实现的 `ModelPort`，按核心设置与用途解析出一个可调用的模型。
- **适配器**：把 `ModelRequest` 转成某个服务商协议、把回复转回 `ModelResponse` 的实现；本包提供 OMP 适配器。
- **逻辑请求**：内核发出的一次请求；适配器内部的鉴权重试、推理循环都算在这一次里。

## 输入与前置条件

```ts
interface ModelPort {
    resolve(query: ModelQuery): ModelResolution;
}
interface ModelQuery {
    settings: CoreSettings;
    purpose: RequestPurpose;
    profile: string;   // 会话当前 Profile 的 id；complete() 是它要跑的 Profile
    role?: string;     // 调用方指名的角色（压缩方法、审批钩子经 ctx.model 给的）
}
type ModelResolution =
    | {ok: true; info: ModelInfo; call(request: ModelRequest, signal: AbortSignal, onDelta: (delta: ModelDelta) => void): Promise<ModelResponse>}
    | {ok: false; code: "no-model" | "no-credentials" | "unknown-model" | "role-unbound"; role?: string; provider?: string};
    // 失败时选中了什么：走到某个角色时带角色 id，卡在没有凭据时带服务商 id；端口不给时按没有处理。

// OMP 适配器（@notnotype/nb-harness/kernel）
ompCall(target: {model: Model; name?: string; identity?: {deployment: string; credential?: string; legacyProvider: string};
    guard?: (url: URL) => {code: string; message: string} | null; keyless?: boolean;
    apiKey: () => string | Promise<string>; priceKnown: boolean; headers?: Record<string, string>}): ModelResolution["call"];
ompModelInfo(model: Model): ModelInfo;
```

`ModelRequest`、`ModelResponse`、`ContentBlock`、`ModelInfo` 的形状以 `@notnotype/nb-harness/kernel/contracts` 导出的类型为准。`target.model` 是 OMP 的模型对象；`apiKey` 每次请求取一次、只从宿主指定的来源取，取不到时抛错或 reject；`headers` 是宿主配置的请求头（值可能是凭据）。`resolve` 是同步的：宿主在内存里维护目录、配置与“哪些服务商有凭据”的快照。

| 规则 | 内容 |
|---|---|
| 工具 id | 点分的段，每段 `[A-Za-z0-9_-]`，不含 `__` |
| 交给服务商的工具名 | 声明的 `providerName`，否则把 id 的 `.` 换成 `__`；1–64 个 `[A-Za-z0-9_-]` |

## 输出与可观察行为

1. `call` 对服务商的失败不抛错：交回 `stopReason: "error"` 的回复，带 `error: {kind, code?, status?, message, retryable?, retryAfterMs?}` 与已产生的部分内容；用户中止交回 `stopReason: "aborted"`。
2. 失败的类别按状态码与 OMP 的错误标记归，不看错误文字，按顺序取第一个符合的（OMP 把正文没有信息的 429 也标成额度用尽）：额度用尽标记或 402 → `quota`；鉴权失败标记、401、403 → `auth`；429 → `rate_limit`；上下文溢出标记或 413 → `context_overflow`；内容拦截或服务商终态错误标记 → `provider`；网关类状态码（408、502、503、504、520–524）、超时标记、没有状态码而带瞬时故障标记 → `network`；其余 → `provider`。
3. 密钥取不到（`apiKey` 抛错或 reject）时不发请求，以 `auth`、码 `missing-key` 失败。解析时有凭据、请求前凭据没了，就是这一条：模型请求已经开始，按普通的模型失败收口（端口的 `no-credentials` 只在解析时报）。
4. 错误文字里出现的密钥与 `headers` 里不短于 8 个字符的值换成固定的遮盖文字 `[REDACTED]`；“端点不要认证”的占位值不算密钥。错误文字另去掉控制字符（换行与制表符留下）、遮掉网址里的用户信息与查询串，截到 8 KB 并在末尾写明截过。
5. 请求里相邻的 user 消息合成一条发出，文字块之间空一行；同一条消息里相邻的文字块同样合并。会话日志里它们仍是分开的。
6. 工具按完整声明发出，名字按“输入与前置条件”的规则换算；回复里的工具调用按名字换回工具 id，换不回的保留原名。
7. 思考块连同签名、服务商要求带回的元数据原样存进回复、原样送回；文字块与工具调用的服务商元数据同样。作答的服务商与这次请求的服务商不同时，由 OMP 决定是否丢掉签名。
8. 停止原因：正常结束 `stop`、撞上输出上限 `length`、回复里有工具调用 `tool`。OpenAI chat completions 形状的流一直没给出结束原因、却以 `[DONE]` 收尾时记为 `length`。
9. 流式增量（文字、思考、工具参数）只交给 `onDelta`，带工具调用 id（如有）；不进回复以外的任何地方。
10. 用量带 OMP 的全部计数；单价未知时 `cost` 为 null；这次逻辑请求发出的 HTTP 请求多于一次（中间有被服务商层丢弃的尝试）或被中止时 `complete` 为 false。
11. 请求里有适配器不支持的内容时不发请求，以 `local`、码 `unsupported-content` 失败。
12. **推理档**（`reasoningOf`、`requestEffort`；用户看得到的规则见 [`models/service.md`](../models/service.md) 输出 18）：
    - `reasoningOf(model)` 交出能力：`none`（不推理）、`fixed`（会推理但不能调档）、`levels`（档位从低到高，加 `off`、`unset`、`verified`）。`off` 说“关闭思考”在线上的含义：`disable` 协议有真的关闭开关，`lowest` 关闭实发最低一档（例如 `openai/gpt-5.4`；Anthropic 的自适应模型发最低档的 `effort` 或 `between_tools`，不接受 `thinking: disabled`；OpenAI 兼容路由里关闭策略是 `omit` 的什么都不发；Gemini 的分级且不抑制的模型只关掉思考内容的回传），`none` 强制思考不能关；它按各协议实际发什么由 `requiresEffort`、`suppressWhenOff` 与协议策略（`reasoningDisableMode`、Anthropic 的自适应思考、Gemini 的思考模式）合成，不能由前两者单独推出。路由不发推理参数（`supportsReasoningParams` 为假）的模型是 `fixed`。`unset` 是请求里不指定档时线上实际发生的事：`off`（协议缺省就不思考：Qwen 的 `enable_thinking`，以及关闭是真关的 Anthropic 与 Gemini 模型，OMP 不指定档时就发关闭）、一个档位（强制思考的模型 OMP 垫到最低档）、或 null（服务商自己定）。`verified` 为假是 OMP 对缺证据的模型物化的未验证梯级。
    - `requestEffort(会话档, {info, defaultEffort})` 定这次请求的档：会话选的优先于解析带的角色默认档，都没有就不发；选的档按模型的档夹取（不在档里时取不高于它的最近一档，没有就取最低档）；`off` 在 `disable` 时显式关闭（请求的 `params.disableReasoning`），在 `lowest` 时落到最低档，在 `none`（强制思考）时落到 `unset` 那一档；不推理或不能调档的模型不发推理参数。结果还带夹取后的有效档与来源（`session`、`role`、`model`），会话快照照样给出。端口没给 `info.reasoning` 时选了什么发什么，由适配器夹取。
    - 用在每条实际的请求：对话与预览用会话档，其次角色默认档；就地压缩沿用本轮对话在这一请求边界上已经解析好的模型与档位（压缩拦截、等待期间设置变了也不再解析第二次）；摘要压缩等经 `ctx.model` 的请求按它自己解析到的角色默认档，不吃会话档；`complete()` 照角色默认档；请求草稿自己带了 `effort` 或显式 `disableReasoning`（审批）时不套。
13. `toolChoice` 按服务商的写法发出：`auto`、`none` 原样，指定工具时用换算后的名字。
14. `ompModelInfo` 给出 `<服务商>/<模型>` 的 id、上下文窗口、最大输出、是否收图片与思考、支持的推理档与推理能力（输出 12 的 `reasoningOf`）。
15. `target.headers` 随每个请求发出，在请求自己的 `headers` 之前（同名时请求的赢）。
16. 端口解析失败的码由调用方原样交回：`send`、`start` 的受理失败，`complete()` 的失败，预览的 `PreviewUnavailable`；`ctx.model`（压缩方法、审批钩子）解析失败时不写模型事件，码在交回的回复的 `error.code`（[`runtime.md`](runtime.md) 输出 5）。`role-unbound`：调用要的角色没有绑定模型，宿主不回落到别的模型。
17. `retryable` 取 OMP 对错误标记的判断（`AIError.retriable`），只有模型重复循环例外：它不重发，码 `thinking-loop`。建流时抛错、没有错误标记的失败不给 `retryable`。`retryAfterMs` 是服务商要求的等待时间，从 OMP 的错误文字里用它自己的函数取。
18. `target.transport` 给了时：`firstEventTimeoutMs` 由适配器自己计时，收到第一个内容事件前到时交回 `network`、码 `first-event-timeout`、`retryable` 为真，0 表示不计时，OMP 那一层的第一事件超时总是关掉（否则 `anthropic-messages` 会把超时再重试 10 次）；`idleTimeoutMs` 原样传给 OMP，0 表示不计时；`maxHttpAttempts` 原样传；并关掉 OMP 的空回复重试。不给 `transport` 时这些都按 OMP 的缺省。
19. 错误文字里 OMP 写的落盘诊断行（请求全文的路径）在交回前去掉，不论它在文字的哪个位置；路径交给 `target.onRequestDump`。`buildResolution` 的实现只删 OMP 日志目录下 `http-400-requests` 里的文件（路径行可能是服务商在错误正文里伪造的），文件已经没了算达成，其它删除失败写进错误文字末尾。
20. 调用说明里带了观察者时（[`runtime.md`](runtime.md) 输出 89），适配器把这一次请求的每次 HTTP 尝试交给它：地址、发出的请求头（含 OMP 加上的鉴权头）与请求体、响应状态与响应头或网络错误；交出之前把其中出现的配置密钥原值换成 `[REDACTED]`。第一块内容（文字、思考或工具调用参数的第一个增量）到达时另告诉它一次，没有内容的失败不告诉。不经 HTTP 的传输只交请求体。观察者抛错不影响请求，适配器不等它。不带观察者时行为不变。（planned）
21. **模型身份与发送前核对**（`buildResolution` 与 `OmpTarget`）：
    - `Model.provider` 在服务商的协议与地址都跟随模板时是模板的 OMP id，否则（改了协议或地址、空白模板）是中性身份 `generic-endpoint`，只带本次协议需要的字段。OMP 的复合协议 `openrouter` 物化成显式的 `openai-responses`（服务端进程环境的 `PI_OPENROUTER_RESPONSES` 为 `0` 时 `openai-completions`），之后线协议不再随环境变量变。只收能当对话模型用的协议：`openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`，且目录行的类别是对话（图片生成、裁判等独立的模型不收）。目录里有这一行、但不能当对话模型发时，`buildResolution` 交回 `transport-unsupported` 与原因（`not-chat`、`transport`），宿主对会话映射成 `unknown-model`；`ModelTarget.manual` 为真的（手加的）不查目录行，`ProviderTarget.defaultApi` 是它们没覆盖协议时用的协议。
    - `OmpTarget.name` 是公开引用 `<实例 id>/<模型 id>`，回复的 `model` 与 `ompModelInfo` 的 id 用它；不给时用 `<Model.provider>/<Model.id>`。
    - `OmpTarget.guard` 在每个请求发出前核对完整地址：源、路径与查询必须是这一协议在有效地址下会请求的那几个（OpenAI 兼容 `/chat/completions`、`/responses`，不带查询；Anthropic `/messages` 或 `/v1/messages`，查询只许 `beta`；Gemini `/models/<模型>:generateContent` 或 `:streamGenerateContent`，查询只许 `alt`），地址里不能带用户信息；`buildResolution` 另核对解析之后实例的 `uid`、有效协议与地址、认证方式与密钥都没变。不符时不发请求、整次调用立即结束（不让 OMP 按退避重试），以 `local`、码 `endpoint-mismatch` 失败（优先于适配器自己报的通用错误）。OMP 按环境变量（`MOONSHOT_BASE_URL` 等）改写的地址，连只改路径的，都在这里被拦下。请求一律 `redirect: "error"`：服务商回 3xx 时请求失败，不跟随。
    - `OmpTarget.keyless` 为真时，发出前剥掉值恰好是占位哨兵（或 `Bearer <哨兵>`）的 `Authorization`、`x-api-key`、`x-goog-api-key`；用户自己配的同名头照发。
    - `OmpTarget.route`（网络出口，[`network/egress.md`](../network/egress.md)）在每个请求发出前按完整地址选路，交回的 `proxy` 原样写进 Bun 的按次 `proxy`（`false` 是直连，盖过 `HTTP_PROXY`、`HTTPS_PROXY` 与 pi-ai 的 `PI_PROXY`）；选不出路时不发，`ompCall` 以 `local` 类别交回出口的码（`proxy-unsupported`、`proxy-invalid`、`proxy-unreadable`），与 `guard` 一样优先于适配器的通用错误、各协议不重试。选完路之后再核一次 `guard`（选路是异步的，期间配置可能已经变了）。选到的代理带凭据时，凭据进错误文字的遮盖名单。`buildResolution` 没收到 `route` 时用 `DIRECT_ROUTE`（直连）；列表、在线目录与协议检测同样收 `route`。
22. **回复的签发身份**：回复带 `origin = {provider, api, model, deployment, credential?}`（`provider`、`api`、`model` 是发给 OMP 的身份；`deployment` 由宿主给，区分实例与它当时的有效地址和协议；`credential` 只在签名绑定凭据的协议上有，是凭据值的 HMAC，不含原文）。它经 `modelEnded` 事件写进会话日志、在重开后的历史投影与 `Message` 里保留。下一次请求送回历史时，思考签名与服务商元数据只在 `origin` 整组相同（OMP 身份、协议、作答的模型、部署、`credential`）时原样送回；旧日志没有 `origin` 时按 `model` 的第一段等于当前实例 id 判断，模型 id 照历史交给 OMP，换了模型时由它不送签名；不相同时送回不带专用元数据的历史，不报错。同名删了重建（新 `uid`）、换地址或协议、同址换凭据（密钥或认证头）、同一实例换了模型之后，旧回复的签名都不再送回。
23. **缓存键按会话固定**：调用说明带 `session` 时，同一会话的每次请求（对话、压缩、审批模型）发给服务商的 `prompt_cache_key`（协议支持该字段的）相同，不同会话不同；不带（`complete()`）时由 OMP 自己生成。服务端按这个键分片缓存，每次换键等于每轮换一台后端，整段前缀都不命中。

## 状态与转换

无。适配器没有跨请求的状态；每次 `call` 独立。

## 副作用与数据

只有发往服务商的网络请求。不写文件、不读环境变量之外的凭据来源。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `missing-key` | 密钥取不到 | 让用户设置宿主指定的变量 |
| `unsupported-content` | 请求里有适配器不支持的内容 | 去掉该内容或换模型 |
| `first-event-timeout` | 等第一个事件超时 | 内核重发；一直这样时调大超时 |
| `thinking-loop` | 模型陷入重复循环 | 不重发；换说法或换模型再试 |
| `endpoint-mismatch` | 请求地址与配置的不符，或解析之后服务商被改过 | 不重发；重新解析（会话下一轮自动），地址被环境变量改写时去掉那个变量 |
| `no-model`、`no-credentials`、`unknown-model` | 端口解析不到模型或凭据 | 让用户在设置里选模型、配凭据 |
| `role-unbound` | 要的角色没有绑定模型 | 让用户在模型角色里绑定 |

## 边界与兼容

- 公开接口：`ModelPort` 与相关类型（`/kernel/contracts`）、`ompCall`、`ompModelInfo`（`/kernel`）。
- 跟随 OMP 的版本：服务商协议的细节由 OMP 实现，升级 OMP 时适配器测试要重跑。

## 验收与 Smoke

1. 本机起的 OpenAI 兼容端点（真实 HTTP、真实 OMP）：文字回复与增量、缺结束原因记 `length`、推理内容收成思考块、工具名换算与工具结果回给模型、相邻 user 合并、401/402/429 的归类与密钥遮盖、宿主请求头随请求发出且其值被遮盖、错误原文去掉网址凭据并截断、取不到密钥（同步抛错与异步 reject）不发请求、中止、不支持的内容。
2. 真实模型：一轮对话、重开、再一轮，第二轮看得到第一轮。

Smoke：`packages/nb-harness/tests/kernel/kernel.llm.test.ts`（`bun run test:llm`）。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)；重发、费用累计与适配器的传输见 [w00032 t27](../../../.agents/works/w00032-agent-integration/tasks/t27-run-reliability/README.md)（已实现，开发者 2026-11-04 批准）模型身份、发送前核对与签发身份（输出 21、22）：[w00032 t43](../../../.agents/works/w00032-agent-integration/tasks/t43-models-ux/README.md) 段 B1，取舍见 [ADR 0057](../../adr/0057-models-ux-sources-identity-egress.md) 与 [ADR 0058](../../adr/0058-models-wire-identity-full-url-and-uid.md)。解析失败带 `role`、`provider`：[w00032 t36 计划](../../../.agents/works/w00032-agent-integration/tasks/t36-conversation-panel-redesign/plan.md)的“模型不可用的提示卡”，开发者 2026-11-16 确认（t36 决定 1、9）。
