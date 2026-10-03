# Agent Profile Tool Bindings

## Relative documents refs

- [Agent Sidecar Profile Pass](../23-agent-sidecar-profile-pass/README.md)
- [Agent Runtime Pipeline Hooks](../18-agent-runtime-pipeline-hooks/README.md)
- [Subject RAG Memory](../43-subject-rag-memory/README.md)
- [Simulator Leader Invoke Policy](../39-simulator-leader-invoke-policy/README.md)
- [Profile Guide](../../../reference/agent/profile-guide.md)
- [Sidecar Profile Pass Reference](../../../reference/agent/sidecar-profile-pass.md)

## User Request / Topic

- 重新设计 profile 工具声明方式，解决旁路结果工具与 `create_agent.input` 这类参数 schema 对模型可见度不足的问题。
- 当前 `allowedToolKeys: string[]` 只能表达“允许哪些工具”，不能表达“当前 profile 下这个工具应暴露什么参数 schema”。
- 讨论方向：把工具改成工厂方法，并让 profile 直接声明工具绑定，例如 `tools.report_result({ schema })`。
- 最新约束：
  - sidecar 里的工具只能来自 profile 根工具集合。
  - sidecar 不能重新创建工具、修改工具 schema、覆盖工具描述或扩大工具权限。
  - profile 的 `tools` 改成对象可能比数组更合适。

## Goal

设计 profile-level tool binding 合同，使 profile 能声明模型可见工具 schema、执行校验 schema 和工具权限边界，验证面至少覆盖：

- `report_result.data` 只负责主路结构化结果；新增 `report_sidecar_result.data` 专门负责 sidecar 旁路结构化结果。
- `report_sidecar_result.data` 不再是裸 `unknown`，模型能看到当前 profile 允许的 sidecar-name keyed profile-stable union 结构。
- `report_sidecar_result.data` 校验失败发生在 tool execution 阶段，返回模型可见 error toolResult，并复用现有 continuation 机制让 LLM 自我修正。
- `create_agent.input` 保持任意 JSON object；目标 profile 的具体 InputSchema 通过先调用 `get_agent_profile` 获取。JSON string 不再静默 normalize，而是返回 tool error 让模型修正。
- sidecar 只能通过 key 引用 profile 根 `tools` 对象里的工具，不能修改工具绑定。

## Current State At Task Start

- `AgentProfile.allowedToolKeys` 是字符串数组，同时承担：
  - provider-visible tools 上限。
  - profile 最大执行权限。
  - sidecar / main run 子集校验来源。
- `mainRunAllowedToolKeys` 是字符串数组，用于收窄主 run 实际执行权限。
- `SidecarProfilePass.allowedToolKeys` 是字符串数组，必须是 profile `allowedToolKeys` 子集。
- `report_result` 的 provider-visible schema 当前由 `reportResultSchemaForProfile(profile)` 派生：
  - `result: string`
  - `data?: profile.outputSchema`
  - `sidecar_data?: unknown`
- `sidecarDataSchema` 当前只在 `readSidecarResult()` / `normalizeSidecarData()` 中做 Harness runtime 校验；校验失败已离开 ReAct tool loop，因此不会变成模型可见 error toolResult。
- `create_agent.input` 当前是 `Record<string, unknown>`，只能提醒模型传 object，不能按目标 profile 动态表达具体 `InputSchema`。
- 23 号任务曾明确“provider-visible tools 保持 profile 最大集合，避免破坏工具/schema 缓存”。本任务的新方向不是让 sidecar 动态修改工具，而是在 profile 根工具绑定中生成稳定 schema。

## Decisions / Discussion

### 1. ToolDefinition 与 ToolBinding 分层

保留全局 `ToolDefinition`：

```ts
type ToolDefinition = {
    key: string;
    name: string;
    execute: ...;
    defaultParameters: TSchema;
};
```

新增 profile-level `ToolBinding`：

```ts
type ToolBinding = {
    key: string;
    parameters: TSchema;
    validationSchema?: TSchema;
    description?: string;
};
```

含义：

- `ToolDefinition` 是全局能力，负责执行。
- `ToolBinding` 是某个 profile 对该工具的绑定方式，负责模型可见 schema 和当前 profile 下的校验策略。
- profile author 不能直接提供任意 `execute()`，只能通过受控 `tools.*()` factory 创建 binding。

