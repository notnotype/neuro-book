# Agent Tool Definition Layer

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [Agent Profile Tool Bindings](../47-agent-profile-tool-bindings/README.md)
- [Agent Sidecar Profile Pass](../23-agent-sidecar-profile-pass/README.md)
- [Agent Runtime Pipeline Hooks](../18-agent-runtime-pipeline-hooks/README.md)
- [Profile Guide](../../../reference/agent/profile-guide.md)
- [Sidecar Profile Pass Reference](../../../reference/agent/sidecar-profile-pass.md)

## User Request / Topic

- 重构工具系统。47 号任务把 profile 的 `allowedToolKeys: string[]` 迁到 `tools` binding 对象，但工具的“定义本身”仍没有提升为 binding 的来源，导致同一工具 key/schema/description 的真相被拆成两套并行 factory。
- 目标：让工具层只有一个 canonical tool source，profile 只是引用这个 source 生成 binding。
- 同时允许用户在 profile 内自定义工具，挂载在 `tools` 字段中；`tools` 字段成为该 profile 工具的唯一来源。

## Goal

建立统一的 `AgentToolDefinition` 定义层，使工具 key / schema / description / execute 只有一处真相源；profile `tools` 字段同时承载“引用内置工具”“内联自定义工具”“引用已注册插件工具”三种来源，并由 binding 派生 provider-visible schema 与执行权限。

- Outcome：
  - `defineAgentTool()` 是内置工具与自带工具共用的唯一定义入口，产物可 `.runtime()` 生成 `NeuroAgentTool`，本身亦可作为 `ToolBinding` 放进 profile `tools`。
  - profile 可内联 `defineAgentTool({...})` 自定义工具（携带 `executeWithContext`），随 compiled `.mjs` bundle 加载并被模型看到、执行。
  - `report_result` 的 `dataSchema` 从通用 `ToolBinding` 移除，做成专用 binding。
  - `profileToolsFromKeys` 从生产路径删除。
- Verification surface：
  - profile 定义层校验测试（`define-agent-runtime.test.ts` / `profile-dsl.test.ts`）。
  - harness 工具解析测试（`neuro-agent-harness.test.ts`：provider-visible schema、执行权限、自带工具可见且可执行、自带审批工具 suspend/resume）。
  - report_result schema 测试（`report-result-schema.test.ts`）。
  - 系统 profile artifacts 重新编译通过（`profile compile --all --system`、`profile:metadata`）。
- Constraints：
  - 内置工具行为不变（read/write/edit/apply_patch/bash/agent/plot/variable/web/subject/sql）。
  - 全局工具仍只注册一次；自带工具作用域限定在持有该 binding 的 profile run 内，不进全局 registry。
  - 不破坏类型系统，不引入 `any`/`unknown` 宽类型逃生。
- Boundaries：`server/agent/tools/**`、`server/agent/profiles/**`、`server/agent/harness/neuro-agent-harness.ts`、`assets/.../builtin/*.profile.tsx`、相关 reference / skill 文档。
- Iteration policy：先做不改行为的定义层抽象，再迁移 binding，再改 harness 解析，最后迁移 profile 与刷新 artifacts；每阶段独立验证。
- Blocked stop condition：若 compiled artifact 无法携带 execute 函数（已验证可行，见 Current State），或 harness 解析改造破坏现有 approval/sidecar 链路无法收敛，停止并报告具体阻塞点。

## Baseline Before Implementation

### 三层模型现状对齐

- 创建任务时，定义层（目标 `AgentToolDefinition`）**不存在**。真工具是 `NeuroAgentTool`（`server/agent/tools/types.ts:22`），由 `createReadTool()` 等各自手写返回，含 `execute`（占位 throw）与 `executeWithContext`（真实入口）双形态。
- 创建任务时，绑定层（目标 `ToolBinding` 从 definition 派生）由 `tools.*()` 32 个手写 factory 或 `profileToolsFromKeys` 生成，与定义层无任何类型联系，key 靠人肉对齐。
- 创建任务时，运行层（目标由 definition `.runtime()` 生成）直接手写 `NeuroAgentTool` 并注册到 `AgentToolRegistry`（`server/agent/tools/tool-registry.ts`）。

