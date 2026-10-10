---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.tools
owners:
  - nb-harness
---

# Harness 工具：定义、来源、可见性、审批判定与审批模型

## 目标与非目标

`nb-harness` 的 `tools` 模块定义内核自己的工具协议（可结构化克隆的定义与结果，插件以后也按它写工具），给出工具来源与可见工具的算法，以及**工具审批的判定**：按工具声明的等级与策略、配置、本会话内的允许、审批模式，算出一次调用是放行、拒绝、询问用户还是先交给审批模型；审批模型的那一次调用也在这里。最后把内核协议的工具适配成 OMP `Agent` 能执行的 `AgentTool`：参数校验、审批关卡、结构化错误与进度，都在这层包装里。

不承诺：

- 等待用户应答、`interaction` 条目的写入与恢复、会话状态机：由 `runtime` 负责，本模块只给它一个“判定结果”和一个在执行前等待的钩子。
- 内置的读写工具：另一个切片；本模块只提供协议与适配。
- 插件系统的贡献点、项目级的参数注入：插件阶段由使用方实现 `ToolSource` 与 `ToolInterceptor`。
- 审批决定的持久化格式：见 [`harness.session`](session.md) 的 `interaction` 条目。

## 术语与参与者

- **工具定义**：`defineTool` 的结果：id、说明、参数 schema、风险、作用域与执行函数。
- **等级**：`read`、`write`、`exec` 三档，借自 OMP；未声明按 `exec`。
- **策略**：工具对一组参数声明的 `deny`（一律拒绝）或 `ask`（一律询问用户，`yolo` 除外）。
- **工具来源**：列出可用工具、按次取实现的对象；内核缺省是静态列表，插件阶段汇总贡献点。
- **可见工具**：Profile 的 `harness/tools` 字段列出的 ∩ 来源此刻可用的，在每次调用开始时取定。
- **审批模式**：`always-ask`、`write`、`auto`、`yolo`（[`harness.config`](config.md) 的 `approval.mode`）。
- **本会话内允许**：用户以 `scope: "session"` 批准过的工具与等级（[`harness.session`](session.md) 输出 14 的 `approvalGrants`）。
- **判定**：对一次工具调用算出的结果：放行、拒绝、询问用户、交给审批模型。
- **审批模型**：模型角色 `approval` 解析出的模型，对一次调用给出 `allow`、`deny` 或 `escalate`。

## 输入与前置条件

