---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent-tool-result-budget
owners:
  - agent-runtime
---

# Agent Tool Result Budget

## 目标与非目标

**目标**：任何一条工具结果在进入模型上下文前都受统一硬上限约束。工具绕开自身预算返回整段大文本（例如 plot 工具的全量 JSON）时，Agent 只把有界头部与完整输出的逻辑 locator 交给模型，完整文本落在可删除、可重建的 Cache Root lease 内，模型可用 `read` 分页取回。

**非目标**：不改变任何工具的 `details` 形态，不治理 `details` 的 durable 体积（模型上下文只消费 content 文本，`details` 不进入 provider 请求）。不承诺压缩会话历史：超窗时仍有 `agent-context-compaction` 的发送前准入与压缩兜底。不给每个工具定制预算；本能力只提供统一硬安全网。

## 术语与参与者

- **工具结果预算（tool result budget）**：单条工具结果文本进入模型上下文前的字节与行数上限。
- **硬上限（hard cap）**：`TOOL_RESULT_HARD_MAX_BYTES`，`TOOL_RESULT_MAX_BYTES` 的两倍；工具自带预算必须低于它。
- **完整输出 locator**：形如 `tool-output://<uuid>/output.log` 的逻辑地址，不含物理 Cache Root。
- **Agent 输出 cache**：带 owner marker 的 lease 目录，物理位置 `Cache Root/agent/tool-output/<lease>`。
- **参与者**：`NeuroAgentHarness.executeTool`（唯一收口点）、`tool-result-budget.ts`（截断与标记）、`agent-output-store.ts`（lease、回收、读取）、`file-tools.ts`（`read` 的 locator 分页）。

## 输入与前置条件

- 触发：每次工具执行返回后，`executeTool` 在把结果交给事件、session 与 provider 之前处理一次，成功与错误结果都适用。
- 输入形状：`NeuroToolResult`，其中 `content` 是 `text` 与非文本（attachment）块的有序集合。
- 有效范围：只处理 `content` 的文本块拼接结果；非文本块、`details`、`terminate` 原样保留。
- 前置：预算判定只依赖文本字节数，不依赖工具类型、Profile 或 Project。
- 落盘前置：进程必须持有显式 `RuntimePaths`，其 `toolOutputRoot` 为 `Cache Root/agent/tool-output`。只注入隔离 Repository 的测试没有该 root。

## 输出与可观察行为

| 输入 | 模型可见结果 |
|---|---|
| 文本字节数 ≤ 硬上限 | 结果对象原样返回，文本不追加任何标记 |
| 文本字节数 > 硬上限且落盘成功 | 文本替换为「头部 + 固定标记」，标记含原始字节数、硬上限、保留字节数与完整输出 locator |
| 文本字节数 > 硬上限且落盘不可用 | 文本替换为「头部 + 无法落盘标记」，工具调用本身不失败 |
| 单行正文本身超过工具预算 | 头部退化为字节前缀，而不是空文本；标记与 locator 规则同上 |

- 模型看到的 `read` 工具描述中的截断阈值与工具预算常量一致（当前 1000 行、16 KiB）。
- 落盘成功时 `read` 可以像读普通文件一样读 locator，并按 `offset`/`limit` 分页；`details.nextOffset` 给出继续读取位置。
- locator 不可再用时，`read` 返回明确错误：`工具结果完整输出已回收：<locator>`。

## 状态与转换

| 初始状态 | 事件 | 下一状态 | 拒绝条件 |
|---|---|---|---|
| 结果文本 ≤ 硬上限 | 无 | 原样交付，不产生 cache lease | — |
| 结果文本 > 硬上限 | 预留 lease 并写入完整文本 | lease 完成，标记为 `available`，模型看到头部与 locator | 预留失败（活跃或存量 lease 占满预算）时不落盘 |
| 结果文本 > 硬上限 | 写入达到单文件硬上限 | lease 完成，标记为 `partial`，模型看到「超出 cache 单文件上限」文案 | — |
| lease 已完成 | `read` 读取 locator | 返回全文或分页片段 | 过期、被预算驱逐或物理文件缺失时抛回收错误 |

幂等与并发：同一次工具执行只处理一次；多个工具调用并发时各自独立预留 lease，Store 内部串行化预留、完成与回收。

## 副作用与数据

- **Cache 写入**：`Cache Root/agent/tool-output/<lease>/output.log` 与 owner marker `.owner.json`（owner 为 `neuro-book.agent-tool-output`）。预算为 7 天 TTL、128 个文件、256 MiB 总量、单文件 16 MiB；回收按过期时间与完成时间执行，陌生目录永不删除。
- **RuntimePaths**：新增 `toolOutputRoot`，由 `createRuntimePaths` 从 Cache Root 派生。
- **Session**：不写入新的 session entry；`details` 与 `terminate` 保持工具原样返回的值。
- **Bash 完整输出**：仍由 `bash-output://` 前缀与 `neuro-book.agent-bash-output` owner 承载，语义不变；两类 locator 共用同一 Store 实现与回收预算。
- 无网络副作用。

