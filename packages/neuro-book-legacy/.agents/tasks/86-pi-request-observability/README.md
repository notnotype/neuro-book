# Pi Request Observability (Pi 请求查看器)

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- `docs/tasks/02-pi-agent-harness-migration/README.md`：Pi 迁移背景，`NeuroAgentHarness` 与 `streamSimple` 关系。
- `docs/tasks/18-agent-runtime-pipeline-hooks/README.md`：`RunFrame` / `TurnSnapshot` / `streamAssistant` 运行时对象。
- `docs/research/pi-agent-harness.md`：本地 Pi 源码调研。
- `reference/workspace/TERMS.md`：`.nbook` 路径术语（Workspace Root `.nbook`、Project Workspace）。

## User Request / Topic

做一个 **Pi 的请求查看器**。讨论阶段确认的诉求：

1. 能集成进 Pi（Pi 有相关 hook），不局限于 NeuroBook，做成通用能力。
2. 先调研已有库，不要重复造轮子。
3. 目的：让 Pi 的请求可完整观测/重放，能看到「实际发送给 API 的请求是什么」。
4. 第二阶段：记录下来的文件通过前端 UI 组件展示。
5. 关键问题：NeuroBook 想记录自己领域的数据（NeuroAgentHarness 调用、profile key、session id 等），是废弃通用包，还是扩展模块？

**重心校正（讨论中用户明确）**：核心价值是**可观测 / debug**，重放只是顺带能力。记录要重点抓「结果与健康度」，不只是请求体。

## Goal

/goal 交付一套 **Pi 请求可观测层**：默认开启地记录每次 provider 请求的「请求体 + 响应健康度 + 时序」，落成本地 JSONL，可被前端查看器展示，并保留通过 pi-ai 重跑该 turn 的能力。

- Outcome：每个 provider 调用点（主 turn / sidecar turn 的 `streamSimple`、compaction 的 `completeSimple`）产出一条 trace 记录（请求体、provider/model、HTTP status、response headers、usage、stopReason、TTFT、耗时、错误），落到 `.nbook/agent/traces/`；前端可列表+详情浏览。health-check（`model-settings.ts` 的连通性探针）2026-07-05 正式划出范围，不记录。
- Verification surface：后端单测覆盖 recorder 写盘/retention/领域元数据注入；真实 provider smoke（复用 `scripts/smoke-agent.ts` 链路）确认一次 turn 产出一条含 usage 与 payload 的记录；前端查看器手动验收。
- Constraints：默认开启也不得明显拖慢 provider 请求（写盘异步、fire-and-forget）；记录内不得包含 API key；不破坏现有 harness 行为与测试。
- Boundaries：拦截只用 pi-ai 已有的 `onPayload/onResponse`，不 fork pi-ai、不 monkeypatch 全局 fetch、不引入 HTTP 录制库（nock/polly/msw）；领域字段只在 harness 注入点补。
- Iteration policy：分期推进 P0 后端地基 → P1 前端查看器 → P2 可选重放；每轮实现报告写入本目录 `walkthroughs/`。
- Blocked stop condition：若 pi-ai `onPayload/onResponse` 无法覆盖某 provider（例如未来新 provider 不调用该钩子），停下报告缺口，而不是转去 hack fetch 层。

## Current State