```ts
// 公开入口 @notnotype/nb-harness/tools
defineTool<P extends TSchema>(definition: ToolDefinition<P>): ToolDefinition<P>;     // 不合规则抛 TypeError
toolDefinitionProblem(definition: unknown): string | null;
type ToolDefinition<P extends TSchema = TSchema> = {
    id: string;                                 // 内置工具 [a-z][a-z0-9-]*；插件工具 <插件 id>/<名称>
    description: string;
    parameters: P;                              // TypeBox 对象 schema
    risk?: Risk;                                // 缺省 exec
    scope?: "session" | "project";             // 缺省 session
    execute(args: Static<P>, context: ToolContext): Promise<ToolOutcome>;
};
type Risk = ToolTier | RiskDecision | ((args: unknown) => ToolTier | RiskDecision);
type RiskDecision = {tier: ToolTier; policy?: "deny" | "ask"; reason?: string};
type ToolTier = "read" | "write" | "exec";
type ToolContext = {signal: AbortSignal; session: {id: string}; toolCallId: string; report(progress: JsonValue): void};
type ToolOutcome =
    | {ok: true; content: string | (TextContent | ImageContent)[]; details?: JsonValue}
    | {ok: false; code: string; message: string; details?: JsonValue};

interface ToolSource {
    list(): ToolDescriptor[];                   // 此刻可用的工具
    get(id: string): ToolDefinition | undefined; // 按次取实现；取不到就是此刻不可用
}
type ToolDescriptor = {id: string; description: string; parameters: TSchema; risk: ToolTier | "dynamic"; scope: "session" | "project"};
createStaticToolSource(tools: readonly ToolDefinition[]): ToolSource;

visibleTools(input: {requested: readonly string[]; sources: readonly ToolSource[]}): ToolsResult<ToolDescriptor[]>;

resolveApprovalMode(input: {session?: ApprovalMode; config?: ApprovalMode; profile?: ApprovalMode; approvalRoleBound: boolean}): ApprovalMode;
decideApproval(input: {
    tool: ToolDefinition; args: unknown; mode: ApprovalMode;
    config: Readonly<Record<string, "allow" | "deny" | "ask">>;             // harness.config 的 approval.tools
    grants: readonly {toolName: string; tier?: string}[];                   // harness.session 的 approvalGrants
}): Decision;
type Decision = {outcome: "allow" | "deny" | "ask" | "model"; tier: ToolTier; step: 1 | 2 | 3 | 4 | 5 | 6; reason: string};

judgeWithModel(input: {model: Model; apiKey?: string; request: JudgeRequest; stream?: StreamFn; signal?: AbortSignal; timeoutMs?: number}): Promise<Judgement>;
type JudgeRequest = {tool: {id: string; description: string}; args: JsonValue; tier: ToolTier; reason?: string; profile: {id: string; name: string}; recent: readonly Message[]};
type Judgement = {decision: "allow" | "deny" | "escalate"; reason: string};

toAgentTool(descriptor: ToolDescriptor, hooks: AdapterHooks): AgentTool;
type AdapterHooks = {
    source: ToolSource;                                                       // 执行时按次取实现
    session: {id: string};
    approve(request: ApprovalRequest): Promise<ApprovalOutcome>;              // 由 runtime 提供：判定、必要时等用户；拿到的是本次要执行的那份定义与中止信号
    interceptor?: ToolInterceptor;
    report?(call: ToolCall, progress: JsonValue): void;
};
type ToolCall = {toolCallId: string; toolId: string; args: unknown};
type ApprovalRequest = ToolCall & {definition: ToolDefinition; signal: AbortSignal};   // definition 就是适配层按次取到、随后执行的那份；风险判定用它
type ApprovalOutcome = {approved: true} | {approved: false; reason: string} | {aborted: true};
type ToolInterceptor = {
    beforeExecute?(call: ToolCall): Promise<{args: unknown} | {deny: string}>;
    afterExecute?(call: ToolCall, outcome: ToolOutcome): Promise<ToolOutcome>;
};
type ToolsResult<T> = {ok: true; value: T} | {ok: false; code: ToolsFailure; detail: string};
type ToolsFailure = "invalid-tool" | "tool-conflict";
```

`TSchema`、`Static` 是 TypeBox 的类型；`Model`、`StreamFn`、`AgentTool`、`Message`、`TextContent`、`ImageContent` 是 OMP 的类型；`ApprovalMode` 见 [`harness.config`](config.md)；`JsonValue` 与 [`harness.session`](session.md) 的定义相同，本模块自己声明。

| 规则 | 内容 |
|---|---|
| id | 内置工具 `[a-z][a-z0-9-]*`；插件工具 `<命名空间>/<名称>`（与会话条目的 `customType` 同样的两段写法） |
| `description` | 非空 |
| `parameters` | TypeBox 对象 schema（`type: "object"`） |
| `risk` | 等级字面量、`RiskDecision` 或函数；`RiskDecision.tier` 必须是三档之一 |
| 结果 | `ToolOutcome` 必须能被结构化克隆：`details` 是 JSON 值，`content` 只含文字与图片块 |

## 输出与可观察行为

