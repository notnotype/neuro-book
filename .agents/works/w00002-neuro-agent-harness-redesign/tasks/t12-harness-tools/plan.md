# t12 实施计划：`tools` 模块

## Context

- **为什么做**：Work 切片 4。`runtime` 要把 Profile 列出的工具变成 OMP `Agent` 能执行的工具，并在执行前做审批；审批的判定规则、审批模型的调用、工具协议到 OMP 的适配都收在这里，`runtime` 只负责等待用户与写日志。
- **依据**：[`harness.tools`](../../../../../docs/specs/harness/tools.md)（本 Task 新写，`planned`）；[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“工具定义”“工具审批”；[`harness.config`](../../../../../docs/specs/harness/config.md) 的 `approval` 段；[`harness.session`](../../../../../docs/specs/harness/session.md) 的 `approvalGrants`。
- **开发者已确认的决定**：审批自建、借用三档等级；缺省模式按是否绑定审批角色取 `auto` 或 `write`；判定顺序与模式表按设计稿；审批模型失败一律 `escalate`；可见工具 = 列出 ∩ 可用，调用开始时取定；审批等待在工具执行包装里；不开启预测执行；工具协议自有、可结构化克隆。
- **工作方式**：同前几个 Task；适配层的测试用真实 OMP `Agent` 加脚本化模型（`testing/agent-capture.ts` 的做法），不联网。

## 关键设计

### 1. 协议与定义（`src/tools/types.ts`、`define.ts`）

- `ToolDefinition` 等类型照 Spec。`toolDefinitionProblem` 逐项检查（id 两种写法、说明、`parameters.type === "object"`、`risk` 的三种形状、`execute` 是函数），`defineTool` 通过后 `Object.freeze` 返回。
- 风险求值 `evaluateRisk(definition, args): RiskDecision`（输出 5）放在 `define.ts`，判定与适配共用。

### 2. 来源与可见工具（`src/tools/source.ts`）

- `createStaticToolSource`：`Map` 按 id；重复抛 `TypeError`；`list` 把定义转描述符（函数风险 → `"dynamic"`）。
- `visibleTools`：先把所有来源的 `list()` 合并成 `Map<id, {descriptor, sourceIndex}>`，同 id 两个来源 → `tool-conflict`（detail 写 id）；再按 `requested` 顺序挑。

### 3. 判定（`src/tools/approval.ts`）

- `resolveApprovalMode`、`decideApproval` 都是纯函数；等级比较用 `{read: 0, write: 1, exec: 2}`；模式表写成常量 `MODE_TABLE: Record<ApprovalMode, Record<ToolTier, "allow" | "ask" | "model">>`，测试按 12 格断言。

### 4. 审批模型（`src/tools/judge.ts`）

- 组装系统提示词与用户消息（截断规则按 Spec 输出 7）；`stream ?? streamSimple`（OMP）；`Promise.race` 超时；用 `AbortController` 合并外部 `signal` 与超时；从回复文本里找第一个 `{…}` 片段 `JSON.parse`。任何异常路径返回 `escalate`，`reason` 写原因类别（`timeout`、`invalid-output`、`request-failed`、`aborted`）。

### 5. 适配（`src/tools/adapter.ts`）

- `toAgentTool(descriptor, hooks)` 返回 `AgentTool`：`name`/`description`/`parameters` 来自描述符，`label` 取 id，`execute(toolCallId, params, signal, onUpdate)` 按输出 8 的顺序走，每步 `try/catch` 转错误结果；`ToolOutcome → AgentToolResult` 的转换单独一个函数（输出 9）；进度 `report` 同时调 `hooks.report` 与 `onUpdate({content: [], details: progress})`。
- 不设置 `approval`、`speculation` 等 OMP 字段。

### 6. 入口与边界

- `src/tools/tools.ts` 再导出；`package.json` 加 `./tools`；模块表登记 `tools`：依赖模块 `config`（只 `import type`），`typebox` 运行时，`@oh-my-pi/pi-ai` 运行时（`streamSimple`），`@oh-my-pi/pi-agent-core`、`@oh-my-pi/pi-catalog` 只 `import type`；不用 Node 内置模块。

## Spec 与文档改动

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/specs/harness/tools.md` | 本 Task 新写；实现中发现歧义先改 Spec；收口加“实现合同”与证据 | 计划时、S3 |
| `docs/specs/README.md` | 登记（已做）；收口标“待晋升” | S3 |
| `packages/nb-harness/package.json`、`src/architecture.test.ts` | 入口与模块表 | S1 |
| 本 Task README | 每片更新 | 各片 |

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 协议、定义校验、来源、可见工具、模式解析与判定 | 1、2、3、6 | `bun test src/tools`、`bun run typecheck`、`bun test src/architecture.test.ts` |
| S2 | 审批模型、适配到 OMP `AgentTool`（真实 `Agent` 加脚本化模型的测试） | 4、5 | 同上 |
| S3 | Spec 证据与注册表；omp 实现审查 | 全部 | `bun test`、仓库根 `bun run governance:check` 与 `bun run docs:check` |

## 验收映射

| `harness.tools` | 测试 |
|---|---|
| 输出 1、2、3；场景 1、2；`invalid-tool`、`tool-conflict` | `src/tools/source.test.ts` |
| 输出 4、5、6；场景 3 | `src/tools/approval.test.ts` |
| 输出 7；场景 4 | `src/tools/judge.test.ts`（脚本化 `stream`） |
| 输出 8–11；场景 5、6 | `src/tools/adapter.test.ts`（真实 OMP `Agent`、脚本化模型，复用 `session/testing/agent-capture.ts` 的流构造方式——不跨模块导入，复制一份到 `tools/testing/`） |

## 验证

- `bun test src/tools`、`bun run typecheck`；变异检查：判定表任一格、步骤 3 的等级比较、审批模型失败时放行、适配里参数校验被跳过、`tool-unavailable` 路径、`afterExecute` 不生效。
- 未验证边界：真实审批模型（真实模型调用待授权）；等待用户的整条链（`runtime`）。

## 不做与风险

- 不做：等待用户与持久化；内置工具；贡献点。
- 风险：OMP `AgentTool.execute` 的签名随 OMP 升级变化（当前 `(toolCallId, params, signal, onUpdate, context)`）；`typecheck` 会先失败。
- 风险：审批模型的提示词措辞会影响判定质量，第一版只保证格式与失败路径，措辞留给以后按真实样本调。
