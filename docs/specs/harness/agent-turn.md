---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.agent-turn
owners:
  - nb-harness
---

# Harness 装配与对话轮次

## 目标与非目标

宿主用一次装配得到一个会话句柄：它把模型、内置文件工具、插件工具、Profile 和会话日志接在 OMP 的 Agent 循环上。宿主每提交一条用户输入，句柄就跑完一整轮（可能包含多次模型调用和工具执行），把这一轮的消息、工具调用与结果按发生顺序写进会话日志，并把运行事件实时转发给订阅者。

明确不承诺：

- 不负责 HTTP、进程或多会话管理：一个句柄对应一个会话，宿主自己决定何时创建、复用和关闭。
- 不负责审批流、权限分级、上下文压缩、订阅登录（OAuth）和 LSP 诊断。
- 不实现领域工具：领域能力经插件提供（见“术语与参与者”）。
- 不保证跨进程恢复对话：模型上下文只存在于句柄内存中（见“已知缺口”）。
- 不接入 NeuroBook 产品；产品接入由 Issue #117 管理。

## 术语与参与者

- **宿主**：创建并驱动 harness 的程序。
- **Harness（句柄）**：`createHarness` 返回的对象，持有一个 OMP Agent、一个会话日志、一个 Profile 树和一组工具。
- **轮次（turn）**：从提交一条用户输入到 Agent 循环结束的过程。一轮内可能有多次模型调用与工具执行。
- **Agent 事件**：OMP `AgentEvent`，包括 `agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`、`turn_end`、`agent_end` 等。
- **内置工具**：`read` 与 `edit`，行为见 [`harness.file-tools`](file-tools.md)。两者共享同一个编辑快照存储，因此 `read` 输出的锚点可直接用于 `edit`。
- **插件**：`{manifest: {name, version?, description?}, tools?, readFormats?}`。`tools` 是 OMP `AgentTool`，`readFormats` 扩展 `read` 能识别的文件格式。
- **模型引用**：`"provider/modelId"`，或在 OMP 内置目录中只出现一次的裸 `modelId`；也可以直接传 OMP `Model` 对象。

## 输入与前置条件

创建参数：

| 参数 | 必需 | 说明 |
|---|---|---|
| `model` | 是 | 模型引用或 `Model` 对象 |
| `cwd` | 是 | 内置工具解析相对路径的目录 |
| `sessionLog` | 是 | [`harness.session-log`](session-log.md) 的日志实例；句柄的 `sessionId` 取自它 |
| `node` | 是 | [`harness.profile-dsl`](profile-dsl.md) 的 Profile 树 |
| `plugins` | 否 | 创建时注册的插件 |
| `streamFn` | 否 | 模型流函数，缺省为 OMP `streamSimple`；测试可用 `@notnotype/nb-harness/testing` 的脚本化流 |
| `apiKey` | 否 | `(model) => string \| undefined`，缺省从环境变量解析 |
| `thinkingLevel` | 否 | OMP 推理强度 |
| `readMaxLines`、`readMaxBytes` | 否 | `read` 工具的输出预算 |

环境变量：

- API key 缺省按 OMP 的 provider 环境变量解析；provider 为 `deepseek` 时另外回退到 `DEEPSEEK_API_KEY`。
- provider 为 `deepseek` 时，非空的 `DEEPSEEK_API_BASE` 覆盖模型的 `baseUrl`（对传入的 `Model` 对象同样生效）。
- 注意：OMP 的环境模块在导入时读取 `$HOME/.env` 与当前目录等位置的 `.env` 并修改 `Bun.env`，见 [OMP 能力报告](../../../packages/nb-harness/docs/omp-capabilities.md)。

轮次输入：一段用户文本，以及可选的 `AbortSignal`。前置条件是上一轮已经结束（句柄不排队，见“状态与转换”）。

## 输出与可观察行为

- **句柄字段**：`sessionId` 等于日志的会话 id；`tools` 返回当前工具列表，内置工具在前、插件工具按注册顺序在后。
- **一轮的执行顺序**：
  1. 读取会话日志全部条目，转成渲染输入，渲染 Profile，用渲染出的系统提示段落设置 Agent 的系统提示。
  2. 把用户输入作为 `message`（`role: user`）追加到日志。
  3. 运行 Agent 循环。期间每个 Agent 事件同步、按发生顺序转发给所有订阅者，并按下表写日志：