### `defineAgentProfile.tools` 参数形状

- 类型：`AgentProfileDefinition.tools: TTools`，约束 `TTools extends ProfileTools`，即 `Record<string, ToolBinding>`（`server/agent/profiles/types.ts:181`、`profile-tools.ts:18`）。
- 校验：`assertProfileTools()`（`define-agent-profile.ts:96`）要求 `tools` 是非数组对象，每个 value 是 `ToolBinding`，且 `binding.key === 对象 key`；返回 `toolKeys = Object.keys(tools)` 作为稳定工具 key 列表。
- 消费：
  - `mainRunToolKeys` / `sidecar.toolKeys` 必须是 `keyof tools` 子集（`define-agent-profile.ts:124` / `:139`）。
  - `toolOverrides()`（`neuro-agent-harness.ts:4207`）按 binding 覆盖 provider-visible schema/description；`report_result` 走特判调 `createReportResultTool`。
  - 执行路径 `executeTool()`（`neuro-agent-harness.ts:2970`）用 `toolOverrides[name] ?? this.tools.get(name)` 解析，**只查全局 registry**。
- 创建任务时的调用形态：12 个 builtin profile 中 **10 个**仍用 `tools: profileToolsFromKeys(toolKeys)`（writer / retrieval / researcher / director / leader.default / leader.assets / rp.* / simulator.*），只有 `summarizer` 和 `memory.curator` 用显式 `defineProfileTools({...})`。

### 审批机制现状

- `approvalRequired` 仅 3 个内置工具用：`request_user_input`、`enter_plan_mode`、`exit_plan_mode`（`builtin-tools.ts:137/155/174`）。
- 审批不是“工具执行”：`executeToolSegment`（`neuro-agent-harness.ts:2665`）遇到 `approvalToolKeys()` 命中的工具**不调 execute**，直接 `return waiting`，run loop suspend，只落 assistant toolCall。
- 用户带 `resolution` 走 `continue` 恢复，`appendResolution`（`:2012`）+ `resolutionToToolResult`（`approval.ts:37`）把 resolution 转成 toolResult 落库后继续。
- `approvalToolKeys()`（`tool-registry.ts:47`）是无参全局方法，被 `findPendingApprovalCall` 一族广泛调用。
- `AgentResolution`（`types.ts:44`）只有 `tool_approval` 与 `user_input` 两种固定 shape；前端渲染硬编码在 `pendingApprovalDto`（`:1180`）+ 前端组件。

### Compiled artifact 可携带 execute（选项 1 已验证）

- `profile-artifact-compiler.ts:312` 用 esbuild `bundle: true` + `format: "esm"` 编译 profile 为 `.mjs`。
- `:372` 运行时 `await import()` 动态加载。
- `isProfile()`（`:394`）已依赖 `typeof prepare === "function"`，证明 compiled artifact 里函数本来就是活的。
- 结论：profile 内联的 `executeWithContext` 会被 bundle 进 `.mjs`，import 回来函数照常可调用，无序列化障碍。

## Decisions / Discussion

### 0. Profile author API 二次收敛

2026-06-16 继续收敛 profile 工具作者 API：旧 `tools.*()` 看起来像“创建工具”，但实际只是 profile-level tool reference，容易和真正的 `AgentToolDefinition` 混淆。新 API 硬切为：

```ts
import {builtin, defineProfileTool, pluginTool, toolset} from "nbook/server/agent/profiles/profile-tools";

tools: toolset(
    builtin.file.read,
    builtin.agent.create,
    builtin.result.main({dataSchema: OutputSchema}),
    builtin.result.sidecar(),
    pluginTool("some_plugin"),
    customProfileTool,
),

toolKeys: ["report_result"],
```

