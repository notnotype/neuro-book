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
- 图片：请求里的图片块与回复里的图片块还没有接上大块内容的读写；请求里有图片时以 `unsupported-content` 失败，回复里的图片块不收。
- 服务商层看不见的重试不单独审计；用量可能漏计，以 `complete: false` 表示（输出 10）。
- 流式增量不给扩展、不进日志。

## 术语与参与者

- **模型端口**：宿主实现的 `ModelPort`，按核心设置与用途解析出一个可调用的模型。
- **适配器**：把 `ModelRequest` 转成某个服务商协议、把回复转回 `ModelResponse` 的实现；本包提供 OMP 适配器。
- **逻辑请求**：内核发出的一次请求；适配器内部的鉴权重试、推理循环都算在这一次里。

## 输入与前置条件

```ts
interface ModelPort {
    resolve(settings: CoreSettings, purpose: RequestPurpose, role?: string): ModelResolution;
}
type ModelResolution =
    | {ok: true; info: ModelInfo; call(request: ModelRequest, signal: AbortSignal, onDelta: (delta: ModelDelta) => void): Promise<ModelResponse>}
    | {ok: false; code: "no-model" | "no-credentials" | "unknown-model"};

// OMP 适配器（@notnotype/nb-harness/kernel）
ompCall(target: {model: Model; apiKey: () => string; priceKnown: boolean}): ModelResolution["call"];
ompModelInfo(model: Model): ModelInfo;
```

`ModelRequest`、`ModelResponse`、`ContentBlock`、`ModelInfo` 的形状以 `@notnotype/nb-harness/kernel/contracts` 导出的类型为准。`target.model` 是 OMP 的模型对象；`apiKey` 只从宿主指定的来源取，取不到时抛错。

| 规则 | 内容 |
|---|---|
| 工具 id | 点分的段，每段 `[A-Za-z0-9_-]`，不含 `__` |
| 交给服务商的工具名 | 声明的 `providerName`，否则把 id 的 `.` 换成 `__`；1–64 个 `[A-Za-z0-9_-]` |

## 输出与可观察行为

1. `call` 对服务商的失败不抛错：交回 `stopReason: "error"` 的回复，带 `error: {kind, code?, status?, message}` 与已产生的部分内容；用户中止交回 `stopReason: "aborted"`。
2. 失败的类别按状态码与 OMP 的错误标记归，不看错误文字，按顺序取第一个符合的：额度用尽标记或 402 → `quota`；鉴权失败标记、401、403 → `auth`；429 → `rate_limit`；上下文溢出标记 → `context_overflow`；内容拦截或服务商终态错误标记 → `provider`；网关类状态码（408、502、503、504、520–524）、超时标记、没有状态码而带瞬时故障标记 → `network`；其余 → `provider`。
3. 密钥取不到时不发请求，以 `auth`、码 `missing-key` 失败。
4. 错误文字里出现的密钥换成固定的遮盖文字 `[REDACTED]`；“端点不要认证”的占位值不算密钥。
5. 请求里相邻的 user 消息合成一条发出，文字块之间空一行；同一条消息里相邻的文字块同样合并。会话日志里它们仍是分开的。
6. 工具按完整声明发出，名字按“输入与前置条件”的规则换算；回复里的工具调用按名字换回工具 id，换不回的保留原名。
7. 思考块连同签名、服务商要求带回的元数据原样存进回复、原样送回；文字块与工具调用的服务商元数据同样。作答的服务商与这次请求的服务商不同时，由 OMP 决定是否丢掉签名。
8. 停止原因：正常结束 `stop`、撞上输出上限 `length`、回复里有工具调用 `tool`。OpenAI chat completions 形状的流一直没给出结束原因、却以 `[DONE]` 收尾时记为 `length`。
9. 流式增量（文字、思考、工具参数）只交给 `onDelta`，带工具调用 id（如有）；不进回复以外的任何地方。
10. 用量带 OMP 的全部计数；单价未知时 `cost` 为 null；这次逻辑请求发出的 HTTP 请求多于一次（中间有被服务商层丢弃的尝试）或被中止时 `complete` 为 false。
11. 请求里有适配器不支持的内容时不发请求，以 `local`、码 `unsupported-content` 失败。
12. 推理档按模型支持的档夹取；不支持推理的模型不发推理参数。
13. `toolChoice` 按服务商的写法发出：`auto`、`none` 原样，指定工具时用换算后的名字。
14. `ompModelInfo` 给出 `<服务商>/<模型>` 的 id、上下文窗口、最大输出、是否收图片与思考、支持的推理档。

## 状态与转换

无。适配器没有跨请求的状态；每次 `call` 独立。

## 副作用与数据

只有发往服务商的网络请求。不写文件、不读环境变量之外的凭据来源。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `missing-key` | 密钥取不到 | 让用户设置宿主指定的变量 |
| `unsupported-content` | 请求里有适配器不支持的内容 | 去掉该内容或换模型 |
| `no-model`、`no-credentials`、`unknown-model` | 端口解析不到模型或凭据 | 让用户在设置里选模型、配凭据 |

## 边界与兼容

- 公开接口：`ModelPort` 与相关类型（`/kernel/contracts`）、`ompCall`、`ompModelInfo`（`/kernel`）。
- 跟随 OMP 的版本：服务商协议的细节由 OMP 实现，升级 OMP 时适配器测试要重跑。

## 验收与 Smoke

1. 本机起的 OpenAI 兼容端点（真实 HTTP、真实 OMP）：文字回复与增量、缺结束原因记 `length`、推理内容收成思考块、工具名换算与工具结果回给模型、相邻 user 合并、401/402/429 的归类与密钥遮盖、取不到密钥不发请求、中止、不支持的内容。
2. 真实模型：一轮对话、重开、再一轮，第二轮看得到第一轮。

Smoke：`packages/nb-harness/tests/kernel/kernel.llm.test.ts`（`bun run test:llm`）。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)