- **P0 后端地基已落地**（2026-07-03..05，见 `walkthroughs/round-01-backend-foundation.md`）：recorder + 统一入口透明代理 + config 开关 + turn/compaction 两个调用点接入；59 测试 + 真实 provider smoke 通过。
- **覆盖面定稿**：turn + compaction；model-settings health-check **正式划出范围不记录**（2026-07-05 用户决定，理由见 round-01「绕道 / 出入」）。
- **P1 前端查看器已实现**（2026-07-05，见 `walkthroughs/round-03-frontend-viewer.md`）：3 只读端点 + 聊天顶栏查看器 + 设置页开关；observability 提升为一等 config section；分离库分层已按用户约束执行。**前端手动验收未执行**（清单见「P1 验证」）。
- **可搬运化收尾完成**（2026-07-06，见 `walkthroughs/round-04-portability-cleanup.md`）：core 零 NeuroBook 依赖、headers denylist、统一入口 guard、清空 bucket 入口；抽库 runbook 落档 `reference/agent/pi-trace-observability.md`，建仓等第二个消费者出现。
- **入口迁 IDE 顶栏 + scope 过滤**（2026-07-06，见 `walkthroughs/round-05-header-entry-and-scopes.md`）：查看器入口从聊天顶栏迁到 IDE 顶栏（Plot 按钮旁），聊天面板挂点移除；scope 下拉支持「最近请求（跨 bucket 聚合，`GET /api/agent/traces/recent`）/ 某 session / `_system` 无 session」，缺省最近请求。**浏览器手动验收仍未执行**。
- 调研结论（2026-07-03）：
  - **Pi = `@earendil-works/pi-ai`（provider 层）+ `@earendil-works/pi-agent-core`（runtime 层）**，v0.75.4。项目自建 `NeuroAgentHarness` 跑在 pi-ai `streamSimple()` 上，未直接用 Pi `AgentHarness`。
  - **拦截点已内置在 pi-ai，无需 hack**：`StreamOptions.onPayload(payload, model)` 与 `onResponse({status, headers}, model)`，定义在 `.agent/workspace/pi/packages/ai/src/types.ts:106-114`。
  - `onPayload` 拿到的是**最终请求体**——即传给 provider SDK 的 params 对象。已核对所有 provider 均在发送前调用：`anthropic.ts:489/499`、`openai-responses.ts:115/125`、`openai-completions.ts:145/157`、`google.ts:78`、`google-vertex.ts:96`、`mistral.ts:75`、`amazon-bedrock.ts:198/210`、`openai-codex-responses.ts:162/247`。是 provider 无关的一等 API。
  - `Model` 带 `api / provider / baseUrl / id`（`types.ts:528-533`），够重建 URL 与识别 provider。
  - NeuroBook 注入点现成：`server/agent/harness/neuro-agent-harness.ts:3536-3588` 的 `streamAssistant()`；`options` 在 `3547-3554` 拼装，`streamSimple` 在 `3555`，stream 循环在 `3558`，`message_end` 在 `3570/3586`。此处 `RunFrame`/`TurnSnapshot` 已带 `sessionId / invocationId / profileKey / turnIndex / model / apiKey`。
  - server 端目前**无任何 recorder/onPayload 相关代码**（`session-event-hub.ts` 的 replay 是 SSE 事件重放，与本任务无关）。

## Decisions / Discussion

锁定决策（AskUserQuestion + 讨论）：

1. **存储与格式**：本地 JSONL，落 `.nbook/agent/traces/`，字段**松对齐 OTel GenAI**（`gen_ai.system` / `gen_ai.request.model` / `gen_ai.usage.*` 等语义），便于将来导出到 Langfuse/OTel。不引入观测平台，符合本地优先 + 不过度设计。
2. **重放优先级**：只保留「通过 pi-ai 重跑该 turn」的能力，**不做**可 curl 的原始 HTTP 还原。重放非重心，价值在可观测/debug。
3. **开启范围**：走 Config 开关，**默认开**；保存策略可选，默认**保留最近 100 条**滚动（超出删最旧），可扩展 maxDays/maxBytes。
4. **通用 vs 领域（用户核心提问的回答）**：**扩展，不废弃、不 fork**。因为 `onPayload` 只给 `(payload, model)`，不认识 profileKey/sessionId/invocationId（harness 概念）。分层：
   - 通用 recorder 只认 pi 事实 + 一个开放 `correlation` 字段（它不解释内容）。
   - harness 在注入点绑定「带好领域元数据」的 recorder 实例。
   - 即 OTel 的 **span（通用）+ 自定义 attributes（领域）** 模式；将来把 recorder 开源给别的 pi 项目零改。
5. **覆盖面走统一入口**（2026-07-03 定）：所有 provider 调用收敛到 `server/agent/observability/traced-provider.ts`（`tracedStreamSimple`/`tracedCompleteSimple`），透明代理包裹返回流。见 Design Review 与 Round 2。

库调研结论：

- **不用** `nock` / `@pollyjs` / `msw`：面向测试 mock，需拦 fetch/socket 层，对 LLM 的 SSE 流支持差、与 provider SDK 冲突。pi-ai 已给干净拦截点，走 HTTP 层是倒退。
- **不引入** Langfuse / Helicone / OTel collector 这类重量级平台：送 UI 但引入 server/依赖，与本地优先取向冲突。仅在**字段命名**上对齐 OTel GenAI，保留将来导出的口子。
- 录制核心自写：薄薄一层包 `onPayload/onResponse` → 落一条记录。

关键工程点（契合可观测重心）：

- **`response.headers` 是宝藏**：`onResponse` 天然给 provider 的 `request-id`、`anthropic-ratelimit-*`、`retry-after`，排查限流/慢/贵靠它。
- **TTFT（首 token 延迟）**：在 `streamAssistant` stream 循环（`neuro-agent-harness.ts:3558`）首个事件处打点，LLM 可观测关键指标，基本免费。
- **隐私成本低**：`apiKey` 在 `options`、**不在 `payload`**，`onPayload` 看不到密钥——记录天然不含 API key，默认开也安全。
- **响应侧不 tee SSE 流**：`usage / stopReason / errorMessage` 复用 harness 已捕获的 `message_end` 结果，按 `invocationId + turnIndex` 与请求记录配对。

