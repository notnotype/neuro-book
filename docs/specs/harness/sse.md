---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.sse
owners:
  - nb-harness
---

# SSE 序列化与写出

## 目标与非目标

宿主要把 Agent 事件推给浏览器等客户端时，可以用本能力把事件编码成标准 Server-Sent Events 帧，并按 Node HTTP response 的背压节奏写出：同一时刻只有一帧在途，客户端断开或服务端中止都能让两侧干净收尾。

明确不承诺：

- 不提供 HTTP 服务、路由、鉴权或重连游标；`id` 字段的含义和断线续传由宿主决定。
- 不定义事件表：除 `serializeAgentEvent` 固定事件名 `agent` 外，事件名与负载由宿主决定。
- 不负责事件缓冲、合并、降级或心跳调度；订阅源（帧从哪里来、何时结束）由宿主实现。

## 术语与参与者

- **SSE 帧**：符合 WHATWG event-stream 格式的一段文本，以空行结束；注释行以 `: ` 开头。
- **帧对象**：`{frame: Buffer}`，写出器只搬运字节，不解析内容。
- **订阅**：宿主提供的异步可迭代帧源，另带首帧 `connected`、中止信号 `signal` 和 `close(reason)` 方法。
- **response**：Node `ServerResponse` 的最小子集（设置头、写、结束、销毁，以及 `drain`、`close`、`error` 事件）。

## 输入与前置条件

- 序列化事件：`data`（字符串，必需）、`event`、`id`（可选字符串）、`retry`（可选非负整数，毫秒）。
- 序列化注释：一行文本。
- 序列化 JSON 事件：`data` 为任意 JSON 值，其余同上。
- 序列化 Agent 事件：任意可 JSON 序列化的事件对象。
- 写出：一个尚未写过响应头的 response 与一个订阅。

## 输出与可观察行为

- 事件帧的字段顺序固定为 `event`、`id`、`retry`、`data`，每行形如 `字段: 值`；`data` 中的每个换行拆成一行新的 `data:`；最后以一个空行结束。
- 注释输出为 `: 文本\n`，不带结束空行。
- JSON 事件把 `data` 用 `JSON.stringify` 编码成单行。
- Agent 事件输出为事件名 `agent`、`data` 为事件 JSON 的帧。
- 写出器先设置响应头 `content-type: text/event-stream; charset=utf-8`、`cache-control: no-cache, no-transform`、`connection: keep-alive`、`x-accel-buffering: no`，有 `flushHeaders` 就调用；然后写 `connected` 帧，再按迭代顺序写每一帧。
- `write` 返回 false 时，在 `drain` 之前不写下一帧。
- 订阅迭代正常结束时结束 response，并以 `consumer_closed` 关闭订阅。

## 状态与转换

| 当前状态 | 事件 | 结果 |
|---|---|---|
| 写出中 | 订阅迭代结束 | 结束 response；以 `consumer_closed` 关闭订阅；写出器正常完成 |
| 写出中或等待 drain | response 触发 `close` 或 `error` | 以 `consumer_closed` 关闭订阅；写出器正常完成，不再写入 |
| 写出中或等待 drain | 订阅的 `signal` 中止 | 销毁 response（不附带错误）；写出器正常完成 |
| 写出中 | 迭代器或写入抛出其它异常 | 以该错误销毁 response；写出器以该错误拒绝；随后关闭订阅 |

写出器结束时一定移除自己挂在 response 与 `signal` 上的监听器。

## 副作用与数据

- 序列化函数：无副作用。
- 写出器：设置响应头、向 response 写入字节、结束或销毁 response、调用订阅的 `close`。不持久化任何数据。

## 失败与恢复

- `data` 含 CR，`event`、`id` 或注释含 CR/LF，`retry` 不是非负整数：序列化抛错，不产出半个帧。
- 客户端断开：按状态表收尾，写出器不抛错；宿主据订阅的 `close` 回调释放事件源。
- 写出过程中的其它异常：response 被销毁并带上错误，写出器把异常抛给宿主。
- 不重试、不缓冲：断开期间的帧不会补发。

## 边界与兼容