### 2. Profile `tools` 使用对象

推荐 API：

```ts
const profileTools = defineProfileTools({
    subject_rag_search: tools.subjectRagSearch(),
    subject_event_append: tools.subjectEventAppend(),
    subject_memory_update: tools.subjectMemoryUpdate(),
    read: tools.read(),
    edit: tools.edit(),
    report_result: tools.reportResult({
        dataSchema: OutputSchema,
    }),
});

export default defineAgentProfile({
    manifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    tools: profileTools,
    mainRunToolKeys: ["report_result"],
    sidecars: [
        actorContextLoadPass,
        actorMemorySavePass,
    ],
    context(ctx) {
        // ...
    },
});
```

对象优于数组：

- key 是一等语义，天然适配权限子集校验。
- 不存在重复 key 的歧义。
- `mainRunToolKeys` / `sidecar.toolKeys` 可以推导为 `keyof typeof tools`。
- Workbench 更容易展示和局部编辑。
- 工具顺序不是核心语义，集合 map 更贴近真实模型。

### 3. Sidecar 只能引用根工具 key

Sidecar API 推荐从：

```ts
allowedToolKeys: ["subject_rag_search", "report_sidecar_result"]
```

迁移为：

```ts
toolKeys: ["subject_rag_search", "report_sidecar_result"]
```

规则：

- `sidecar.toolKeys` 必须是 profile 根 `tools` 对象 key 子集。
- sidecar 不能写 `tools.reportResult(...)`。
- sidecar 不能覆盖工具 schema、description、execution mode 或执行函数。
- sidecar 的 `sidecarDataSchema` 是旁路结果合同，不是工具绑定修改。

### 4. `report_result` 与 `report_sidecar_result` 的 schema 来源

根 `tools.reportResult()` 绑定只声明主路结果工具；根 `tools.reportSidecarResult()` 绑定声明旁路结果工具。二者都属于 profile root `tools` 最大集合，provider-visible schema 对整个 profile 稳定，不随 active sidecar 动态变化。

`report_result` 的 provider-visible schema 来自：

- profile `outputSchema` 或 `tools.reportResult({ dataSchema })`

```ts
type ReportResultArgs = {
    result: string;
    data?: OutputSchema;
};
```

`report_sidecar_result` 的 provider-visible schema 来自：

- 所有 sidecar 的 `sidecarDataSchema`
- 或显式 `tools.reportSidecarResult({ dataSchema })`

生成 sidecar-name keyed 的 profile-stable provider-visible union schema：

```ts
type ReportSidecarResultArgs = {
    result: string;
    data:
        | {"actor.context-load": ActorContextLoadSidecarData}
        | {"actor.memory-save": ActorMemorySaveSidecarData};
};
```

运行时按 phase 精确校验：

- main run：允许 / 校验 `report_result.data`；不能调用 `report_sidecar_result`。
- sidecar run：必须通过 `report_sidecar_result.data[activeSidecar.name]` 返回旁路 payload；不能调用 `report_result`。
- `actor.context-load`：要求 `report_sidecar_result.data` 只包含 `"actor.context-load"` key，payload 符合 `ActorContextLoadSidecarSchema`。
- `actor.memory-save`：要求 `report_sidecar_result.data` 只包含 `"actor.memory-save"` key，payload 符合 `ActorMemorySaveSidecarSchema`。

关键点：

- provider-visible schema 对整个 profile 稳定，不随进入某个 sidecar 动态变化。
- sidecar 没有修改工具；它只是贡献结果合同，由 profile 编译期汇总进 root `report_sidecar_result` binding。
- 严格 sidecar 校验下沉到 `report_sidecar_result` tool execution 中。失败时工具返回 error toolResult，让同一个 run loop 继续，LLM 可以纠错。

### 5. `create_agent` 的 binding

`create_agent` 的正确使用流程是：先调用 `get_agent_profile` 获取目标 profile 的 InputSchema，再根据返回的 schema 构造 `input`。模型在调用 `create_agent` 前已经通过 `get_agent_profile` 获得了具体 schema，因此 `create_agent.input` 不需要、也不应该在 provider-visible schema 层做 profile-aware discriminated union。

`tools.createAgent()` 的职责简化为：