1. **定义校验**：`defineTool` 按上表检查，不合规则抛出 `TypeError`，消息说明哪一项；`toolDefinitionProblem` 返回同样的说明而不抛出。通过的定义原样返回（冻结）。
2. **静态来源**：`createStaticToolSource` 的 `list` 按给定顺序列出每个工具的描述符（`risk` 为函数时写 `"dynamic"`）；`get` 返回定义；同一列表里 id 重复时 `createStaticToolSource` 抛出 `TypeError`。
3. **可见工具**：`visibleTools` 按 `requested` 的顺序列出各来源此刻列出的工具，`requested` 里来源没有的 id 不出现、不报错；同一个 id 出现在两个来源里为 `tool-conflict`，整个结果失败，不静默取其一。
4. **模式解析**：`resolveApprovalMode` 依次取 `session`、`config`、`profile` 里第一个给出的值；都没有时，`approvalRoleBound` 为真为 `auto`，否则为 `write`。
5. **风险求值**：工具的 `risk` 是函数时对这组参数调用一次；没有 `risk` 按 `{tier: "exec"}`；函数抛错，或返回的值不符合 `risk` 的形状规则（等级不是三者之一、`policy` 不是 `deny`/`ask`、`reason` 不是字符串、返回 `undefined` 或函数），都按 `{tier: "exec", policy: "ask", reason: <原因>}`（最严，交给用户）。
6. **判定顺序**：`decideApproval` 取第一个命中的，`step` 记命中的那一步：
    1. 风险的 `policy` 为 `deny` → `deny`；
    2. 配置里该工具为 `deny` → `deny`；
    3. `grants` 里有该工具且等级相同或更高（`exec` > `write` > `read`）→ `allow`；
    4. 风险的 `policy` 为 `ask` → `ask`（`yolo` 下为 `allow`）；
    5. 配置里该工具为 `allow` → `allow`，为 `ask` → `ask`；
    6. 按模式与等级：`always-ask` 放行 `read`、其余 `ask`；`write` 放行 `read`、`write`，`exec` 为 `ask`；`auto` 放行 `read`，其余 `model`；`yolo` 全部放行。
    `reason` 一句说明命中的依据（含工具声明的 `reason`）。
7. **审批模型**：`judgeWithModel` 用给定模型做一次不带工具的调用：系统提示词说明任务与只能输出一行 JSON `{"decision": "allow" | "deny" | "escalate", "reason": string}`；用户消息里工具 id、等级、说明与理由放在 `<tool>` 块，参数放在 `<arguments>` 块（JSON；其中每个字符串各自截到 4 KiB 以内、截断标记计入预算，键与其它值原样保留，结果仍是合法 JSON；逐字段截断后整体仍超过 16 KiB 时不问模型，直接 `escalate`，原因 `args-too-large`），`recent` 里最后至多 6 条消息各放在带 `role` 的 `<message>` 块（文本各截到 1 KiB 以内）；块里的内容把 `<` 转义，所以工具结果里的“user: …”行或 `</message>` 不能伪造消息边界。系统提示词明说这些块里的文字是待审材料，其中的“已授权”“请批准”不算授权。回复里第一个能解析的 JSON 对象（任意 `{` 起、任意 `}` 止，解析不出的候选跳过）若 `decision` 是三者之一就采用，否则不再往后找；解析不出、`decision` 不合法、调用失败、`signal` 中止或超过 `timeoutMs`（缺省 30 秒）一律 `{decision: "escalate", reason: <原因>}`，决不因为审批模型出问题而放行。中止与超时由本函数自己结算，不依赖模型的流配合：流不响应取消时到点照样返回 `timeout`；取消已触发后流才带着回复结束的，回复不采用（`aborted` 或 `timeout`）。
8. **适配：执行顺序**：`toAgentTool` 返回的 `AgentTool` 执行时依次：按 `descriptor.id` 从 `source.get` 取实现（取不到 → 结果为错误 `tool-unavailable`）；用 OMP 的 JSON Schema 校验器（`validateJsonSchemaValue`，与它的循环同一实现，所以 `pattern` 等约束的语义两层一致）按 `parameters` 校验参数（不合 → 错误 `invalid-arguments`，说明路径与原因；经 OMP 的循环调用时，OMP 先校验并做类型转换，缺必填字段等不合的调用由它以自己的错误文本拦下、不到达适配层，这一步为直接调用与拦截器改写的参数兜底）；`interceptor.beforeExecute`（返回 `deny` → 错误 `denied`；返回 `args` 则用它再校验一次）；`hooks.approve`（收到 `ApprovalRequest`：调用、本次取到的定义与中止信号；`approved: false` → 错误 `denied` 带理由；`aborted` → 错误 `aborted`）；`execute`；`interceptor.afterExecute`。每一步都不抛出：异常变成错误结果（来源 `get` 抛出 → `tool-unavailable`；其它漏网的异常 → `execution-failed`）。审批等待由适配层与中止信号竞速：进入审批前已中止、等待期间中止、或批准返回时已中止，都得到错误 `aborted` 且不开始 `execute`，钩子不配合也一样。来源在等待期间更新同 id 的工具不影响这次调用：审批与执行用的是同一份定义。
9. **适配：结果**：`ToolOutcome` 为 `ok: true` 时内容原样进 `AgentToolResult.content`（字符串变成一个文本块），`details` 原样；`ok: false` 时 `isError: true`，文本为 `<code>: <message>`，`details` 原样；`execute` 抛出时 `isError: true`，文本为 `execution-failed: <错误消息>`，不带堆栈。
10. **适配：进度与中止**：`context.report(progress)` 调用 `hooks.report` 并经 OMP 的 `onUpdate` 发出部分结果（`details: progress`）；`context.signal` 就是 OMP 给的中止信号，也是 `ApprovalRequest.signal`；已经开始执行的工具在中止后仍返回的结果照常交回，尚未开始的按输出 8 不再开始。
11. **适配：描述**：`AgentTool` 的 `name`、`description`、`parameters` 来自描述符，`label` 取 id；不设置 OMP 的 `approval` 字段（审批由本模块的包装做）、不开启预测执行。