### Trace 记录 schema（设计稿，松对齐 OTel GenAI）

```jsonc
{
  "id": "trace_…",
  "ts": "2026-07-03T…",
  "status": "ok | error | aborted",

  // 关联：NeuroBook 领域字段，harness 注入点填（通用 recorder 不认识这些）
  // 各字段可选（compaction 缺 turnIndex）；kind 标明来源
  // mode = 运行形态：主 run 为 caller.kind（user/agent/sidecar/system），sidecar pass 内为 "sidecar:<passName>"
  "correlation": { "kind": "turn", "sessionId": 42, "invocationId": "uuid",
                   "profileKey": "leader.default", "turnIndex": 3, "mode": "user" },

  // 请求：pi 层事实（onPayload + model）
  "request": {
    "provider": "anthropic",        // model.provider → gen_ai.system
    "api": "anthropic-messages",    // model.api
    "model": "claude-…",            // model.id       → gen_ai.request.model
    "baseUrl": "https://…",
    "payload": { /* onPayload 原始请求体：system/messages/tools/temperature/max_tokens/reasoning */ }
  },

  // 响应：可观测重心 —— harness 已有结果 + onResponse
  "response": {
    "httpStatus": 200,              // onResponse
    "headers": { "request-id": "…", "anthropic-ratelimit-*": "…", "retry-after": "…" },
    "stopReason": "toolCalls | end | error | aborted",
    "usage": { "input": …, "output": …, "cacheRead": …, "cacheWrite": …, "total": … },
    "errorMessage": null
  },

  // 时序：可观测关键指标
  "timing": { "startedAt": …, "ttftMs": …, "durationMs": … }
}
```

### 落点与分层

| 层 | 建议文件 | 职责 |
| --- | --- | --- |
| 通用 recorder | `server/agent/observability/pi-request-recorder.ts` | 只认 pi 事实 + 开放 `correlation`；写盘 + retention。第一版不拆 npm 包（不过度设计），但保持「只认 pi」边界，将来要开源再抽。 |
| 注入点 | `server/agent/harness/neuro-agent-harness.ts:3547-3555` | 合入 `onPayload/onResponse`；循环里打 TTFT/duration；`message_end` 补 usage/stopReason；绑定领域元数据。 |
| retention | recorder 内 | 默认开，`maxRecords=100` 滚动；可扩展 maxDays/maxBytes。 |
| 配置 | 现有 Config 系统 `.nbook/config.json` | `observability.piTrace.enabled`（默认 true）、`maxRecords`、`capturePayload: full \| summary`。 |

存储：`.nbook/agent/traces/`，每 turn 一条（便于按条数滚动删除与 UI 列表）。

### 分期计划

- **P0 地基**（纯后端）：通用 recorder + harness 注入 + JSONL 落盘 + retention + config 开关。
- **P1 查看器**：列表+详情查看器。（2026-07-05 修订：入口从 user-assets 改为聊天顶栏按钮，渲染从复用 `agent-message.ts` 改为轻量结构化；定稿见下方「P1 Design」。）
- **P2 可选**：pi-ai 重跑重放按钮。

## Design Review (2026-07-03 第一轮)

对计划做了一次「对着代码核查」的审查（非代码审查，尚无代码）。拦截机制（`onPayload/onResponse`）选型正确，但计划把「每次 provider 请求一条 trace」想简单了。已证实问题：

- 🔴 P1 覆盖面：全项目有三处 provider 调用，计划只接了一处。
  - `neuro-agent-harness.ts:3555` `streamSimple`（主 turn）— 已计划。
  - `compaction.ts:229` `completeSimple`（压缩摘要）— 漏；是另一函数，但内部仍走 `streamSimple`，可接。
  - `model-settings.ts:451` `streamSimple`（模型连通性检查）— 漏；配置期、无 session 上下文。
  - 压缩是"悄悄烧 token"的隐藏调用，可观测最该覆盖它。