- `builtin` 是轻量内置工具引用层，不 import runtime 工具实现；真正执行仍由 registry / profile 私有 definition 解析。
- `toolset()` 按 `item.key` 生成 profile root tools 对象，并拒绝重复 key。
- `defineProfileTool()` 是 profile 作者侧的自带工具定义入口；底层 runtime 仍保留 `defineAgentTool()`。
- `pluginTool(key)` 只表示引用已注册插件工具。
- 顶层 `toolKeys` 表示主 run 执行工具子集；运行时派生的 root 最大集合改名为 `rootToolKeys`，避免同名冲突。sidecar 继续使用 `sidecar.toolKeys`。

### 1. 目标三层模型

```
AgentToolDefinition   ← 唯一定义入口(内置 + 自带共用 defineAgentTool)
  .runtime() → NeuroAgentTool   给全局 registry
  本身即 ToolBinding             给 profile tools(自带时携带 execute)

ToolBinding           ← profile 引用工具的产物
  { key, definition?, parameters?, validationSchema?, description? }
  definition 为空 → 从全局 registry 取
  definition 非空 → 自带工具,execute 跟 profile 走

NeuroAgentTool        ← runtime 最终执行对象
```

### 2. 三种工具来源统一进 `tools` 字段

```ts
profile.tools = {
    // A. 引用全局已注册工具 —— binding 只带 { key, schema override }
    read: tools.read(),
    create_agent: tools.createAgent(),
    report_result: tools.reportResult({ dataSchema: OutputSchema }),

    // B. profile 自带工具 —— binding 携带完整 definition(含 execute)
    roll_dice: defineAgentTool({
        key: "roll_dice",
        parameters: DiceSchema,
        description: "...",
        executionMode: "parallel",
        async executeWithContext(ctx, callId, params) { ... },
    }),

    // C. 引用运行时已注册的插件工具(未 typed 化)
    some_plugin: tools.registered("some_plugin"),
}
```

A / B / C 在 `tools` 对象里地位平等，区别只在 binding 内部：A 的 definition 为空回退全局；B 的 definition 自带；C 引用全局注册但无 typed factory 的工具。

### 3. “execute 不是安全边界”

profile 本身就是在 server 进程内运行任意代码（`context()` / `prepare()` 是函数）。“禁止 profile 提供 execute”挡不住任何真实威胁，只是组织约定，不是安全边界。允许自定义工具后明确放掉这个约定。真正的边界在进程沙箱 / workspace 路径 / approval，不在“谁写了 execute”。当前动态 profile 按用户可信本地代码处理（已有 TODO：第三方 profile 审查 skill）。

### 4. 自带工具 key 仅 profile 内唯一（已确认）

自带工具 key 仅在该 profile run 内可见，解析永远是“先 profile 私有再全局”，作用域隔离。自带工具**不能**被其他 profile 通过 `registered()` 跨引用。

### 5. 审批语义 A（已确认）

本次 `defineAgentTool` 支持 `approvalRequired: boolean`，**只表示 suspend 让用户确认**，approved 后落文本 toolResult，不回调 execute，与现有 3 个内置审批工具完全一致。自带审批工具复用现有 `tool_approval` resolution 与 suspend/continue 机制。

不在本次做（已记 `PROJECT-STATUS.md` TODO）：语义 B（approved 后真正执行 `executeWithContext`）、自定义 resolution shape、工具自带审批校验逻辑、动态审批 UI 渲染协议。

### 6. `registered()` 取代 `custom()`

`tools.custom("x")`（`profile-tools.ts:81`）从“危险逃生口”重定位为合法的第三种来源：引用运行时已注册但未 typed 化的插件工具。改名 `registered("key")`，与 `defineAgentTool` 互补。自带工具正路是 `defineAgentTool` 内联，不走 `registered`。

### 7. `report_result` 专用 binding

`dataSchema` 当前注释明写“仅 report_result 使用”却放在通用 `ToolBinding`（`profile-tools.ts:14`），是抽象边界未收口的信号。本次把 `report_result` 做成专用 definition + 专用 binding（`reportResultTool.bind({ dataSchema })`），从通用 `ToolBinding` 移除 `dataSchema`，并清理 `builtin-tools.ts:114` 的裸 `unknown` 占位注册。