- `input` 保持 `Record<string, unknown>`（任意 JSON object），不按目标 profile 生成 union。
- 移除 `prepareCreateAgentArguments()` 对 JSON string 的静默 normalize；`input` 是 JSON string 时返回 tool error，进入下一轮让模型纠正。
- `input` 类型错误（非 object）同样返回 tool error 而非 throw。

原有 `targets` 方向（决策后放弃）：profile 编译期 import 目标 InputSchema 成本高，且与"先 get_agent_profile 再 create_agent"的工作流冲突，不采用。

## Proposed Types

```ts
type ProfileTools = Record<string, ToolBinding>;

type AgentProfile = {
    manifest: AgentProfileManifest;
    inputSchema: TSchema;
    outputSchema?: TSchema;

    tools: ProfileTools;

    /** 主 run 实际可执行工具；不声明时等于 Object.keys(tools)。 */
    mainRunToolKeys?: readonly (keyof ProfileTools)[];

    sidecars?: readonly SidecarProfilePass[];
};
```

```ts
type SidecarProfilePass<TInput, TSidecarData> = {
    name: string;
    stage: "prepareRun" | "settleRun";
    enterPrompt: string | ((ctx: SidecarContext<TInput>) => string);

    /** 只能引用 profile.tools 里的 key。 */
    toolKeys?: readonly string[];

    /** 旁路结果合同，不是工具绑定覆盖。 */
    sidecarDataSchema?: TSchema;

    outputFallback?: "final_message_as_result" | "parse_final_message_json";
    merge(ctx: SidecarContext<TInput>, result: SidecarResult<TSidecarData>): SidecarMergePlan | Promise<SidecarMergePlan>;
};
```

## Implementation Plan

### Phase 1: Type and Validation Layer

- 新增 `ToolBinding` / `ProfileTools` 类型。
- 新增 `tools.*()` factory 集合。
- `defineAgentProfile()` 校验：
  - `tools` key 与 binding key 一致。
  - `mainRunToolKeys` 全部存在于 `tools`。
  - `sidecar.toolKeys` 全部存在于 `tools`。
  - sidecar 不允许声明工具 binding。
- 硬切删除 `allowedToolKeys` / `mainRunAllowedToolKeys`，不保留生产兼容读取。

### Phase 2: Harness Tool Resolution

- 把 `toolOverrides(toolKeys, profileKey)` 改成读取 profile `tools` binding。
- provider-visible tools 从 profile root `tools` 生成。
- execution tool keys 仍由 main run / sidecar stage 的 key 子集控制。
- 违规工具调用仍返回 tool error 并允许 loop 修正。

### Phase 3: Result Tool Bindings

- `tools.reportResult({ dataSchema })` 生成基础 binding。
- `tools.reportSidecarResult({ dataSchema })` 生成旁路结果 binding。
- profile 编译 / normalize 阶段收集 sidecars 的 `sidecarDataSchema`，构造 sidecar-name keyed stable union schema 给 `report_sidecar_result.data`。
- `report_result` execute 阶段只校验 main run `data`；sidecar 调用会返回准确工具错误。
- `report_sidecar_result` execute 阶段只校验 sidecar run `data`；主 run 调用会返回准确工具错误。
- 移除 sidecar 完成后才校验旁路结果的主路径；`readSidecarResult()` 只读取已校验的 `sidecarResult`。
- **同时移除 `sidecarDataCandidates()` 中 schema=object 时的 JSON string 恢复路径**（neuro-agent-harness.ts:4175）：不再静默 `JSON.parse(value)`，schema 期望 object 而收到 string 直接 reject，返回 error toolResult。

### Phase 4: `create_agent` Binding

- `tools.createAgent()` 无需声明 targets，`input` 保持任意 JSON object。
- 移除 `prepareCreateAgentArguments()` 对 JSON string 的静默 normalize。
- `input` 是 JSON string 或非 object 时返回 tool error，进入下一轮自动纠错。

### Phase 5: Profile Migration

优先迁移：

- `simulator.actor`
- `retrieval`
- `summarizer`
- `memory.curator`
- `leader.default`
- `director`

需要同步：

- system profile source
- compiled artifacts
- profile metadata
- Workbench profile detail / preview 中的 tool schema 展示
- `reference/agent/profile-guide.md`
- `reference/agent/sidecar-profile-pass.md`

## Verification / Test

最小测试面：

