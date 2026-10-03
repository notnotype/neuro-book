# Agent Initial/Payload Schema

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [Agent Runtime Pipeline Hooks](../18-agent-runtime-pipeline-hooks/README.md)
- [Harness Black-Box Contract](../18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)
- [Agent Profile Tool Bindings](../47-agent-profile-tool-bindings/README.md)
- [Agent Tool Definition Layer](../48-agent-tool-definition-layer/README.md)
- [Leader Default Operational Protocol](../../../reference/agent/leader-default.md)
- [Agent Profile Guide](../../../reference/agent/profile-guide.md)
- [Agent Tools](../../agent/tools.md)

## User Request / Topic

- `create_agent` 当前能传 profile `InputSchema`，用于初始化 agent；`invoke_agent` 当前主要只能传一条 string message，无法携带结构化引用，例如 Plot id。
- 扩展 HTTP/API invoke 和 agent tool invoke，让每轮 invocation 支持结构化 payload，并尽量复用同一条 API invoke 语义。
- profile DSL 硬切命名：`inputSchema` 改为 `initialSchema`，表示创建期初始化数据；新增 `payloadSchema`，表示每轮 invocation 的结构化载荷。
- agent tool invoke 的能力应是 HTTP/API invoke 的子集：支持 `prompt` / `continue` / `steer` / `followup`、`message?: string`、`input?: Record<string, JsonValue>`、`title?`；不暴露前端专用 `clientState`、`resolution`、`caller`。
- `get_agent_profile` 参数保持 `{ profileKey }`，因为 system reminder 会实时提醒 linked agent 的 sessionId 和 profileKey；返回中不再暴露 `source`、`reportResultSchema`、`reportSidecarResultSchema`。
- `invoke_agent` 返回格式统一为 `result`，隐藏 `invocationId` 和原始 `usage`；没有 `report_result` 时，最后一条 assistant 文本也归入 `result.message`。

## Goal

硬切 Agent profile 输入合同，完成 `InitialSchema` / `PayloadSchema` 两层模型，并扩展 HTTP/API invoke 与 agent collaboration tools，使结构化 invocation payload 成为一等能力，验证时保持 Harness 黑盒合同中的 mode/admission/queue 语义不回归。

成功标准：

- profile DSL、runtime context、catalog、builtin profiles、compiled artifacts 和文档中不再使用 `inputSchema` 作为创建期 schema 名称，改为 `initialSchema` / `InitialSchema`。
- profile 可声明可选 `payloadSchema` / `PayloadSchema`，HTTP/API invoke 和 `invoke_agent.input` 会按目标 profile 的 `PayloadSchema` 校验。
- 没有 `PayloadSchema` 的 profile 收到 invocation payload 时明确报错，不静默 stringify 或忽略。
- `prompt` / `steer` / `followup` 允许只有 `message` 或只有 payload；`continue` 不接受 `message` / payload，继续遵守黑盒合同。
- queued `steer` / `followup` 在被 drain 并成为模型可见输入前，不写入 durable session history。
- `get_agent_profile` 返回 `initialSchema`、`payloadSchema`、`outputSchema`、`toolKeys` 等 agent 需要的信息，不返回 report schema 或 profile file source。
- `invoke_agent` 返回 agent-facing 结果：
  - `result.message` 来自 `report_result.result` 或 strip thinking 后的最后 assistant 文本。
  - `result.data` 来自 `report_result.data`。
  - 隐藏 `invocationId`。
  - 原始 `usage` 转为简洁 `stats`，只保留 input/output/total token 和耗时。
- Workbench、profile docs、leader 协作说明和相关 tests 同步更新。

## Initial State