## Proposed Types

```ts
type AgentToolDefinition = {
    key: string;
    parameters: TSchema;
    description: string;
    executionMode?: ToolExecutionMode;
    approvalRequired?: boolean;
    validationSchema?: TSchema;
    prepareArguments?(args: unknown): unknown;
    executeWithContext(ctx: ToolExecutionContext, callId: string, params: unknown, signal?, onUpdate?): ...;
    // 派生
    runtime(): NeuroAgentTool;     // 给全局 registry
};

type ToolBinding<TKey extends string = string> = {
    key: TKey;
    /** 为空时从全局 registry 取 definition；非空时为 profile 自带工具,execute 跟 profile 走。 */
    definition?: AgentToolDefinition;
    parameters?: TSchema;
    validationSchema?: TSchema;
    description?: string;
};

// report_result 专用 binding,dataSchema 不再进通用 ToolBinding
type ReportResultBinding = ToolBinding<"report_result"> & { dataSchema?: TSchema };
```

## Implementation Plan

### Phase 1 — 工具定义层抽象(不改行为)

- 新增 `defineAgentTool()` 与 `AgentToolDefinition`，包住现有 `NeuroAgentTool` 形状，支持 `approvalRequired`。
- 内置工具 `createReadTool` 等改写成 `defineAgentTool`，导出聚合 `agentTools.read` 等。
- `createBuiltinTools()` 改为从 definitions `.runtime()` 生成，行为不变。

### Phase 2 — `ToolBinding` 携带 definition

- `ToolBinding` 加可选 `definition` 字段；移除 `dataSchema`（下沉到 report_result 专用 binding）。
- `profile-tools.ts` 保持轻量 author API，不静态 import runtime 工具实现；内置工具的 schema / description / execute 仍以 `agentTools.*` definition 为运行时真相源。工具 key 绑定只生成 registry 引用，避免 profile artifact bundle 被 runtime 工具依赖污染。
- `tools.custom` 改名 `registered("key")`。
- 删除生产路径的 `profileToolsFromKeys`，测试需要的机械转换迁到 `server/agent/test/profile-tools.ts`。

### Phase 3 — Harness 解析加 profile 私有层

- `toolOverrides()`（`:4207`）与 `executeTool()`（`:2970`）的 `this.tools.get()` 改为“先查 profile binding 自带 definition，再回退全局”。
- `approvalToolKeys()` 合并全局 + profile 自带审批 key（per-run 集合或传 profile 参数）。
- `validateApprovalTool`（`:2931`）同步支持自带审批工具查找。

### Phase 4 — `report_result` 专用 definition

- `reportResultTool.bind({ dataSchema })` 专用 binding；从通用 `ToolBinding` 移除 `dataSchema`。
- 清理 `builtin-tools.ts:114` 裸 unknown 占位 `report_result`。

### Phase 5 — 迁移 builtin profiles

- 10 个仍用 `profileToolsFromKeys` 的 profile 改成显式 `defineProfileTools({...})`。
- 刷新 compiled artifacts、profile metadata、`reference/agent/profile-guide.md`、`reference/agent/sidecar-profile-pass.md`、`tsx-profile-editing` / `profile-system-guide` skill 与 profile docs。

### Phase 6 — 验证

- 自带工具能被模型看到并执行。
- 自带审批工具能 suspend + resume。
- 自带工具 key 隔离生效（跨 profile 不可见）。
- 现有内置工具行为不变；现有 approval / sidecar / report_result 链路不回归。

## Verification / Test

- `defineAgentTool` 产出的 `.runtime()` 与原手写 `NeuroAgentTool` 形状一致。
- profile 内联自带工具：provider-visible schema 包含该工具，执行命中 profile 私有 definition。
- 自带工具 key 与其他 profile 同名工具互不干扰。
- 自带审批工具：声明 `approvalRequired` 后命中 suspend，`continue + resolution` 可恢复。
- `report_result.dataSchema` 仍生成正确 provider-visible schema，且通用 `ToolBinding` 不再含 `dataSchema`。
- `registered("key")` 能引用全局插件工具；引用不存在 key 时返回 tool error。
- 系统 profile 重新编译通过：`profile compile --all --system`、`profile:metadata`。

