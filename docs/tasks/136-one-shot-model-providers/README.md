# One-Shot Model Providers（一次性对话模型：反代无工具模型 + claude -p）

> 状态：**分析完成、设计已收敛，未开工**。等待用户确认后按切片实施。

## Relative documents refs

- [Task 113 Memory System](../113-memory-system/README.md)：nb-memory 接入后会产生「记忆抽取」一次性调用，是本任务 purposes 槽位的第二个消费者
- [Task 104 Pi Models Runtime 升级](../104-pi-models-runtime-upgrade/README.md)：provider 配置契约与 pi runtime 解析的现状来源
- [Task 96 Session Title Summarizer](../96-session-title-summarizer/README.md)：摘要链路的既有背景（本任务只动 compaction 的模型选择，不动触发策略）
- `docs/research/pi-agent-harness.md`：pi runtime 调研
- `reference/agent/pi-trace-observability.md`：trace 统一入口契约

## User Request / Topic

用户原始需求（2026-08-02）：

1. 接入**一次性对话模型**：通常没有工具调用能力，来自网页端反代（OpenAI 兼容形态）。适合 session 摘要、记忆检索等不需要连续对话的场景。
2. 支持 **`claude -p` 子进程调用**：一问一答，复用宿主机的 Claude Code 登录态配置。适合「一遍过」的 writer。

用户后续拍板（同轮讨论）：

- 能力限定要做，但担心过度设计 → 收敛为「一个布尔 + 一个检查」的最小形态（见 Decisions）
- writer 后置：当前 writer 不纯粹，纯粹的 writer 应该只写（文本进 → 文本出）；**第一优先级是记忆、摘要**

## Goal

- Outcome：① 无工具反代模型可配置并被 compaction 摘要实际消费；② 误把无工具模型选进带工具的 profile 时，harness 在发出请求前 fail fast 报中文明错；③ `claude-cli` 作为新的 Pi api adapter 接入，可被 purposes 槽位消费。
- Verification surface：compaction 走 purposes.summary 指定模型的 trace 记录（`PiRequestRecorder`）；无工具模型 + 带工具 profile 的 harness 入口报错测试；claude-cli adapter 的单测（mock 子进程 stdout 流）。
- Constraints：不改 pi-ai 依赖本身；不破坏现有 5 个 api adapter 行为；现有模型配置零迁移（新字段全部可空）。
- Boundaries：writer 落盘闭环（workflow `workspace.write` / CLI 自带工具）**明确不做**，等用户重新提起。
- Blocked stop condition：若 claude CLI 的 stream-json 输出契约与预期不符（版本差异），停止并报告实际输出格式，不动业务代码 hack。

## Current State

- 2026-08-02：完成现状调研与设计收敛（本文档），**未写任何业务代码**。开工前需用户确认切片范围。

## ADR / Decisions / Discussion

### 现状架构事实（已核实，2026-08-02）

- 统一走 pi runtime（`@earendil-works/pi-ai@0.80.6`），不用官方 SDK。api adapter 是封闭白名单 `SUPPORTED_PI_APIS`（5 个），见 `shared/models/provider-config-contract.ts:2-8`；DTO 层 `SupportedPiApiSchema = z.enum(SUPPORTED_PI_APIS)`，见 `shared/dto/app-settings.dto.ts:21`。
- 每次 invocation 由 `resolvePiModelsFromConfig()` 独立建 `Models + Provider`，`createProvider({api: streams})` 接受任意 `ProviderStreams`——**这就是扩展点**，见 `server/agent/harness/pi-runtime-resolver.ts:25-70`。
- config → Model 转换在 `server/agent/harness/pi-model-metadata.ts:16-41`，其注释明确设计哲学：「Runtime 不读取 Provider Preset、Model Catalog 或远程发现结果，也不猜测任何必需能力」。
- pi 的 openai-completions adapter **只在 `context.tools` 非空时才发 `tools` 参数**（`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:453-462`）；无认证端点已支持（空 key 自动用占位 `neurobook-no-auth`，`server/agent/harness/pi-request-options.ts:8,44-46`）。→ **反代无工具模型今天就能配进 Custom Provider，接入侧零代码**。
- 现有无工具调用点仅两个：compaction 摘要（`server/agent/harness/compaction.ts:295`，`tracedCompleteSimple`）与模型连通性检查（`server/utils/model-settings.ts:228`）。**「记忆检索」当前没有 LLM 消费点**：`subject_rag_search` 是纯 sqlite-vec 向量召回；nb-memory（Task 113）未接入。
- compaction 用的是**会话自己的模型**（`compaction.ts:65-110` 的 `model` 由 harness 传入）；配置里只有 `defaultModelKey` + per-profile `modelKey` + `visibleModels`，**没有用途槽位**。
- 除摘要外所有模型调用都过 harness + 工具：workflow → `HarnessAgentPort` → `harness.invokeAgent()`（`server/agent/workflow/workflow-agent-port.ts:21-41`）；结构化输出 = `report_result` **工具**（`server/agent/harness/neuro-agent-harness.ts:7766-7775`）→ 无工具模型无法参与 outputSchema workflow phase。
- workflow 沙箱 workspace 端口**只读**（`server/vendor/nb-workflow/ports.ts:95`、`runner.ts:309-313`）→ 「模型出文本、编排层落盘」目前缺写通道。
- `claude -p` 无先例：server 内没有任何子进程调 LLM CLI 的代码；进程树管理可复用 `@notnotype/owned-process`（Task 117）。
- pi-ai 扩展面对外公开：`Api` 是开放字符串（`types.d.ts:14`），`createAssistantMessageEventStream()` 标注 "for use in extensions"（`utils/event-stream.d.ts:20`）。