- profile DSL 当前使用 `inputSchema`，builtin profiles 常导出 `InputSchema`，`ctx.input` 表示创建期初始化数据。
- `ProfilePrepareContext.invocation.input` 当前只是从 pending user message 派生的 `{message}`，不是 profile-aware payload。
- `create_agent.input` 当前要求真实 JSON object，并由 `AgentProfileCatalog.parseInput()` 按目标 profile `inputSchema` 校验。
- HTTP invoke DTO 当前包含 `mode`、`message`、`resolution`、`clientState`、`caller: never`、`block`，没有 `title`，也没有结构化 payload。
- harness `InvokeAgentInput` 当前包含 `message?: AgentUserMessageInput`、`title?`、`resolution?`、`clientState?`、`caller?`、`block?`、`onEvent?`、`internalQueued?`。
- `internalQueued` 是 harness 内部字段，用于消费已入队 follow-up 时跳过普通 admission 的重复入队逻辑，不是公开 API/tool 合同。
- `invoke_agent` 工具当前 schema 只有 `sessionId`、`message?: string`、`title?`、`mode?: prompt | continue`；不支持 `steer` / `followup`，也不支持 payload。
- `get_agent_profile` 工具当前只接受 `{ profileKey }`，返回 `source`、`inputSchema`、`outputSchema`、`reportResultSchema`、`reportSidecarResultSchema`、`toolKeys`。其中 `source` 实际是 profile 文件来源 `memory | system | user`，不是 caller/source。
- `invoke_agent` 工具当前直接返回 `JSON.stringify(InvokeAgentResult)`，会暴露 `invocationId`、完整 usage、`finalMessage` 和 `reportResult` 二分结构。
- Harness 黑盒合同已定义 `prompt` / `continue` / `steer` / `followup` 在 `Idle`、`Running`、`WaitingUser`、`Aborting` 下的 admission、queue、session writes 和 SSE 语义。

## Implemented State

- profile DSL、catalog、harness、HTTP DTO、Workbench DTO、builtin profiles 和 active reference 已硬切到 `initialSchema` / `InitialSchema`；runtime/profile context 使用 `ctx.initial`。
- profile 可声明 `payloadSchema` / `PayloadSchema`；HTTP/API invoke 的 `input` 和 agent tool `invoke_agent.input` 会映射为 harness `payload` 并按目标 profile 校验。未声明 `PayloadSchema` 的 profile 收到 payload 会报错。
- HTTP/API invoke 已增加 `title` 与 per-invoke `input` payload；API 不接收 caller。
- `invoke_agent` 工具已支持 `prompt | continue | steer | followup`、`message?: string`、`input?: Record<string, JsonValue>`、`title?`，并保持为 HTTP/API invoke 的 agent-facing 子集。
- `get_agent_profile` 保持 `{ profileKey }` 参数，只返回 agent 需要的 `initialSchema`、`payloadSchema`、`outputSchema` 和 `toolKeys` 摘要，不暴露 `source` / report schema。
- `invoke_agent` 返回已收敛为 `result.message/data` 与简洁 `stats`；`finalMessage`、`invocationId`、原始 `usage`、`reportResult` 二分结构不再作为 agent-facing 字段暴露。
- Initial/Payload 与 `report_result.data` / `report_sidecar_result.data` 共用严格 TypeBox 校验和错误格式化：不执行 Convert/default 填充，错误包含 JSON Pointer，并明确缺少必填字段、额外字段及具体类型/枚举/范围错误，不再暴露 TypeBox 的通用 `Parse`。
- Profile 支持通用 `capabilities.creation = public | system_only`；默认 `public`。`create_agent` 与公开 session API 拒绝 `system_only`，内部系统创建入口保留。`get_agent_profile` 返回 `creationMode/createAgentAllowed`，AgentCatalog 只把 public profile 宣称为可创建。

### 2026-07-19 validation error and creation capability contract

- `initial`、invocation payload、主路 result data 和 sidecar data 只能按声明 schema 严格通过；校验失败不修改输入。
- 错误格式为“合同位置校验失败：`/json/pointer`：原因”，多个问题用分号分隔，调用方可直接定位字段。
- `system_only` 是 profile 能力而非 profile key 特判；系统 profile 仍可进入管理/诊断 catalog，但不会进入 Agent prompt 的可创建列表。

## Decisions / Discussion

### 1. Schema 命名

硬切命名：

```ts
export const InitialSchema = Type.Object({...});
export const PayloadSchema = Type.Object({...});

export default defineAgentProfile({
    manifest,
    initialSchema: InitialSchema,
    payloadSchema: PayloadSchema,
    outputSchema: OutputSchema,
});
```