- `report_sidecar_result.data` object schema 在 provider-visible schema 中不是 `unknown`。
- `report_sidecar_result.data` 是按 sidecar name keyed 的 profile-stable union，每个 branch 只允许自己的 sidecar key。
- sidecar 传错 `report_sidecar_result.data` 类型时，生成 error toolResult，并继续下一轮让模型修正。
- `report_result` 连续 3 次工具错误后返回 Runtime Error，错误文本保留最后一次真实 tool error。
- `report_sidecar_result` 连续 3 次工具错误后返回 Runtime Error，错误文本保留最后一次真实 tool error。
- sidecar 允许 `report_sidecar_result` 时复用现有缺失 report reminder；不允许 `report_sidecar_result` 且声明 fallback 时不注入 reminder。
- `actor.memory-save` 的 `report_sidecar_result.data` 字符串化错误不再在 settleRun 阶段爆炸，而是在 tool execution 阶段可纠错。
- `create_agent({ profileKey: "simulator.actor" })` 的 provider-visible schema 中 `input` 是任意 JSON object（`Record<string, unknown>`），不做 discriminated union；具体字段由模型先调 `get_agent_profile` 获得。
- `create_agent.input` 是 JSON string 时，不被静默 normalize；工具报错后 loop 可继续纠正。
- `sidecar.toolKeys` 引用不存在 key 时 profile 加载失败。
- `sidecar.toolKeys` 不能扩大 root `tools` 权限。
- `mainRunToolKeys` 只能引用 root `tools`。
- `simulator.actor` 主 run 仍只能执行 `report_result`，context-load / memory-save sidecar 仍只能执行各自子集。

## Implementation Walkthrough

- 2026-06-12：创建任务。已确认设计方向从 `allowedToolKeys: string[]` 转向 profile root `tools` 对象；sidecar 只引用 root tools 的 key，不允许修改工具绑定。`report_result.sidecar_data` 与 `create_agent.input` 是首批需要 schema binding 化的工具。
- 2026-06-12：三条实现决策已确认：
  1. `allowedToolKeys` 硬切删除，不保留兼容层，所有 builtin profile 一次性迁移。
  2. `create_agent` 不做 profile-aware targets，`input` 保持任意 JSON object；静默 normalize 改为 tool error。理由：正确工作流是先 `get_agent_profile` 拿 schema，`create_agent` 不需要重复表达。
  3. `report_result.sidecar_data` 校验下沉到 tool execution 阶段，失败返回 error toolResult 允许 LLM 自我纠错（接受 sidecar run 可能因此更长的 tradeoff）。