## Implementation Walkthrough

- 2026-06-12：创建任务。确认三层模型现状、`defineAgentProfile.tools` 形状、审批机制现状与 compiled artifact 可携带 execute（选项 1 验证通过）。确认四项核心决策：自带工具内联进 `tools`、key 仅 profile 内唯一、审批语义 A、`registered()` 取代 `custom()`。审批系统一般化（语义 B 等）已记入 `PROJECT-STATUS.md` TODO。
- 2026-06-12：实现 `AgentToolDefinition` / `defineAgentTool()`：definition 现在持有 `key`、schema、description、execution mode、approval 标记、参数准备逻辑和执行入口；`.runtime()` 生成与现有 `NeuroAgentTool` shape 对齐的 runtime 工具，definition 本身可直接放进 profile 根 `tools` 作为 profile 自带工具。
- 2026-06-12：新增 `server/agent/tools/agent-tools.ts` 作为内置工具 definition 聚合层；文件、任务、Plot、变量、Web、Subject Memory、SQL 和 agent 协作工具由 definition `.runtime()` 汇总到 `createBuiltinTools()`，内置工具行为保持不变。`profile-tools.ts` 保持轻量 author API，不静态 import runtime 工具实现，避免 profile artifact bundle 运行时工具实现与外部依赖。随后该聚合层已整理为 `server/agent/tools/index.ts`。
- 2026-06-12：重构 profile binding：`ToolBinding` 支持可选私有 `definition`，`ReportResultToolBinding` 独占 `dataSchema`；`tools.custom()` 已改名为 `tools.registered(key)`，仅表示引用已注册全局工具。`profileToolsFromKeys()` 已从生产 `profile-tools.ts` 删除，测试机械转换迁到 `server/agent/test/profile-tools.ts`。
- 2026-06-12：重构 harness 工具解析：provider-visible tools 先读 profile root `tools`，执行时先查当前 profile 私有 definition，再回退全局 registry；`mainRunToolKeys`、sidecar `toolKeys` 和 runtime `toolKeysPatch` 仍只能裁剪 root tools，不能扩大权限。自带审批工具复用现有 suspend + resolution toolResult 语义，approved 后不回调 execute。
- 2026-06-12：迁移 builtin profiles：writer、retrieval、researcher、director、leader.default、leader.assets、rp.leader、rp.writer、simulator.leader、simulator.actor 与默认 fallback profile 均改为显式 `defineProfileTools({...})`。`simulator.actor` root tools 保留 sidecar 所需最大集合，主 run 继续通过 `mainRunToolKeys: ["report_result"]` 收窄执行权限。
- 2026-06-12：补测试覆盖：
  - `defineAgentTool().runtime()` 输出字段与执行行为。
  - profile 自带工具 provider-visible 且可执行。
  - profile 自带同名工具只覆盖当前 profile，不污染其他 profile。
  - `tools.registered("missing")` provider 不可见，执行时返回 tool error。
  - profile 自带审批工具可 suspend，并通过现有 `tool_approval` resolution 恢复。
  - sidecar / main run 工具权限边界、`report_result` 与 `create_agent.input` 既有回归不退化。
- 2026-06-12：刷新系统 profile artifacts 与 metadata：
  - `bun scripts/build/profile.ts compile --all --system` 成功写入 12 个 compiled artifacts。
  - `bun run profile:metadata` 成功，12 个 system profiles 均未 stale。
  - `bun scripts/build/profile.ts check builtin/simulator.actor.profile.tsx --system`、`builtin/leader.default.profile.tsx --system`、`builtin/writer.profile.tsx --system` 均通过。