- 🔴 P1 错误路径跳过 `onResponse`：`anthropic.ts:498-499` 先 `.asResponse()` 再 `onResponse`；请求失败（401/429/超时/重试耗尽）时第 498 行抛出，跳过 499 行 → 失败时 `httpStatus` / `retry-after` / `anthropic-ratelimit-*` 全拿不到，错误只从 stream 回来。response headers 只在成功时有；失败侧要从 stream 的 error message / provider error 补。schema 里把 response headers 说成"debug 宝藏"是把取舍说反了。
- 🟠 P2 faux provider 不调 `onPayload`（`faux.ts:438` 只有 `onResponse`）：主 harness 端到端测试走 faux → 请求体捕获这条路测不到。只能靠 recorder 独立单测 + 真实 provider smoke。
- 🟠 P2 存储布局自相矛盾：「本地 JSONL」与「每 turn 一条 + 删最旧」冲突。单 JSONL 裁头要重写整文件；保留 100 条滚动更适合「一条一文件 `traces/<seq>.json`」。定为一条一文件。
- 🟠 P2 retention 并发：不同 session 并行跑（active lock 只锁单 session），全局「最近 100 条」的写入+裁剪需要串行化的全局 writer（参考 `session-event-hub` 的队列思路，但这里是全局计数）。
- 🟡 P3 `onPayload` 在 provider 热路径被 `await`：回调必须廉价（只快速抓引用/入队，写盘异步）；抓引用 vs 克隆是延迟/安全取舍。
- 🟡 P3 重试不可见：`onPayload` 只触发一次，SDK 内部 `maxRetries` 重试不分次可见。v1 可接受，记一笔。

### 决策：统一入口 vs 单点手接（P1 覆盖面的系统性修法）— 已定统一入口

- **统一入口（推荐）**：把所有 provider 调用收敛到 observability 层一个薄封装 `tracedStreamSimple` / `tracedCompleteSimple`，内部自动挂 trace 钩子、读配置、**包裹返回流**以捕获 TTFT/usage/stopReason/error/耗时（失败时从 stream error 补 status，不依赖会被跳过的 `onResponse`）；调用方只多传一个 `correlation`（带 `kind: "turn" | "compaction" | "health-check"`），返回值与原 pi 函数一致（透明代理）。harness / compaction / model-check 全走它。再用「禁止在该模块外直接 import `streamSimple/completeSimple`」约束（约定 + 可选 lint），将来加第 4 个调用点自动被追踪。对应 CLAUDE.md「在代码设计上约束 Agent 不犯错」。
  - 代价：封装必须是只观测、不改事件的透明代理，否则包裹 bug 会污染真实运行；关闭时直接返回原始流不套壳。model-check 追踪可能是噪声，用 `kind` + 配置决定是否记录。
- **单点手接**：只在 `streamAssistant` 手挂钩子，文档明确放弃压缩/检查的可观测。最小，但易漏、达不成"完整"目标。

结论：**已定统一入口**（2026-07-03 用户拍板）。见下方 Round 2 对它的补充约束（透明代理、密钥不入记录、顺带抓 pi 规范化 context）。

## Design Review Round 2 (2026-07-03 整体审查)

统一入口定案后对整份设计做整体审查。**架构判断：形状成立、无需返工**（统一入口 → 通用 writer + retention；correlation 承载领域；context/payload 双存）。剩余是完整性、安全、复用问题，不是架构问题。新发现：

- 🔴 P1 隐私边界 vs task 72 可分享日志包：task 72（`server/app-logs/logger.ts`）把 `data/logs/` 打包成可下载的错误报告，且**刻意不记 prompt / 请求 body / API key**。task 86 相反——记录完整请求体（含小说正文/prompt）。因此 `.nbook/agent/traces/` **必须隔离在 task 72 的日志包之外**，也不得进任何"导出诊断"流程，否则用户分享错误报告时会泄露小说正文和完整 prompt。默认开也意味着每个用户磁盘留有完整 prompt 历史，任何扫 `.nbook/agent/` 的导出路径都要避开 traces。
- 🟠 P2 密钥泄露（统一入口比 onPayload 看得多）：wrapper 收到 `options`，其中有 `apiKey`（`neuro-agent-harness.ts:3550`）和 `headers`（`compaction.ts:236`，还 merge `model.headers`——网关鉴权可能藏在自定义 header）。裸 `onPayload` 从来看不到这些。记录必须**字段白名单**，绝不 spread 原始 `options`。第一轮"记录天然无密钥"只对裸 onPayload 成立。
- 🟠 P2 顺带抓 pi 规范化 context（统一入口的红利）：各 provider 的 payload 形状差异大（anthropic `system`+`messages`+`tools`；openai-responses `input`+`instructions`；google `contents`+`systemInstruction`），单一 UI "Messages/System/Tools tab" 无法通吃。但 wrapper 同时收到 pi 规范化的 `context`（`{systemPrompt, messages, tools}`，跨 provider 统一）。**两个都存**：`request.context`（规范化 → 干净 UI tab、provider 无关）+ `request.payload`（原生 → wire-truth/重放）。这正是选统一入口才拿得到的好处，顺手补掉 UI 归一化的坑。
- 🟠 P2 retention 作用域：全局"最近 100 条"会被忙碌 session 灌满，挤掉正在调试的 session 的记录。可选：全局 / 每 session / 每 kind；debug 场景"每 session 最近 N"往往更有用。**→ 已定每 session 最近 N（2026-07-03）**，`capturePayload` 完整存。
- 🟠 P2 trace ↔ session 双向跳转（真正的 debug 杀手锏）：correlation 已带 `invocationId` + `turnIndex`，viewer 能把一次 run 的多次 API 调用分组，并从某条 session 消息跳到"产生它的原始请求"再跳回。价值最高却没写进计划，补进 P1。
- 🟡 P3 透明代理正确性（统一入口引入的新负担）：包裹返回流不能改事件/顺序/`result()`/abort。需要"包裹 vs 原始等价"测试，以及 finalize 兜底——aborted/errored run 即使调用方没调 `result()` 也要落一条记录。关闭时直接返回原始流，零开销零风险。
- 🟡 P3 复用已有本地写盘机制：task 72 `app-logs/logger.ts` 的 JSONL + 按大小轮转 + 保留 N 个是成熟模式，可借其轮转/串行写机制（不借 redaction 策略，86 刻意留 body）；`session-repo.ts:639` 的 `session-seq.json` 计数器可镜像为 `traces-seq.json`（单调 id，避免 Date.now 并发撞号）。
- 🟡 P3 config 注入而非每请求读盘：enabled 开关要在 wrapper 处可得且不每次读盘（harness 附近已在解析 config）。model-check 是配置期，无所谓。