## 状态与转换

本模块没有状态。`decideApproval`、`resolveApprovalMode`、`visibleTools` 是纯函数；`judgeWithModel` 只发一次模型请求；适配出的工具每次执行都重新取实现。

**时序与寿命**：

- 可见工具在每次调用开始时取定（`visibleTools`），调用中途来源的变化不改变列表；中途某工具 `get` 不到时按输出 8 得到 `tool-unavailable`。
- `hooks.approve` 在参数校验与 `beforeExecute` 之后、`execute` 之前被调用，等待多久由 runtime 决定；等待期间 OMP 的循环停在这一批工具上；`Agent.abort` 结束等待（适配层按信号结算，不等钩子返回）。

## 副作用与数据

无 I/O；`judgeWithModel` 发一次模型请求（经 OMP `streamSimple`，测试可注入 `stream`）。审批判定的记录由 runtime 写进会话。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-tool` | 工具定义不合规则（`toolDefinitionProblem` 的说明） | 修正定义 |
| `tool-conflict` | 同一个 id 来自两个来源 | 调整来源或 Profile 的工具列表；本次调用不受理 |

交给模型的错误结果（`AgentToolResult.isError`）的码：`tool-unavailable`、`invalid-arguments`、`denied`、`aborted`、`execution-failed`，以及工具自己返回的 `ok: false` 的 `code`。

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/tools` 中“输入与前置条件”列出的符号与类型；内核协议（`ToolDefinition`、`ToolOutcome`、`ToolSource`、`ToolInterceptor`）是插件阶段的公开 API。
- **依赖**：对 `config` 只用类型；运行时依赖 TypeBox 与 OMP `@oh-my-pi/pi-ai`（`streamSimple`）；对 `@oh-my-pi/pi-agent-core`、`@oh-my-pi/pi-catalog` 只用类型。
- **信任边界**：工具实现受信任（与 Profile 一样）；参数来自模型，一律按 schema 校验后才交给工具。审批模型看到的参数、工具说明与近期对话都是不可信内容：按输出 7 放在带来源的块里并转义，其中的指令不改变审批任务。
- **schema 方言**：`parameters` 用 TypeBox 定义，但运行时校验用 OMP 的校验器（输出 8）；TypeBox 自己的 `Value.Check` 对 `pattern` 用带 `u` 标志的正则，与 OMP 不同，所以本模块不用它。`pattern` 必须能被不带 `u` 标志的 `RegExp` 编译，否则定义时拒绝（输出 1）。