- 2026-06-12：窄测试通过：
  - `bunx vitest run server/agent/tools/agent-tool-definition.test.ts server/agent/profiles/report-result-schema.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "defineAgentTool|profile 自带工具|registered 引用缺失|自带审批工具|sidecar 保持 profile 最大工具 schema|主 run 可见 profile 最大工具 schema|prepareTurn toolKeysPatch|report_result 校验失败|report_result 连续失败|report_sidecar|create_agent.input|create_agent 工具 schema|get_agent_profile|simulator.actor 会通过 context-load" --reporter=dot`
  - 结果：3 files passed，21 tests passed。
- 2026-06-12：`bunx tsc --noEmit --pretty false` 仍失败，但剩余错误来自既有无关文件：`app/components/novel-ide/agent/tiptap/agent-suggestion.test.ts`、`server/agent/harness/compaction.ts`、`server/agent/skills/silly-tavern-card-cli.test.ts`。本任务工具层相关类型错误已清空。
- 2026-06-12：完成 `profileToolsFromKeys` 生产 API 删除：`server/agent/profiles/profile-tools.ts` 不再导出数组式 helper，测试机械转换迁到 `server/agent/test/profile-tools.ts`；动态测试 profile 源码也改为引用 test helper，避免旧生产入口回流。补充验证：
  - `bunx vitest run server/agent/profiles/catalog.test.ts --reporter=dot`
  - `bunx vitest run server/agent/harness/neuro-agent-harness.black-box.test.ts --reporter=dot --testTimeout=30000`
- 2026-06-12：修复审查发现的两个 P2 回归并整理工具目录：
  - 明确删除 agent 协作工具的旧 direct `execute` 合同；`create_agent` / `invoke_agent` / `get_agent` / `get_agent_profile` / `get_session` / `detach_agent` 只通过 `executeWithContext` 在 agent session 内执行，direct `execute` 保持定义层上下文错误。
  - `createBuiltinTools()` 改为无参入口，Harness 不再传入死参数 `this`。
  - `server/agent/tools/builtin-tools.ts` 删除；控制工具迁入 `control-tools.ts`，agent 协作工具迁入 `agent-collaboration-tools.ts`，`index.ts` 只做聚合与 re-export。
  - 回退 `simulator.actor` 本轮误加的 `write` 权限，`actor.memory-save` 继续只使用 `subject_event_append` / `subject_memory_update` / `read` / `edit` / `report_result`。
- 2026-06-16：二次收敛 profile author API：
  - 生产 API 删除 `defineProfileTools` / `tools.*()`，改为 `toolset(builtin...)`、`pluginTool()` 和 `defineProfileTool()`。
  - 内置工具引用统一进入分组 `builtin`：`file`、`agent`、`control`、`task`、`plot`、`sql`、`variable`、`subject`、`web`、`result`。
  - profile 顶层 `mainRunToolKeys` 硬切为 `toolKeys`；运行时 root 最大集合 `profile.toolKeys` 改名为 `profile.rootToolKeys`。
  - Harness 保持 provider-visible tools/schema 来自 `rootToolKeys`，主 run 执行权限来自 `profile.toolKeys ?? rootToolKeys`，sidecar 执行权限来自 `sidecar.toolKeys ?? rootToolKeys`。
  - 12 个 system profiles、fallback `defaultAgentProfile` 和 `summarizerProfile` 已迁移到新 API，并重新编译 system `.compiled` artifacts。
  - 验证通过：`bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/report-result-schema.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts --reporter=dot`；`bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "profile 自带工具|registered 引用缺失|自带审批工具|sidecar 保持 profile 最大工具 schema|主 run 可见 profile 最大工具 schema|主 run 执行权限|prepareTurn toolKeysPatch|report_sidecar_result|report_result 连续失败|simulator.actor" --reporter=dot`。

## TODO / Follow-ups

- 审批系统一般化（语义 B：approved 后执行 execute；自定义 resolution shape / 审批 UI 协议）见 `PROJECT-STATUS.md` TODO。
- 评估 Workbench 对自带工具（含内联 execute）的展示与编辑策略。
- 评估插件工具注册入口（`registered()` 的来源）何时落地。