保持不变、无需改：拦截层选型、通用/领域分层、一条一文件存储、不做 curl 重放。

## Design Review Round 3 (2026-07-03 实现可行性)

第三轮盯实现可行性，核了 pi 流的真实接口与注入点作用域。**判断：设计经得起实现推敲，无需返工**；透明代理可行、correlation 数据就位、错误/abort 兜底可靠。硬约束与细化：

- ✅ 透明代理必须是**委托式 pass-through 迭代器**：`EventStream`（`event-stream.ts:50-59`）是单消费者队列，消费即弹出。wrapper 若独立 `for await` 原始流会偷走事件、饿死 caller。正确形态：wrapper 的 `[Symbol.asyncIterator]` 做 `for await (ev of original){ observe(ev); yield ev }`（caller 拉 wrapper → wrapper 拉 original，单链），`result()` 委托 `original.result()`。
- ✅ **finalize 挂 `original.result()`，不依赖 caller**：`result()`（`event-stream.ts:64`）返回同一个 promise、可多次调用；`AssistantMessageEventStream`（69-79）即使 error/abort 也 **resolve** 成带 `stopReason:"error"/"aborted"` 的最终 message（不 reject）。因此 wrap 时就 `original.result().then(write)`，无论 caller 是否消费/abort 都能落记录 → 错误+abort 兜底的可靠实现，且**与 provider 的 `onResponse` 在错误路径是否触发无关**（Round 1 那条错误路径隐患由此绕开）。onResponse 只是成功路径 headers 的加分项。
- ✅ correlation 数据在 `executeTurn` 就位，plumbing 很浅：`executeTurn(frame, snapshot)`（3265）直接调 `streamAssistant`（3267），`frame` 带 `invocationId/profileKey/turnIndex/mode/sessionId`（3289-3290 已在用）。只需给 `streamAssistant` 加一个 `correlation` 入参、在 `executeTurn` 用 `frame` 拼好。一处小 signature 改动。
- 🟠 TTFT 只在"被迭代"的调用能测：model-check（`model-settings.ts:464`）与 compaction（`completeSimple`）都只 `await result()`、不迭代流 → 无 TTFT；仅主 turn（streamAssistant for-await，3558）能测。文档写明：TTFT 对 turn 有效，其余 null。model-check 确认是真实 provider 请求（连通性 smoke），default-off 合理。
- 🟠 存储按 session 分子目录（由"每 session 最近 N"推出）：`traces/<sessionId>/<seq>.json`，裁剪只需列该 session 目录、排序、删最旧；flat 布局要扫全部再过滤。无 sessionId 的 model-check 落 `traces/_system/`。
- 🟠 viewer 需轻量索引（task 73 list-perf 教训）：每条 trace 追加一行 summary 到 `traces/<sessionId>/index.jsonl`（id/ts/model/status/usage/ttft/耗时/bytes/correlation）；列表只读 index，详情才读整份 payload。
- 🟡 写盘 best-effort：fire-and-forget 内 disk full/权限失败只报一次 warning（走 app-logs），不 throw、不阻塞，但别完全静默。复用 task 72 "写日志失败只报告不打断" 原则。
- 🟡 测试拆两层：代理正确性（事件透传/顺序/result/abort 等价）用 faux 流即可测（faux 返回真实流，只是不调 onPayload）；请求捕获逻辑直接单测 recorder 的 onPayload/onResponse 回调（纯函数）；"pi 真会调回调"用一次真实 smoke 兜底。