含义：

- `InitialSchema`：创建 session 时的初始化数据，生命周期等于 session。
- `PayloadSchema`：单次 invocation 的结构化载荷，生命周期等于本次 run / queued item。
- `message` 不进入 `PayloadSchema`；它与 payload 并列，承载自然语言意图。

### 2. Context 命名

推荐硬切 runtime/profile context：

```ts
ctx.initial
ctx.invocation?.payload
ctx.invocation?.message
```

旧名：

- `ctx.input` 删除。
- `ctx.invocation.input` 不再表示 `{message}`，改为 `ctx.invocation.payload`。

### 3. HTTP/API Invoke

HTTP invoke 扩展为：

```ts
{
    mode: "prompt" | "continue" | "steer" | "followup";
    message?: {text: string; images?: ImageContent[]};
    input?: JsonValue;
    title?: string;
    resolution?: AgentResolution;
    clientState?: ClientStateSnapshot;
    block?: boolean;
}
```

约束：

- 不暴露 `caller`。
- `caller` 如仍被 runtime 内部需要，由服务端/harness 自动构造。
- `input` 是每轮 payload，会按目标 profile `PayloadSchema` 校验。

### 4. Agent Tool Invoke

`invoke_agent` 工具是 HTTP/API invoke 的子集：

```ts
{
    sessionId: number;
    mode?: "prompt" | "continue" | "steer" | "followup";
    message?: string;
    input?: Record<string, JsonValue>;
    title?: string;
}
```

不支持：

- `clientState`
- `resolution`
- `caller`
- `images`
- 第一版不暴露 `block`

默认 mode：

- 有 `message` 或 `input` 时默认为 `prompt`。
- 都没有时默认为 `continue`。

### 5. Mode / Payload Admission

遵守 [Harness Black-Box Contract](../18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)：

- `prompt`：`message` 或 payload 至少一个。
- `steer`：`message` 或 payload 至少一个；只在 active invocation 存在时可入队。
- `followup`：`message` 或 payload 至少一个；只在 active invocation / waiting 场景下可入队。
- `continue`：不接受 `message` 或 payload；resolution 恢复仍由 HTTP 用户入口使用。
- queued `steer` / `followup` 入队时不写 session history；drain 后才成为模型可见 user message。

### 6. Payload 渲染与 Profile 使用

第一版推荐：

- payload 校验后传给 `ctx.invocation.payload`。
- profile 可在 `prepare()` 或 runtime hook 中读取 payload，加载 DB / Plot / lorebook / 文件上下文，再生成 `modelContextMessages`。
- 默认 user message 可稳定包含 message 和 payload wrapper，以保证即使 profile 未特殊处理 payload，模型也能看到一份可解释载荷；但对于需要查 DB 的 profile，应优先用 profile prepare 处理。

Plot id 场景：

```ts
export const PayloadSchema = Type.Object({
    plotId: Type.Optional(Type.String({
        description: "Plot entity id to load before this invocation.",
    })),
});
```

leader 可调用：

```json
{
  "sessionId": 12,
  "message": "基于这个剧情节点继续设计下一幕。",
  "input": {"plotId": "plot://scene/xxx"}
}
```

目标 profile 在 `prepare()` 中读取 payload，加载 Plot DB，再拼接到本轮模型上下文。

### 7. get_agent_profile

参数保持：

```ts
{ profileKey: string }
```

agent-facing 返回：

```ts
{
    profileKey: string;
    name: string;
    description: string;
    toolKeys: string[];
    initialSchema: string;
    payloadSchema: string | "none";
    outputSchema: string | "none";
}
```

不返回：

- `source`
- `reportResultSchema`
- `reportSidecarResultSchema`

Workbench / profile management API 可继续保留 profile file source 信息，但不要和 agent-facing `get_agent_profile` 混用。

### 8. invoke_agent 返回

agent-facing 返回统一为：

```ts
{
    status: "completed" | "waiting" | "error";
    result?: {
        message: string;
        data?: JsonValue;
    };
    error?: string;
    stats?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        elapsedMs: number;
    };
}
```

映射：