## 失败与恢复

| 失败场景 | 行为 |
|---|---|
| 无 `RuntimePaths` 或 root 缺失 | 跳过落盘，仍按硬上限截断并给出「无法落盘」标记 |
| 预留返回空（预算占满） | 同上，不重试、不驱逐活跃 lease |
| 写入或完成阶段抛错 | 丢弃本次 lease 后返回「无法落盘」标记；工具调用不失败 |
| `read` 读到未知前缀路径 | 交给普通文件读取路径处理，不进入 cache 分支 |
| locator 已回收 | `read` 抛 `AgentOutputReclaimedError`（`工具结果完整输出已回收：<locator>`） |

本能力 fail-open：截断与标记始终发生，落盘是可恢复的增强，不是工具成功的前置条件。

## 边界与兼容

- **所有权**：`server/agent/harness/` 拥有预算判定；`server/agent/tools/agent-output-store.ts` 拥有 cache lease 与回收；`server/runtime/paths/runtime-paths.ts` 拥有 root 派生。
- **依赖方向**：harness → tools 与 runtime/paths；Store 不依赖 harness。
- **兼容**：`bash-output://` 前缀、owner 与回收文案保持不变，旧 session 中已记录的 locator 继续可读。新增前缀 `tool-output://` 只出现在新产生的超限结果中。
- **权限**：cache 位于可删除、可重建的 Cache Root，不进入备份、迁移、File Index 与 History；模型只看到逻辑 locator，不暴露物理路径。
- **合同边界**：plot 等工具的全量 `details` 与 DTO 形态不变；`read`/`bash` 的既有分页与截断 details 字段不变，只是阈值随之变小。

## 验收与 Smoke

- **Given** 工具返回 200 KiB 文本与 `details.marker`，**When** 该轮 invocation 完成，**Then** session 中的 toolResult 文本 ≤ 硬上限、含 `tool-output://` locator、不含尾部内容，且 `details` 与 `terminate` 未被改写。
- **Given** 上一步的 locator，**When** 模型用 `read` 读取它，**Then** 返回首页并给出 `nextOffset`；用 `offset` 直接读尾部区间可得到头部之外的内容。
- **Given** 落盘不可用，**When** 结果超限，**Then** 文本仍被截断且标记写明无法落盘，工具调用不失败。
- **Given** `read` 的 locator 已过期回收，**When** 再次读取，**Then** 抛回收错误并带 locator。
- **Given** `bash` 长输出，**When** 读取其 `bash-output://` locator，**Then** 行为与本能力引入前一致。

Smoke 入口：

```
bun run --cwd packages/neuro-book test -- server/agent/harness/tool-result-budget.test.ts server/agent/tools/agent-output-store.test.ts server/agent/tools/file-tools.test.ts server/runtime/paths/runtime-paths.test.ts
bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.black-box.test.ts -t "超大工具结果"
```

**未验收**：真实 Provider 长会话下的工具结果分布、plot 全量 JSON 的实际体积分布与 cache 命中率，不能用上述自动化测试替代。

## 实现合同

- **预算判定与标记** `packages/neuro-book/server/agent/harness/tool-result-budget.ts`：`TOOL_RESULT_HARD_MAX_BYTES`、`boundToolResult`
- **阈值常量** `packages/neuro-book/server/agent/tools/truncate.ts`：`TOOL_RESULT_MAX_LINES`、`TOOL_RESULT_MAX_BYTES`、`truncateHead`
- **Cache lease** `packages/neuro-book/server/agent/tools/agent-output-store.ts`：`AgentOutputStore`、`AGENT_OUTPUT_POLICY`、`TOOL_OUTPUT_SPEC`、`BASH_OUTPUT_SPEC`、`agentOutputStoreFor`、`agentOutputStoreForLocator`、`isAgentOutputLocator`、`AgentOutputReclaimedError`
- **Root** `packages/neuro-book/server/runtime/paths/runtime-paths.ts`：`RuntimePaths.toolOutputRoot`
- **收口与读取** `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts`（`executeTool`）、`packages/neuro-book/server/agent/tools/file-tools.ts`（`read` 的 locator 分支）

**关键不变量**：

- 未超限的结果必须原样交付，不因本能力产生 cache 写入。
- 超限结果必须同时具备有界头部与可见标记；落盘失败不得让工具调用失败。
- `details` 与 `terminate` 永不被本能力改写。
- cache 只回收带本 owner marker 的 lease。

## 证据

- 合同测试：`packages/neuro-book/server/agent/harness/tool-result-budget.test.ts`、`packages/neuro-book/server/agent/tools/agent-output-store.test.ts`、`packages/neuro-book/server/agent/harness/neuro-agent-harness.black-box.test.ts`（`超大工具结果` 用例）
- 阈值行为：`packages/neuro-book/server/agent/tools/file-tools.test.ts`
- 关联 Issue：[#236](https://github.com/notnotype/neuro-book/issues/236)
- 相邻能力：[Agent Context Compaction](compaction.md) 覆盖发送前准入与压缩，本 Spec 只覆盖工具结果产出侧的预算