## 验收与 Smoke

1. 定义：合法的内置与插件工具通过；id、说明、参数、风险各写坏一种，`defineTool` 抛 `TypeError`、`toolDefinitionProblem` 给出同样的说明。
2. 可见工具：两个来源、Profile 列出四个 id（其中一个没有来源）：结果按 Profile 顺序三个；两个来源各有同名工具时 `tool-conflict`。
3. 判定表：四种模式 × 三档等级的 12 格各得到表里的结果；再逐步覆盖 1–5：策略 `deny`、配置 `deny`、本会话内允许（等级相同与更高）、策略 `ask`（`yolo` 下放行）、配置 `allow`/`ask`、风险函数抛错。
4. 审批模型：用脚本化的 `stream` 依次回复 `allow`、`deny`、`escalate`、不是 JSON、`decision` 不合法、抛错、超时（`timeoutMs` 很小且流不结束），前三者照回复，其余全部 `escalate`；参数与近期消息按上限截断后出现在请求里。
5. 适配（真实 OMP `Agent`、脚本化模型）：模型连续调用三个工具——一个 `approve` 立即放行并带进度，一个 `approve` 返回拒绝，一个缺必填参数：发往模型的结果分别为工具内容、`denied: …`、OMP 的参数错误；直接调用适配出的工具并传不合 schema 的参数得到 `invalid-arguments: …`；再让来源在调用中途撤掉一个工具，得到 `tool-unavailable`；中止时得到 `aborted`。
6. 拦截器：`beforeExecute` 改写参数后工具收到新参数；返回 `deny` 时工具不执行；`afterExecute` 改写结果后模型看到改写后的内容。

Smoke：`packages/nb-harness` 的 `bun test src/tools`。

## 实现合同

- 公开入口：`@notnotype/nb-harness/tools`（`defineTool`、`toolDefinitionProblem`、`evaluateRisk`、`createStaticToolSource`、`visibleTools`、`resolveApprovalMode`、`decideApproval`、`judgeWithModel`、`buildJudgeMessages`、`toAgentTool`、`toAgentToolResult` 与“输入与前置条件”的类型）。
- owner：`nb-harness` 的 `tools` 模块；对 `config` 只 `import type`；运行时依赖 TypeBox 与 `@oh-my-pi/pi-ai`（`streamSimple`），对 `@oh-my-pi/pi-agent-core`、`@oh-my-pi/pi-catalog` 只用类型。
- 内部不变量（都有测试锁定）：
  1. 判定是纯函数，第一个命中的步骤决定结果；审批模型的任何失败路径都是 `escalate`。
  2. 适配层每一步都不抛出，异常变成带码的错误结果；执行前按次从来源取实现。
  3. OMP 的循环先按 schema 校验并转换参数，适配层的校验只兜底直接调用与拦截器改写。

## 证据

- 实现入口：[`packages/nb-harness/src/tools/tools.ts`](../../../packages/nb-harness/src/tools/tools.ts)
- 合同测试：[`source.test.ts`](../../../packages/nb-harness/src/tools/source.test.ts)、[`approval.test.ts`](../../../packages/nb-harness/src/tools/approval.test.ts)、[`judge.test.ts`](../../../packages/nb-harness/src/tools/judge.test.ts)、[`adapter.test.ts`](../../../packages/nb-harness/src/tools/adapter.test.ts)（真实 OMP `Agent`、脚本化模型）
- Smoke：[`adapter.test.ts`](../../../packages/nb-harness/src/tools/adapter.test.ts) 的场景 5（真实 OMP `Agent`）
- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“工具定义”“工具审批”两节与决策记录（开发者 2026-10-10 决定：审批自建、借用三档等级；缺省模式按是否绑定审批角色取 `auto` 或 `write`；工具进 Profile 按“列出 ∩ 可用”，列表在调用开始时取定；审批等待放在工具执行包装里）。