- 有 `report_result`：`result.message = reportResult.result`，`result.data = reportResult.data`。
- 没有 `report_result`：`result.message = strip thinking 后的最后 assistant 文本`。
- `finalMessage` 不作为 agent-facing 字段暴露。
- `invocationId` 隐藏。
- 完整 usage 不暴露，只返回简洁 stats。

## Implementation Plan

### Phase 1 - Profile DSL 类型硬切

- 修改 `server/agent/profiles/types.ts`：
  - `inputSchema` -> `initialSchema`
  - 新增 `payloadSchema?: TSchema`
  - 泛型命名从 `TInputSchema` 改为 `TInitialSchema`，新增 `TPayloadSchema`
  - `ProfilePrepareContext.input` -> `initial`
  - `ProfilePrepareContext.invocation.input` -> `payload`
  - `ProfilePrepareContext.invocation.message` 显式化
- 修改 `define-agent-profile.ts` / `profile-dsl.ts` / artifact compiler 相关类型守卫和 schema 检查。
- 修改 `AgentProfileCatalog`：
  - `parseInput()` -> `parseInitial()`
  - 新增 `parsePayload(profile, payload)`
  - catalog snapshot 输出 `initialSchema` / `payloadSchema`
- 生产路径不保留旧 `inputSchema` 兼容。

### Phase 2 - Harness invoke payload

- 修改 `InvokeAgentInput`：
  - 增加 `payload?: JsonValue`
  - 保留内部 `caller` 如 runtime 仍需要，但不暴露给 HTTP/tool DTO。
  - 保留 `internalQueued` 为私有内部字段。
- 修改 admission：
  - `prompt` / `steer` / `followup` 接受 `message || payload`。
  - `continue` 拒绝 `message` / `payload`。
  - queued item 保存 `{message?, payload?}`。
- 修改 `prepareRun` / `prepare`：
  - 校验 payload。
  - 将 parsed payload 传给 profile context。
  - 将自然语言 message 作为 `ctx.invocation.message`。
- 修改 steer/follow-up drain：
  - drain 时再构造模型可见 user message。
  - 保证入队时不写 durable session history。
- 增加 invocation elapsed time 统计，用于 stats。

### Phase 3 - HTTP DTO/API

- `AgentCreateSessionRequestDtoSchema`：
  - `input` -> `initial`。
- `AgentInvokeRequestDtoSchema`：
  - 新增 `input?: JsonValueSchema`。
  - 新增 `title?: string`。
  - 保持 `caller: never` 或删除 caller 字段，确保用户无法伪造内部 caller。
  - superRefine 按黑盒合同校验 mode/message/input。
- 修改 `server/agent/http.ts`：
  - `createAgentSession()` 传 `initial`。
  - `toInvokeInput()` 把 DTO input 映射到 harness payload。
  - HTTP caller 由服务端内部认定为 user，不从 body 读取。
- 修改前端 `useAgentSessionApi` 类型消费。

### Phase 4 - Agent collaboration tools

- `create_agent` 工具：
  - 参数 `input` -> `initial`。
  - 描述从 `InputSchema` 改为 `InitialSchema`。
  - object 校验函数改名为 `normalizeCreateAgentInitial()`。
- `invoke_agent` 工具：
  - 扩展 mode 为 `prompt | continue | steer | followup`。
  - 增加 `input?: Record<string, JsonValue>`。
  - mode 默认按 `message || input` 推断。
  - 映射到 harness `payload`。
  - 返回 agent-facing compact result。
- `get_agent_profile` 工具：
  - 返回 `initialSchema`、`payloadSchema`、`outputSchema`。
  - 删除 `source`、`reportResultSchema`、`reportSidecarResultSchema`。
  - 描述改为 create 前看 `InitialSchema`，invoke 前看 `PayloadSchema`。

### Phase 5 - Builtin profiles and compiled artifacts

- 全量迁移 builtin contracts：
  - `LeaderDefaultInputSchema` -> `LeaderDefaultInitialSchema`
  - 类似迁移 writer / retrieval / researcher / rp / simulator / summarizer / memory curator。