- 2026-06-12：补充 `sidecar_data` 字符串化问题的根因分析：`sidecarDataCandidates()` 的静默恢复路径是问题所在，Phase 3 必须同时移除。`Record<string, unknown>` 这类宽类型 schema 无法有效约束 LLM 输出格式，真正的保障来自 strict validation + tool error 反馈循环，而不是 schema 类型本身。`create_agent.input` 同理，enforcement 靠 no-normalize + error loop，不靠 schema union。
- 2026-06-12：实现 profile root `tools` binding：新增 `server/agent/profiles/profile-tools.ts`，`defineAgentProfile()` 校验 root tools、`mainRunToolKeys` 和 sidecar `toolKeys` 子集关系；生产代码遇到旧 `allowedToolKeys` / `mainRunAllowedToolKeys` 会直接报错。
- 2026-06-12：实现 Harness tool resolution：provider-visible tools 从 profile root `tools` 生成，执行权限由 main run / sidecar key 子集控制；`get_agent_profile` / catalog / DTO / Workbench detail 统一返回 `toolKeys`。
- 2026-06-12：实现 `report_result` binding：provider-visible schema 汇总 profile output data schema 与全部 sidecar `sidecarDataSchema`；active sidecar 运行时通过 `report_result.sidecar_data` 返回结果，错误在 tool execution 阶段生成模型可见 error toolResult。为避免 `validateToolArguments` 递归 coercion，`report_result` 执行前使用宽 `validationSchema`，再用 strict `Value.Check()` 校验 `data` / `sidecar_data`。
- 2026-06-12：实现 `create_agent` no-normalize：删除 JSON string 自动解析；`input` 不是 JSON object 时返回 tool error，模型可在下一轮按 `get_agent_profile` 结果自我修正。
- 2026-06-12：迁移 builtin profiles、profile templates、fallback profiles、profile detail DTO、catalog/workbench 和相关测试到 `tools` / `toolKeys`；同步 `reference/agent/profile-guide.md`、`reference/agent/sidecar-profile-pass.md`、profile docs 和 profile author skills。
- 2026-06-12：修复 runtime hook 权限边界：`prepareTurn.turnSnapshotPatch.toolKeys` 只能裁剪当前 profile root `tools`，不能扩大到 root tools 之外。root 外 patch 视为 runtime/profile 配置错误，父 invocation 直接失败；已补 `prepareTurn toolKeysPatch 不能扩大 profile root tools` 回归测试。
- 2026-06-12：刷新系统 profile artifacts：`bun scripts/build/profile.ts compile --all --system` 成功写入 12 个 `.compiled` artifact，`bun run profile:metadata` 成功，`simulator.actor` / `leader.default` profile check 通过。
- 2026-06-12：验证通过：
  - `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/report-result-schema.test.ts server/agent/profiles/catalog.test.ts server/agent/profiles/workbench-service.test.ts --reporter=dot`
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "sidecar_data|create_agent.input|get_agent_profile 返回|主 run 可见 profile 最大工具 schema|主 run 执行权限" --reporter=dot`
  - `bunx vitest run server/agent/profiles/rp-profiles.test.ts server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts --reporter=dot`
  - `bunx vitest run server/agent/profiles/profile-dsl.test.ts --reporter=dot`
  - `bunx vitest run server/agent/tools/subject-memory-tools.test.ts --reporter=dot`
  - `bunx vitest run server/agent/tools/file-tools.test.ts --reporter=dot`（单文件耗时约 176s）
- 2026-06-12：针对 `toolKeysPatch` root tools 边界修复，验证通过：
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "profile runtime hook 可以写 session|prepareTurn toolKeysPatch 不能扩大|主 run 执行权限同时" --reporter=dot`
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "sidecar 保持 profile 最大工具 schema 可见|主 run 可见 profile 最大工具 schema|主 run 执行权限同时|prepareTurn toolKeysPatch 不能扩大" --reporter=dot`
- 2026-06-12：对齐 `report_result` 错误收口机制：Run Kernel 记录共享 `reportResultErrorCount` / `lastReportResultError`，连续 3 次 `report_result` tool error 后返回 Runtime Error；sidecar 按实际可执行工具复用现有缺失 report reminder，不再关闭 reminder。验证通过：
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "report_result 连续失败|sidecar report_result 连续失败|sidecar 缺少 report_result|report_result 校验失败后会继续|object sidecar_data 被模型包成字符串" --reporter=dot`
  - `bunx vitest run server/agent/harness/run-frame-state.test.ts server/agent/harness/turn-transaction.test.ts server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts --reporter=dot`