## P1 Design (2026-07-05 定稿)

三个开放决策已拍板（AskUserQuestion）：**入口 = 聊天顶栏按钮 + dialog 内可切 bucket**；**Messages/Tools 渲染 = 轻量结构化（不复用聊天气泡）**；**顺带做设置页最小开关**。早期设想的「user-assets 入口」「复用 `agent-message.ts`」就此作废。
（2026-07-06 round-05 修订：入口再迁到 **IDE 顶栏**（Plot 按钮旁），聊天顶栏挂点移除；bucket 下拉升级为 **scope 下拉**——「最近请求（跨 bucket 聚合）/ 某 session / `_system`」，缺省最近请求，新增 `GET /api/agent/traces/recent`。）

### 分离库分层（2026-07-05 用户新增约束，round-03 已按此实现）

pi 查看器将来要能分离成独立库。分层规则：

| 层 | 可分离核心（零 NeuroBook 依赖） | NeuroBook 粘合 |
| --- | --- | --- |
| 后端 | `pi-request-recorder.ts`（appLogger 待注入化）、`pi-trace-reader.ts`（只吃 fs + 布局，错误 throw 不打日志） | traces route 薄文件（`useAgentHarness().repo.rootWorkspace`、createError） |
| 前端 | `trace-view-model.ts`、`AgentTraceList.vue`、`AgentTraceDetail.vue`（纯 props/events，只吃 trace DTO） | `AgentTraceViewerDialog.vue`（$fetch、session 标题 join、跳转转发）、顶栏按钮、设置面板 |

抽库时再做：traces 目录前缀参数化（现在硬编码 `.nbook/agent/traces`）、recorder 的 logger 注入。

### 实现期审查发现（2026-07-05，round-03 已修复）

- 🔴 config observability 不在 DTO 链路：`redactGlobalConfig` 逐字段组装丢字段、`saveGlobalConfig` 白名单不搬运 → 设置面板读不到现值、保存会把手写配置覆盖回默认。已把 observability 提升为一等 config section（DTO schema / redact / save 三处）。
- 🟠 `traceHealthCheck` 死配置（health-check 已划出范围，无消费者）：已从 `PiTraceConfig` / normalizer 删除；`PiTraceKind` 的 `"health-check"` 字面量保留备用。（round-02 走查观察到的「用户手动删除」即此次修复，两轮同日并行。）

### 后端：3 个只读端点

| 路由 | 返回 |
| --- | --- |
| `GET /api/agent/traces` | bucket 列表（sessionId 或 `_system`，各带条数 / 最新 ts） |
| `GET /api/agent/traces/[bucket]` | 该 bucket 的 `index.jsonl` 条目数组，倒序（列表只读索引，不碰 payload） |
| `GET /api/agent/traces/[bucket]/[id]` | 单条完整 `PiTraceRecord` |

- 新建 `server/agent/observability/pi-trace-reader.ts`：只读模块，复用 recorder 的类型与目录布局；目录不存在返回空（功能关闭时查看器显示空态，不报错）。
- route 薄文件从 `useAgentHarness().repo.rootWorkspace` 取 traces 根（镜像 `server/agent/http.ts` 的组织方式）。
- **参数强校验（防路径穿越）**：bucket 仅允许 `^\d+$|^_system$`、id 仅允许 `^\d+$`，否则 `createError(400)`；校验放 reader 内，可脱离 HTTP 单测。
- DTO：`shared/dto/agent-trace.dto.ts`，镜像 `PiTraceIndexEntry` / `PiTraceRecord`。
- bucket 的显示名（session 标题）由前端用现有 session 列表数据补全，traces 端点不做 join，保持 reader 纯粹。

### 前端：一个 Dialog，左列表右详情

- 组件目录 `app/components/novel-ide/agent/trace-viewer/`（仿 plot/thread-panel 的子目录组织）：
  - `AgentTraceViewerDialog.vue`：`common/Dialog.vue` 外壳（size xl），左列表右详情；顶部 bucket 下拉（默认选中当前 session，可切其它 session / `_system`）+ 手动刷新按钮。
  - `AgentTraceList.vue`：读 index，按 `invocationId` 分组折叠一次 run 的多次调用；行显示 kind/model/status/tokens/TTFT/耗时/时间。
  - `AgentTraceDetail.vue`：tabs = Overview（status/timing/usage/correlation/response headers）、System、Messages、Tools（三者吃 `request.context` 规范化数据，跨 provider 统一）、Payload（provider 原生请求体，JsonViewer）、Response（原始响应元数据，JsonViewer）。