- 全量迁移 builtin profile 源码：
  - `InputSchema` -> `InitialSchema`
  - `inputSchema` -> `initialSchema`
  - `ctx.input` -> `ctx.initial`
  - 需要 payload 的 profile 新增 `PayloadSchema`。
- 全量迁移 tests 中的 inline test profiles。
- 重新编译系统 profiles 和 metadata。

### Phase 6 - Workbench and DTOs

- `shared/dto/agent-profile.dto.ts`：
  - `inputSchema` -> `initialSchema`
  - 新增 `payloadSchema`
  - Workbench 仍可保留 source/fileName/loadStatus 等 profile management 字段。
- profile editor/inspector 文案：
  - `InputSchema` -> `InitialSchema`
  - 新增 `PayloadSchema` 展示。
- schema builder 第一版若不支持写回 `PayloadSchema`，明确提示源码编辑。

### Phase 7 - Docs and prompts

- 更新 reference/docs：
  - `reference/agent/profile-guide.md`
  - `reference/agent/leader-default.md`
  - `docs/agent/tools.md`
  - RP tick / writer / researcher 等所有提到 `InputSchema`、`invoke_agent.message`、`finalMessage`、`reportResultSchema` 的说明。
- 更新 builtin leader prompt / system references 中的多 Agent 协作规则。
- 更新 `PROJECT-STATUS.md`。

### Phase 8 - Verification

- Unit tests:
  - profile DSL 要求 `initialSchema`，旧 `inputSchema` 报错。
  - catalog snapshot 返回 `initialSchema` / `payloadSchema`。
  - create session 按 `InitialSchema` 校验。
  - invoke payload 按 `PayloadSchema` 校验。
  - 无 `PayloadSchema` 时传 payload 报错。
  - `prompt` / `steer` / `followup` 可只传 payload。
  - `continue` 携带 message / payload 拒绝。
  - queued steer/follow-up 消费前不写 session history。
  - `get_agent_profile` 不返回 source/report schemas。
  - `invoke_agent` 返回统一 `result`，strip thinking，隐藏 invocationId。
- Integration / profile tests:
  - `server/agent/profiles/**`
  - `server/agent/harness/**`
  - `shared/dto/agent-session.dto.test.ts`
  - `server/agent/http.test.ts`
- Build/profile commands:
  - `bun scripts/build/profile.ts check --all --system`
  - `bun scripts/build/profile.ts compile --all --system`
  - `bun scripts/build/profile.ts status --all --system`
  - `bun scripts/build/prepare-system-assets.ts`
  - 必要时运行 `bun test server/agent shared/dto`

## Verification / Test

- `bun scripts/build/profile.ts check --all --system`：通过。
- `bun scripts/build/profile.ts compile --all --system`：通过，重新生成 12 个系统 profile artifact。
- `bun scripts/build/profile.ts status --all --system`：通过，12 个系统 profile 均为 `loaded`。
- `bun scripts/build/prepare-system-assets.ts`：通过，准备 1 个变量 definition 文件与 12 个系统 profile。
- `bun test <源码绝对路径>/server/agent/profiles/profile-dsl.test.ts <源码绝对路径>/server/agent/profiles/catalog.test.ts <源码绝对路径>/server/agent/harness/neuro-agent-harness-payload.test.ts <源码绝对路径>/server/agent/tools/agent-collaboration-tools.test.ts <源码绝对路径>/shared/dto/agent-session.dto.test.ts <源码绝对路径>/server/agent/http.test.ts <源码绝对路径>/server/agent/profiles/leader-assets-profile.test.ts <源码绝对路径>/server/agent/profiles/rp-profiles.test.ts <源码绝对路径>/server/agent/profiles/simulation-director-profiles.test.ts`：通过，共 100 个测试通过。使用绝对路径是为了避免 Bun 同时匹配 `product/` staged output 镜像测试。
- `rg -n "inputSchema|InputSchema|ctx\\.input|metadata\\.input|parseInput|profile\\.inputSchema|createAgent\\(\\{[^\\n]*input|createSession\\(\\{[^\\n]*input" server\\agent shared\\dto app\\components\\profile-template-editor assets\\workspace\\.nbook\\agent\\profiles\\builtin reference\\agent reference\\content docs\\agent docs\\profile docs\\profile-tsx docs\\tutorials -S`：未发现本任务旧 profile 合同残留；命中的 `StoryRefsInputSchema`、`PiModelInputSchema`、`RequestUserInputSchema` 等是其他领域的普通 schema 命名。
- `bun run typecheck`：未通过。剩余错误不再是本任务旧合同迁移问题，集中在 `AgentSessionTreeDialog.vue`、`agent-suggestion.test.ts`、`ProfileTemplateNodeView.vue`、`server/agent/harness/compaction.ts`、`silly-tavern-card-cli.test.ts` 的既有或相邻 strict 类型债务。