- 2026-06-12：`bunx tsc --noEmit --pretty false` 仍失败，但剩余错误来自既有无关文件：`app/components/novel-ide/agent/tiptap/agent-suggestion.test.ts`、`server/agent/harness/compaction.ts`、`server/agent/skills/silly-tavern-card-cli.test.ts`、`server/agent/tools/subject-memory-tools.ts`。本任务新增的 `builtin-tools.ts` 类型错误已修复。
- 2026-06-14：根据 simulator actor sidecar 报错复盘，结果工具拆成主路 `report_result` 与旁路 `report_sidecar_result`。主路不再接受 `sidecar_data`；sidecar 不允许调用 `report_result`，必须用 `report_sidecar_result.data`。provider-visible tool 集合和 schema 仍来自 profile root `tools` 最大集合，`report_sidecar_result.data` 使用当前 profile 全部 `sidecarDataSchema` 的稳定 union，执行期再按 active sidecar strict 校验，避免按旁路阶段动态改 schema 破坏 provider/tool cache。同时修复缺少结果工具 reminder 写入后下一轮 transcript 仍接在旧 assistant 后的问题，让 reminder 保持在 active path。验证通过：
  - `bunx vitest run server/agent/profiles/report-result-schema.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/profiles/define-agent-runtime.test.ts --reporter=dot`
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "sidecar|report_sidecar|report_result 连续失败|主 run 可见 profile 最大工具 schema|执行权限|get_agent_profile 返回" --reporter=dot`
- 2026-06-14：审查后修复 runtime `prepareTurn.turnSnapshotPatch.toolKeys` 仍会裁剪 provider-visible tools 的问题。现在 provider-visible tools/schema 始终使用 profile root `tools` 最大集合，`toolKeysPatch` 只和 `mainRunToolKeys` / sidecar `toolKeys` 取交集来收窄执行权限；root 外 patch 仍按 profile/runtime 配置错误失败。补充 `final_message_as_result` 只能搭配 string `sidecarDataSchema` 的定义期测试，结构化 fallback 需使用 `parse_final_message_json` 或 `report_sidecar_result`。验证通过：
  - `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "final_message_as_result|parse_final_message_json|prepareTurn toolKeysPatch|主 run 执行权限同时受" --reporter=dot`
  - `bunx vitest run server/agent/profiles/report-result-schema.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "reportSidecarResultSchemaForProfile|reportResultSchemaForProfile|拒绝 sidecar|sidecar 未开放|simulator.actor|outputFallback sidecar 的 reminder|sidecar 缺少 report_sidecar_result|report_sidecar_result.data 不符合 schema|sidecar report_sidecar_result 连续失败|sidecar 保持 profile 最大工具 schema|主 run 执行权限同时受|final_message_as_result|parse_final_message_json" --reporter=dot`
  - `bunx tsc --noEmit --pretty false` 仍失败；剩余错误来自既有无关文件 `app/components/novel-ide/agent/tiptap/agent-suggestion.test.ts`、`server/agent/harness/compaction.ts`、`server/agent/skills/silly-tavern-card-cli.test.ts`。
- 2026-06-14：继续顺着 simulator actor sidecar bug 链路复盘，修复三个缓存稳定版残留问题：缺失结果 reminder 现在按当前 turn `executionToolKeys` 判断结果工具是否可执行，不再只看 provider-visible root tools；sidecar 错用 `report_result` 连续失败 3 次时，Runtime Error 摘要按当前期望工具 `report_sidecar_result` 收口，同时保留最后一次真实工具错误；`final_message_as_result` 定义期校验收紧为只接受明确 string `sidecarDataSchema`，union / object 等复杂 schema 必须改用 `parse_final_message_json` 或 `report_sidecar_result`。系统 skill 参考也已清理为 `report_sidecar_result.data` 协议。验证通过：
  - `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "缺失结果 reminder 只在当前执行权限允许结果工具时注入|sidecar 错用 report_result 连续失败时按期望结果工具名收口|final_message_as_result 拒绝 union" --reporter=dot`
  - `bunx vitest run server/agent/profiles/report-result-schema.test.ts server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "reportSidecarResultSchemaForProfile|reportResultSchemaForProfile|拒绝 sidecar|sidecar 未开放|simulator.actor|outputFallback sidecar 的 reminder|sidecar 缺少 report_sidecar_result|report_sidecar_result.data 不符合 schema|sidecar report_sidecar_result 连续失败|sidecar 保持 profile 最大工具 schema|主 run 执行权限同时受|final_message_as_result|parse_final_message_json|缺失结果 reminder|sidecar 错用 report_result" --reporter=dot`
- 2026-06-15：结果工具协议再收敛为 keyed sidecar data：`report_sidecar_result.data` 必须是 `{ "<sidecar-name>": payload }`，provider-visible schema 仍是 profile-stable union，但每个 branch 只允许自己的 sidecar key；执行期按 active sidecar 解包 `data[activeSidecar.name]` 后再用对应 `sidecarDataSchema` 校验。`simulator.actor` 两个 sidecar 的 payload schema 都改为空对象，业务正文/摘要写入 `report_sidecar_result.result`；`actor.context-load.merge()` 从 `result` 注入 `<actor-sidecar-context>`，`actor.memory-save.merge()` 不再写 `runtimeState`。验证通过：
  - `bunx vitest run server/agent/profiles/report-result-schema.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/profiles/define-agent-runtime.test.ts --reporter=dot`
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "report_sidecar_result|sidecar|缺失结果 reminder|连续失败" --reporter=dot`

## TODO / Follow-ups

- 评估 provider tool schema union 对不同模型的缓存影响；目标是 profile-stable，而不是 sidecar-stage-dynamic。
- 设计 Workbench 对 `tools` 对象的源码局部编辑策略，替代旧 `allowedToolKeys` checklist。