- Messages 轻量结构化渲染：role 徽标 + 文本段落 + toolCall/toolResult 折叠为 `common/JsonViewer.vue`；不依赖聊天气泡组件与 session store。
- composable `app/composables/useAgentTraceApi.ts`（镜像 `useAgentSessionApi.ts` 的 `$fetch` 模式）。
- **双向跳转**：`AgentChatSurface.vue` 顶栏（`:2397` 一带，session 树按钮旁）加「请求记录」icon button（gated on activeSessionId）= session→trace；详情里 correlation.sessionId 做成链接，emit 给宿主切换会话 = trace→session。
- i18n：新增 `agent.traceViewer.*` 文案键。

### 设置页最小开关

- 新面板 `app/components/novel-ide/settings/NovelIdeObservabilitySettingsPanel.vue`，挂进 `NovelIdeSettingsDialog.vue` 的 section 列表，遵循现有 `SettingsSavePanelExpose` 保存模式（参考 cost/webTools 面板）。
- 仅两项：`observability.piTrace.enabled`（开关）+ `maxRecords`（数字）；写 `StoredGlobalConfig`（global scope——P0 config 只支持 global 覆盖）。

### P1 验证

- `pi-trace-reader` 单测：空目录 / 列表倒序 / 单条读取 / 非法 bucket 与 id 拒绝。
- 前端手动验收（per goal）：跑一次 agent → 顶栏打开查看器 → 列表按 invocation 分组正确 → 详情六 tab 正确 → 双向跳转 → 设置页关闭开关后新请求不再记录。

## Verification / Test

- ⚠️ faux provider 不调 `onPayload`（`faux.ts:438`），主 harness 端到端测试测不到请求体捕获。验证靠：
  - recorder 写盘 / retention（含并发裁剪）/ 领域元数据注入 → 独立单测。
  - 请求体捕获 + usage/timing 配对 → 真实 provider smoke（复用 `scripts/smoke-agent.ts` 链路）。
  - 错误路径（失败请求 status 从 stream error 补）→ 单测 + 一次真实失败（错 apiKey）smoke。
  - 透明代理等价性（事件透传/顺序/`result()`/abort 与原始流一致，且关闭时零套壳）→ faux 流单测。

## Implementation Walkthrough

- Round 01（P0 后端地基，2026-07-03..05）：`walkthroughs/round-01-backend-foundation.md` —— recorder / traced-provider / config / turn+compaction 接入 / 真实 provider smoke。
- Round 02（链路走查修复，2026-07-05）：`walkthroughs/round-02-review-fixes.md` —— sidecar 内层 runLoop 接入 trace（含 correlation.mode 语义定稿）/ finalize 兜底 status 修正 / `PiTraceSettings` 类型收敛。
- Round 03（P1 前端查看器 + 设置开关，2026-07-05，与 Round 02 并行）：`walkthroughs/round-03-frontend-viewer.md` —— reader + 3 端点 + 查看器 + 设置面板 + observability 一等 config section + 分离库分层。
- Round 04（可搬运化 + 债务清零收尾，2026-07-06）：`walkthroughs/round-04-portability-cleanup.md` —— tracesRoot/onWriteError 注入化（core 零 NeuroBook 依赖）/ response.headers denylist / 统一入口 guard 测试（含 compaction 裸 fallback 堵洞）/ 清空 bucket 入口 / view-model 单测 / 抽库 runbook（`reference/agent/pi-trace-observability.md`）。
- Round 05（入口迁 IDE 顶栏 + scope 过滤，2026-07-06）：`walkthroughs/round-05-header-entry-and-scopes.md` —— `listRecent` 跨 bucket 聚合 + `recent` 路由 / scope 下拉（最近/session/_system）/ `traceEntryKey` 复合键防撞 / Header+index.vue 接线（先选 session 再开面板）/ 聊天顶栏挂点移除。
- 后续每轮实现报告写入本目录 `walkthroughs/round-NN-*.md`，重大出入回写本 README。

## TODO / Follow-ups