### D1：能力限定 = 一个布尔 + 一个检查（用户已认可方向）

**不做**完整能力矩阵（tools/vision/streaming/json-mode/推断/发现时探测/自动路由）——那是过度设计。只做：

| 项 | 做法 |
|---|---|
| 字段 | `ConfiguredModelConfig` 加可空 `capabilities.tools?: boolean`（或平铺 `tools?: boolean`，实现时定），**缺省 = 支持**，现有配置零迁移 |
| 校验 | 不进 `inspectModelCapability` 必填项，仅透传 |
| 执行检查 | harness invoke 入口：`profile 工具非空 && model.tools === false` → 抛中文明错，**第一轮请求前 fail fast**（位置：模型解析/invocation 校验处，实现时定点） |
| UI | 模型选择器给 `tools: false` 模型加标记，**不做过滤**（可后置） |

理由：`reasoning`/`input`/`contextWindowTokens` 已是强制能力声明（`provider-config-contract.ts:82-112`），补 `tools` 是既有模式的延伸，不是新发明。没有这一个 if 的代价：错误表现为「反代 400」或「静默忽略 tools 导致 agent 空转」，且埋在 workflow run 深处难诊断。

### D2：用途路由 = `models.purposes` map（先只消费 summary）

```jsonc
// .nbook/config.json
"models": {
  "defaultModelKey": "...",
  "purposes": { "summary": "proxy-cheap/gpt-4o-mini" },  // 未来： "memory-extract": ...
  "providers": { ... }
}
```

- compaction 解析模型时优先 `purposes.summary`，缺省回落会话模型（行为不变）。
- 用 map 而非单字段：Task 113 落地时「记忆抽取」只是多一个 key，不是第二次配置结构变更。
- **不做 per-profile 覆盖**，等真出现「不同 profile 用不同摘要模型」再说。
- purposes 的 key 按调用点语义命名（`memory-extract`），不叫 `memory`——查询侧是纯向量召回不需要 LLM，需要模型的是写入侧抽取。

### D3：claude-cli adapter（切片 2）

- 新增 `SupportedPiApi` 成员 `"claude-cli"`，自实现 `ProviderStreams`：`stream/streamSimple` 内部 spawn `claude -p --output-format stream-json`，`Context`（systemPrompt + messages）flatten 成 prompt，stream-json 事件流转 `AssistantMessageEventStream`；`context.tools` 非空时**直接报错**（纯问答，fail fast 优于静默丢弃）。
- 配套机械登记：`SUPPORTED_PI_APIS`、`CUSTOM_API_STREAMS`（`pi-runtime-resolver.ts:12-18`）、`SupportedPiApiSchema`、baseURL 豁免（`provider-config-contract.ts:117` 目前非 bedrock 强制 baseURL，需像 bedrock 一样豁免）、provider 模板库加模板。
- 子进程用 `@notnotype/owned-process`（Windows Job Object 杀进程树），`AbortSignal → kill`；`piRequestAuthOptions` 对未知 api 自然落无鉴权分支（`pi-request-options.ts:47`），无需改动。
- trace 免费获得：所有调用必经 `tracedStreamSimple/tracedCompleteSimple`（`server/agent/observability/traced-provider.ts:195,234`）。
- 部署形态注意：Docker/GHCR 无宿主 claude 登录态，CLI 不存在时 fail fast 报清晰错误。定位是「作者本机」功能。
- 协同：配好后 `purposes.summary` 可填 claude-cli 模型，摘要不耗 API 额度走订阅。

### D4：writer 后置（用户拍板）

- 「纯粹的 writer 只写」（文本进 → 文本出，落盘是编排层的事）与无工具模型路径天然契合，但**第一优先级是记忆、摘要**。
- 未来重提时的三条落盘路线（记录备查，届时重新评估）：a. workflow 加 `workspace.write` activity（涉及可安装资产的安全模型）；b. 两级 invoke（persister profile，丑但零新机制）；c. `claude -p --allowedTools Write` 自带工具落盘（子进程获磁盘写权，与 NeuroBook 文件审批体系脱钩）。

### 已排除的方案

- 能力矩阵 / 自动探测 / 按能力过滤模型选择器：过度设计。
- per-profile 摘要模型覆盖：无真实需求。
- 修改 pi-ai 或 fork：公开扩展点已够用。

## Verification / Test

（未执行，开工后补）

- 单测：harness 入口拒绝 `tools:false + 带工具 profile`；compaction 优先 purposes.summary、缺省回落；claude-cli adapter 事件流解析（mock 子进程）。
- trace：compaction 走 purposes 模型时 `pi-request-recorder` 落记录且 provider/api 正确。
- 真实验收：配一个反代模型进 summary 槽，跑一次长会话触发 compaction，确认摘要生成且主会话模型未被摘要调用污染。

## Implementation Walkthrough

（未开工；切片计划如下，实际出入开工后记录）

- **切片 1**：`capabilities.tools` 可空字段 + harness 入口 fail fast + `models.purposes.summary` 接入 compaction。
- **切片 2**：`claude-cli` adapter + 三处白名单登记 + provider 模板。
- **切片 3**（writer 闭环）：明确后置，等用户重提。

## TODO / Follow-ups

- [ ] 用户确认切片 1+2 范围后开工（claude-cli 是否同批用户尚未拍板）。
- [ ] Task 113 nb-memory 接入时，把「记忆抽取」调用落到 `purposes["memory-extract"]`。
- [ ] writer 闭环（D4）等用户重新提起，届时重新评估 a/b/c。