| 事件 | 写入的条目 |
|---|---|
| `message_end` 且消息角色为 assistant | `message`，`role: assistant`，`text` 为消息中全部文本片段的拼接 |
| `tool_execution_start` | `tool_call`，含 `callId`、`toolName`、参数 JSON 文本 |
| `tool_execution_end` | `tool_result`，含 `callId`、`isError`、结果文本（无文本时为结果的 JSON） |

  4. 等待本轮全部日志写入完成，返回 `{text, entries}`：`entries` 是本轮开始后写入的全部条目（含用户消息），`text` 是其中最后一条助手消息的文本，没有则为空串。
- **模型上下文**：同一句柄的多轮对话共享 Agent 内存中的消息历史，第二轮的模型请求包含第一轮的用户、助手与工具消息。
- **订阅**：`subscribe(listener)` 返回取消函数；订阅者收到的是 OMP 原始事件对象。
- **插件**：`use(plugin)` 注册插件并立即更新 Agent 的工具列表，对之后的模型调用生效；插件的 `readFormats` 同步进入 `read` 工具。
- **关闭**：`close()` 取消内部订阅、清空订阅者、中止正在运行的循环，并等待已排队的日志写入结束。

## 状态与转换

| 当前状态 | 事件 | 结果 |
|---|---|---|
| 空闲 | `turn(input)` | 运行中；结束后回到空闲 |
| 运行中 | 再次 `turn` | 后一次被 OMP 以 `AgentBusyError` 拒绝；但它的用户消息已经写进日志（已知缺口） |
| 运行中 | 本轮 `signal` 中止 | Agent 循环中止，`turn` 正常返回，`text` 通常为空串 |
| 任意 | `use(plugin)` | 插件登记；名称重复时抛错且状态不变 |
| 任意 | `close()` | 订阅清空、循环中止；句柄没有“已关闭”状态，不阻止之后调用 `turn`，但之后的事件既不转发也不写日志；关闭后的调用结果不属于合同 |
| 日志写入失败后 | 任意后续事件 | 不再写日志；本轮及之后每一轮都在循环结束后以首个写入错误拒绝（已知缺口） |

## 副作用与数据

- 会话日志：每轮至少追加用户消息一条；助手消息与工具条目随事件追加。日志 owner 是宿主。
- 文件系统：只有内置工具与插件工具会读写文件，范围见 [`harness.file-tools`](file-tools.md)。
- 网络：模型调用经 OMP `streamSimple`（或宿主传入的 `streamFn`）发出。
- 内存：Agent 消息历史与编辑快照存储随句柄存活，不落盘；进程退出即丢失。

## 失败与恢复

- 模型引用为空、provider 未知、模型不存在或裸 id 在多个 provider 中重复：创建被拒绝，错误信息含引用原文；重复时提示改写成 `provider/modelId`。
- 创建参数中的插件名为空或重名：创建被拒绝。
- 渲染 Profile 或追加用户消息失败：`turn` 在调用模型之前拒绝。
- 工具返回错误结果：写入 `isError: true` 的 `tool_result`，循环继续，由模型决定下一步。
- 模型调用失败、缺少 API key 或被中止：`turn` 正常返回，`text` 为空串，日志多一条空文本的助手消息；错误原因不会出现在返回值或日志中（已知缺口）。
- 日志写入失败：见状态表；恢复需要宿主新建句柄。

## 边界与兼容

- 包 `@notnotype/nb-harness` 以 OMP 包族为底座，依赖精确锁定在 `18.2.5`：`pi-agent-core`、`pi-ai`、`pi-catalog`、`pi-natives`、`pi-utils`。只有 Bun 1.3.14 及以上可以运行（OMP 只发布 TS 源码）。安装会带上平台原生包（Linux x64 约 346 MB）。
- 事件与工具接口直接使用 OMP 类型，升级 OMP 可能改变事件形状；升级要一次改完全部 `@oh-my-pi/*` 并复跑本规范的验收。
- 安全边界：句柄面向受信的本机使用。内置工具不限制在 `cwd` 内，`edit` 在句柄里没有写前确认，详见 [`harness.file-tools`](file-tools.md)。
- 已知缺口（当前未保证，修复前不要依赖）：
  1. 模型失败、缺 key 与中止都表现为“正常返回、空文本”，调用方无法区分；日志条目也不记录停止原因。
  2. 并发调用 `turn` 时，被拒绝的那一次留下了一条没有回复的用户消息。
  3. 轮次开始前就已中止的 `signal` 不生效，本轮照常运行。
  4. 模型上下文不从会话日志恢复：用同一日志新建句柄后，第一轮模型请求只含本轮输入；Profile 渲染出的消息（包括 `HistorySet` 展开的历史）被丢弃，只有系统提示段落生效。
  5. 插件工具与内置工具、插件之间的工具重名不检测，工具列表里会出现两个同名工具；`definePlugin` 只检查同一插件内部。
  6. 日志写入失败后句柄一直不可用，`close()` 不报告该错误。
  7. 句柄没有注销插件的方法，`PluginHost.unregister` 未暴露。