- [x] 覆盖面方向：**统一入口**（2026-07-03 定）。
- [x] P0：`server/agent/observability/pi-request-recorder.ts`（通用 writer + retention + 串行写队列）；镜像 `session-repo` 的 `session-seq.json` 计数器模式（→ `traces-seq.json`）。
- [x] P0：`server/agent/observability/traced-provider.ts`：`tracedStreamSimple`/`tracedCompleteSimple`，透明代理（委托式 pass-through 迭代器）捕获 TTFT/usage/stopReason/error；关闭时返回原始流不套壳。
- [x] P0：记录内容白名单——只存 `context`(pi 规范化) + `payload`(provider 原生) + model/reasoning + 响应健康度；**绝不**存 `options.apiKey` / `options.headers` / `options.metadata`。
- [x] P0：调用点切统一入口——实际接入 **turn + compaction（自动 + 手动 `/compact`）+ sidecar 内层 runLoop（round-02 补，correlation.mode 区分 `sidecar:<passName>` 与 caller.kind）**；model-settings health-check **正式划出范围不记录**（2026-07-05 用户决定，见 round-01「绕道 / 出入」）。
- [x] P0：错误路径 + abort 覆盖——finalize 挂 `original.result()` 兜底，不依赖调用方；真实 smoke 已验证失败请求也落记录；message 缺失的契约外兜底路径 status 判 error 并保留错误文本（round-02 修正，此前会误标 ok）。
- [x] P0：存储 `traces/<sessionId>/<seq>.json`（无 session 落 `_system/`）+ 每 bucket `index.jsonl` + 串行 writer + best-effort（失败只 warn 不炸请求）。
- [x] P0：Config `observability.piTrace.*`（enabled 默认 true、每 session maxRecords 默认 100、capturePayload 默认 full）；`prepareRun` 解析注入 `RunFrame`，不每请求读盘。
- [x] retention 作用域：**每 session 最近 N**（2026-07-03 定）；总量 = 活跃 session × N。
- [x] `capturePayload`：**完整存**（2026-07-03 定）；靠每 session retention 兜底磁盘。
- [ ] 隐私边界长期约束：`.nbook/agent/traces/` **不得**进入 task 72 的 `data/logs/` 可分享日志包，也不得进任何「导出诊断」流程（现状成立；将来动导出 / 日志打包时必须复核）。
- [ ] P1 收尾：前端手动验收（清单见「P1 验证」+ round-05 冒烟项；可让 Agent 做浏览器验证）。
- [x] 入口迁 IDE 顶栏 + scope 过滤（2026-07-06，round-05）：Header Trace 按钮（emit → index.vue 页尾 dialog）、聊天顶栏挂点移除；scope = 最近请求（`listRecent` 跨 bucket 聚合，`traceEntryKey` 复合键防撞）/ session / `_system`，缺省最近请求；trace→session 跳转改走 index.vue `openTraceSession`（先选 session 再开面板）。
- [x] P1 后端：`pi-trace-reader.ts` + 3 个只读端点 + `shared/dto/agent-trace.dto.ts`；bucket/id 参数强校验防路径穿越（2026-07-05，round-03）。
- [x] P1 前端：`trace-viewer/` 三组件 + `trace-view-model.ts` + `useAgentTraceApi.ts`——列表读 index 按 `invocationId` 分组；详情 Overview/System/Messages/Tools/Payload/Response 六 tab，轻量结构化渲染（2026-07-05，round-03）。
- [x] P1 双向跳转：聊天顶栏「请求记录」按钮（session→trace）+ 详情「打开会话」按钮走 `selectSession()`（trace→session）（2026-07-05，round-03）。
- [x] P1 设置页最小开关面板（enabled + maxRecords，global scope）+ observability 提升为一等 config section（DTO/redact/save，round-03 审查修复）。
- [x] 审查修复：删除死配置 `traceHealthCheck`（types/normalizer，round-03；round-02 走查观察到的即此改动）。
- [x] 孤儿 trace 目录清理——已由查看器「清空当前范围」按钮 + `DELETE /api/agent/traces/[bucket]` 解决（2026-07-06，round-04）。背景：server 无 session 硬删除流程（只有 archive），孤儿目录仅在手动删 session 文件时产生。
- [ ] P2：pi-ai 重跑重放。
- [x] 其它 provider response headers 处理：以敏感头 denylist 替代逐 provider 白名单枚举（ratelimit 豁免 + 凭据类子串过滤，未知网关头默认保留），`sanitizeResponseHeaders` + 单测钉死（2026-07-06，round-04）。
- [x] 可搬运化：tracesRoot 参数化 + recorder onWriteError 注入完成，core（recorder/reader/traced-provider）零 NeuroBook 依赖；统一入口由 `unified-entry-guard.test.ts` 机器强制。剩余为实际搬运，runbook 见 `reference/agent/pi-trace-observability.md`（建仓等第二个消费者出现，2026-07-05 用户决定）（2026-07-06，round-04）。
- [x] 结束时同步 `PROJECT-STATUS.md`（2026-07-06，round-04 复核更新）。