- response 接口按 Node `http.ServerResponse` 的形状定义，Bun 的 `node:http` 兼容层可以直接使用；Web `Response`/`ReadableStream` 风格的服务器需要宿主自行适配。
- 事件名 `agent` 与 Agent 事件的 JSON 形状直接来自 OMP 事件对象，升级 OMP 可能改变负载形状。
- 已知缺口（当前未保证，修复前不要依赖）：
  - `serializeAgentEvent` 不校验事件能否 JSON 序列化：传入 `undefined` 会抛出类型错误，含循环引用的对象会让 `JSON.stringify` 抛错，`Buffer` 等对象按其 JSON 形式输出。
  - response 的 `error` 事件只关闭订阅，写出器本身不销毁 response；response 是否被销毁取决于订阅的 `close` 是否中止了 `signal`。

## 验收与 Smoke

1. Given `data` 为两行、`event`、`id`、`retry` 均给出，When 序列化，Then 输出依次为 `event:`、`id:`、`retry:`、两行 `data:`，以空行结束；`data` 为空串时输出 `data: \n\n`。
2. Given `data` 含 CR、`event` 含 LF、`id` 含 CR、`retry` 为负数或小数、注释含 LF，Then 分别抛错。
3. Given 注释 `keep-alive`、JSON 负载 `{text: "多\n行"}`、Agent 事件 `{type: "agent_end"}`，Then 输出分别为 `: keep-alive\n`、单行 JSON 的 `data:`、事件名为 `agent` 的帧。
4. Given 订阅依次产出两帧后结束，When 写出，Then response 收到 SSE 响应头，写入顺序为 connected 帧、两帧，response 已结束，订阅以 `consumer_closed` 关闭。
5. Given response 的 `write` 返回 false，When 订阅产出下一帧，Then 在触发 `drain` 前不写入；触发后写入并继续。
6. Given 写出中 response 触发 `close`，Then 订阅以 `consumer_closed` 关闭，写出器正常完成且没有结束 response。
7. Given 写出中订阅的 `signal` 中止，Then response 被销毁且不带错误，写出器正常完成。
8. Smoke：在包目录运行 `bun examples/sse-stream.ts`，用 `node:http` 起本机端口，把一轮离线对话的 Agent 事件经写出器推给 `fetch` 客户端，客户端读到 `agent_start` 到 `agent_end` 后以 0 退出。

## 实现合同

- **owner**：`packages/nb-harness`。
- **公开接口**：`serializeSseEvent`、`serializeSseComment`、`serializeSseJsonEvent`、`serializeAgentEvent`、`SseEventInput`；`writeSseStream`、`SseFrame`、`SseSubscription`、`SseResponse`。逐项说明见 [API 参考](../../../packages/nb-harness/docs/api.md)。
- **关键不变量**：
  - 写出器任一时刻最多一帧在途；等待 `drain` 时同时监听 `close`、`error` 与 `signal` 中止，任一先到即结束等待并清理全部监听器。
  - 由关闭引起的结束（response 关闭、订阅中止）在写出器内部用专用错误类型区分，不抛给宿主；其它异常一律抛给宿主。
  - 写出器不解析帧内容，帧的编码完全由宿主或序列化函数负责。

## 证据

- 实现入口：[`sse.ts`](../../../packages/nb-harness/src/sse.ts)、[`sse-writer.ts`](../../../packages/nb-harness/src/sse-writer.ts)
- 合同测试：[`sse.test.ts`](../../../packages/nb-harness/tests/sse.test.ts)
- Smoke：[`examples.test.ts`](../../../packages/nb-harness/tests/examples.test.ts)（运行 [`examples/sse-stream.ts`](../../../packages/nb-harness/examples/sse-stream.ts)）
- 批准与实现：2026-09-18 开发者决定 SSE 收进 nb-harness（[w00002 Work](../../../.agents/works/w00002-neuro-agent-harness-redesign/README.md)）；实现见 [t06](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t06-nb-harness-rebuild/README.md)。t06 交付时没有 SSE 测试，合同测试由 [t07](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t07-harness-specs-and-docs/README.md) 补写。