## 验收与 Smoke

1. Given 脚本化流回复“装配测试回复”，When `turn("你好")`，Then 工具列表含 `read` 与 `edit`；订阅者收到 `agent_start` 与 `agent_end`；返回 `text` 为该回复；日志依次为用户消息与助手消息两条，返回的 `entries` 也是这两条。
2. Given 句柄已创建，When `use` 一个带 `echo` 工具的插件，Then 工具列表从不含 `echo` 变为含 `echo`。
3. Given 创建时已注册名为 `dup` 的插件，When 再 `use` 同名插件，Then 抛出“插件已注册”。
4. Given 真实 DeepSeek 凭据与一个内容已知的文件，When 要求模型用 `read` 读取并回答，Then 日志含 `toolName` 为 `read` 的 `tool_call` 和 `isError: false` 的 `tool_result`，回答非空；重读日志的 `seq` 序列不变。缺凭据时跳过并记为未验证。
5. Given 真实 DeepSeek 凭据与文件 `alpha\nbeta\ngamma\n`，When 要求模型先 `read` 再 `edit` 把第 2 行改为 `BETA`，Then 文件变为 `alpha\nBETA\ngamma\n`，日志含 `edit` 的 `tool_call`。缺凭据时跳过并记为未验证。
6. Smoke：在包目录运行 `bun examples/offline-turn.ts`，不调用真实模型完成两轮对话、插件注册与日志读回，以 0 退出；`bun examples/real-model.ts` 在有凭据时跑一轮真实 `read`，无凭据时打印跳过原因并以 0 退出。

## 实现合同

- **owner**：`packages/nb-harness`（`@notnotype/nb-harness`），依赖 `@notnotype/nb-session`、`@notnotype/nb-profile` 与 OMP 包族；不依赖 NeuroBook 产品。
- **公开接口**：`createHarness`、`Harness`、`HarnessOptions`、`HarnessTurnResult`；模型辅助 `resolveModel`、`listProviders`、`createEnvApiKeyResolver`、`applyBaseUrlOverride`；插件 `definePlugin`、`createPluginHost` 与相关类型；测试子路径 `@notnotype/nb-harness/testing` 的 `scriptedStreamFn`。逐项说明见 [API 参考](../../../packages/nb-harness/docs/api.md)。
- **关键不变量**：
  - 日志写入经单一 Promise 链串行，写入顺序等于事件顺序；`turn` 返回前必须等待该链。
  - `read` 与 `edit` 共享同一个 `EditStore` 实例，否则 `read` 输出的锚点对 `edit` 无效。
  - 每轮开始时重新渲染 Profile 并设置系统提示，Profile 的变化（例如依赖日志内容的条件）在下一轮生效。
  - 取消只能通过 `agent.abort()`：OMP 的 `prompt` 不接受 `signal`，`turn` 把 `signal` 的 abort 事件桥接到 `agent.abort()`，结束后移除监听。

## 证据

- 实现入口：[`harness.ts`](../../../packages/nb-harness/src/harness.ts)、[`model.ts`](../../../packages/nb-harness/src/model.ts)、[`plugins.ts`](../../../packages/nb-harness/src/plugins.ts)
- 合同测试：[`harness.e2e.test.ts`](../../../packages/nb-harness/tests/harness.e2e.test.ts)（场景 1–3）、[`harness.llm.test.ts`](../../../packages/nb-harness/tests/harness.llm.test.ts)（场景 4–5，`bun run test:llm`）
- Smoke：[`examples.test.ts`](../../../packages/nb-harness/tests/examples.test.ts)（运行 [`examples/offline-turn.ts`](../../../packages/nb-harness/examples/offline-turn.ts)）
- 批准依据：2026-09-18 开发者决定删除 agent-kit、以 OMP 为底座重建 harness（[w00002 Work](../../../.agents/works/w00002-neuro-agent-harness-redesign/README.md)）；实现见 [t06](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t06-nb-harness-rebuild/README.md)，本规范与已知缺口由 [t07](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t07-harness-specs-and-docs/README.md) 按代码、测试与实测补写。