## Implementation Walkthrough

- 2026-06-16：创建 task。根据用户决策记录硬切方案：`inputSchema` 改为 `initialSchema`，新增 `payloadSchema`；HTTP/API invoke 增加 `title` 和 payload；agent tool invoke 扩展到 `prompt/continue/steer/followup` 且支持 `message?: string` 与 `input?: object`；`get_agent_profile` 保持 `{profileKey}` 参数并精简返回；`invoke_agent` 返回统一 `result`。
- 2026-06-16：实现首批生产路径硬切：核心 profile/catalog/harness/session 类型改为 `initialSchema` / `payloadSchema`；HTTP create 使用 `initial`，HTTP invoke 的 `input` 映射为 per-invoke payload；`invoke_agent` 支持 `prompt | continue | steer | followup`、`message?: string`、`input?: object` 和 compact `result/stats` 返回；`get_agent_profile` agent-facing 返回精简为 schema/tool 摘要。
- 2026-06-16：迁移 builtin profiles 源码和系统 compiled artifacts，`writer`、`summarizer`、`rp.writer` 等生产 profile 均通过 system profile check/compile/status；Workbench DTO 与 profile detail 从 `inputSchema` 切到 `initialSchema` / `payloadSchema`，prepare preview 请求切到 `initial` / `initialOverrides`。
- 2026-06-16：更新 active reference 和状态文档：`reference/agent/leader-default.md`、`reference/agent/profile-guide.md`、`docs/agent/tools.md` 和 `PROJECT-STATUS.md` 已记录新合同。
- 2026-06-16：补齐 targeted verification。旧 `inputSchema` / `ctx.input` / `metadata.input` / `createAgent({ input })` / `createSession({ input })` 合同在 active agent/profile 范围内已清理；全仓 typecheck 剩余为本任务之外的 UI/test/union narrowing 类型债务。
- 2026-06-16：验证注意事项：相对路径运行同一组测试时，Bun 会额外匹配 `product/server/...` 和 `product/shared/...` staged output 镜像测试，导致 product 旧构建输出参与运行并失败；源码绝对路径目标测试通过。`assets/workspace/.nbook/agent/profiles/builtin/*test.ts` 测试文件当前不在工作区内，未作为最终验证项记录。
- 2026-06-16：completion audit 补漏：修正 `leader.assets` prompt 中旧 `finalMessage` / `report_result schema` 说明，改为 `invoke_agent.result.message/data` 和 `get_agent_profile` 的 `InitialSchema` / `PayloadSchema` / `OutputSchema` / `toolKeys` 摘要；同步清理 `PROJECT-STATUS.md` 中旧 `ctx.input` 术语。重新执行 profile check/compile/status、prepare-system-assets 和 100 个目标测试，均通过。

## TODO / Follow-ups

- [x] Phase 1：Profile DSL 类型硬切。
- [x] Phase 2：Harness invoke payload 接入。
- [x] Phase 3：HTTP DTO/API 接入。
- [x] Phase 4：Agent collaboration tools 接入。
- [x] Phase 5：Builtin profiles 与 compiled artifacts 迁移。
- [x] Phase 6：Workbench 与 DTO 文案迁移。
- [x] Phase 7：Docs、prompts、PROJECT-STATUS 同步。
- [x] Phase 8：迁移测试 fixture，完成 profile/harness/tool/API targeted verification。
- [ ] Follow-up：清理全仓 typecheck 剩余的 UI/test/union narrowing 类型债务；这些错误当前不再属于 initial/payload 合同迁移残留。
