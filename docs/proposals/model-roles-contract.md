# 模型角色（role）的后端契约

- **状态**：accepted（2026-09-10 开发者就四条取舍作出结论，见「决策记录」与「方案」）

## 问题

开发者给了一份模型角色表（梯度轴 `tiny` / `fast` / `main` / `deep`，专精轴 `summarize` / `writer` / `narrative` / `plan` / `vision`），要求「哪个角色用哪个模型」可配置。UI 已按此做出 Lab 页面（`app/components/novel-ide/settings/sections/roles/`，UI 先行）。但后端没有 role 这一层：

- 一次会话的模型只由一条固定优先级链解析，链上没有「用途」这一维；
- 只有两处隐式用途分派：子代理的 `invoke_agent.model` 单次覆盖、后台 summarizer 的独立 profile（标题 + 摘要）。`tiny` / `fast` / `deep` / `plan` / `vision` / `writer` / `narrative` 在运行时**零分派**；
- 全局配置没有承载 role 绑定的段；即使 DTO 放行，`normalizeGlobalConfig` 是显式 allowlist，未登记的段会被静默丢弃。

## 目标与非目标

目标：

1. 在全局配置里新增 `roles` 段，承载「角色 → 已启用模型」的绑定；未配置的角色按声明式回落解析。
2. 在模型解析链上增加 role 维度，使调用方可以按角色取模型（第一个消费方是子代理与 summarizer，其次是把 role 暴露给 profile 默认值）。
3. 让 role 的「建议候选链」在配置里有位置，但**本期不做运行时的自动候选回退**。

非目标：

- 不做自动候选链回退（Pi 层只有 `requestOptions.maxRetries` 重试，没有模型级回退机制；自动回退是新的运行时能力，超出本契约）。
- 不给本地模型新增 Provider 类型（见「证据」：本地端点今天已经能当 Provider 用）。
- 不改 profile 的语义；role 与 profile 仍是两层。

## 当前行为与证据

**模型解析**（唯一入口）：

- `server/agent/harness/model-resolver.ts:16` `resolvePiModelFromConfig(config, profileKey, override)`；优先级链 `:22`：`override.modelKey ?? override.model ?? config.agent.profiles[profileKey].model.modelKey ?? config.agent.profileModelDefaults.modelKey ?? config.models.defaultModelKey`；全空抛错 `:24`。
- 调用点：普通 invoke `neuro-agent-harness.ts:2056-2062`；session 已存 `model_change` 时走 `resolveEffectiveSessionModel:7026-7052`；thinking 级别 `:3135`；context window `:7667/:7692`；手动 compact 复用 session 模型 `:7836`。
- 隐式用途分支仅两处：`invoke_agent.model`（schema `server/agent/tools/agent-collaboration-tools.ts:33-35`，白名单 `assertVisibleModel:113-123`）与后台 summarizer profile（默认 key `summarizer`，`server/agent/profiles/profile-runtime-settings.ts:21-28`）。
- `plan` 只是 mode/prompt（`plan-mode-path.ts`）；`vision` 只在附件编解码按 `model.input.includes("image")` 决定是否注图（`server/agent/attachments/agent-attachment-codec.ts:69-73`），不换模型。

**配置层**：

- DTO：`shared/dto/config.dto.ts:400 GlobalConfigDtoSchema` / `:426 GlobalConfigUpdateDtoSchema`（均 `.partial().passthrough()`）；现有段 `models` / `embedding` / `agent` / `ui` / `editor` / `web` / `observability` / `history`。字段命名 camelCase（`modelKey` / `defaultModelKey`）。
- 类型：`server/config/types.ts:174 EffectiveConfig`、`:241 StoredGlobalConfig`。
- 归一化：`server/config/normalizer.ts:171-218 normalizeGlobalConfig` 是**显式 allowlist**（未列出即静默丢），`resolveEffectiveConfig:296-300` 写默认值。
- 登记：`server/config/registry.ts:5 CONFIG_REGISTRY` 每段一条元数据。
- 落盘：`server/config/config-service.ts:220-255 saveGlobalConfig`（合并 `230-242`）、`:252` 写 `StateRoot/.nbook/config.json`；另有两处显式 allowlist 必须同步：`:462-497 redactGlobalConfig`（反面证据：`history` 未列出，GET 会被静默丢）、`:671-695 globalModelReferences`（模型引用校验，漏了则坏引用不报错）。

**本地模型**：

- 无 apiKey 强制（`packages/neuro-book/packages-contracts/src/provider-config-contract.ts:115-125 inspectRunnableModel` 只查 baseURL）；空 key 走内部占位 `OPENAI_NO_AUTH_KEY`（`server/agent/harness/pi-request-options.ts:9,24-31`）。
- 不强制 https（`server/models/discovery.ts:276-281`）；测试已用 `http://127.0.0.1:11434/v1` 作合法 baseURL（`server/models/model-config-validation.test.ts:41`）。
- 限制：每个模型必须显式声明 `api` / `reasoning` / `input` / `contextWindowTokens` / `maxTokens`（`provider-config-contract.ts:82-113`），runtime 不读 Pi 内置目录补全（`server/agent/harness/pi-runtime-resolver.ts:20-21`）。
- **结论：本地端点（ollama / lm studio / llama.cpp）今天已经能当 Provider 用；「本地模型」不是后端缺口**，缺的只是产品层的「本地」分类与一键模板。

**profile 与 visibleModels**：

- profile 指定模型：`agent.profiles[key].model.modelKey`（`server/config/types.ts:23-29`，DTO `shared/dto/app-settings.dto.ts:109-115`）。
- profile key 来自 `manifest.key`，文件约定 `<key>.profile.tsx`（`server/agent/profiles/catalog.ts:888-895`，`keyFromFileName:1017-1019`）；现存 key 形如 `writer` / `leader.default` / `summarizer` / `retrieval`。
- **`@writer` 这种写法在代码中不存在**（`@` 只是编辑器引用菜单前缀，`app/composables/useStructuredReferenceMenu.ts:227-228`）；正式标识就是 profileKey。t18 里记的「`@writer` → `writer.default` 映射」应改述为「role 与 profileKey 的对应关系」。
- `visibleModels` 唯一真相源 `server/agent/harness/agent-visible-models.ts:33-58`，约束 Leader 选择（`assertVisibleModel:62-66`）。

## 方案

### 配置形状

`roles` 段只存**绑定**，角色目录与回落链写死在代码里（与 UI 现状一致，见「备选方案」）：

```ts
// shared/dto/config.dto.ts 的 GlobalConfigDtoSchema / GlobalConfigUpdateDtoSchema 新增
roles: {
    bindings: Record<string, string | null>,   // roleId → modelKey（`providerId/modelId`，与 models.defaultModelKey 同形）
    chains?: Record<string, string[]>,         // 可选：候选链，本期只存不消费
}
```

- 角色 id 的合法集合由代码里的 catalog 定义，DTO 只校验形状（`string` 键 + `string | null` 值）；未知 roleId 在 normalizer 里丢弃而不是报错（配置可向前兼容）。
- `modelKey` 复用 `globalModelReferences` 的引用校验路径，坏引用按现有模型引用问题的报错方式呈现。

### 解析

`resolvePiModelFromConfig` 增加一个可选入参 `role`，插在 `override` 之后、profile 之前：

```
override.modelKey ?? override.model
  ?? roles 里该 role（或其回落链上第一个有绑定的 role）的 modelKey
  ?? config.agent.profiles[profileKey].model.modelKey
  ?? config.agent.profileModelDefaults.modelKey
  ?? config.models.defaultModelKey
```

- 回落链在服务端解析（UI 的 `resolveEffectiveRole` 是它的镜像）；`fallback: null` 的角色（`vision`）不借任何人的模型，此时继续往下走 profile 链，而不是硬失败。
- 只有明确传 `role` 的调用方受影响；现有调用点行为不变（第一步只接子代理与 summarizer）。

### 落地清单

1. `shared/dto/config.dto.ts`：`:400` / `:426` 加 `roles`（Project 覆盖与否见未决）。
2. `server/config/types.ts`：`:174` / `:241`（+ `:252` 视未决）。
3. `server/config/normalizer.ts`：`:176-218` 保留、`:296-300` 写默认值。
4. `server/config/registry.ts`：`:5` 加一条元数据。
5. `server/config/config-service.ts`：`:230-241` 合并、`:462-497` redact、`:671-695` 引用校验。
6. 重跑 openapi meta 生成（`global.put.ts` / `editor-snapshot.get.ts` / `project.put.ts`）。
7. 解析接入：`model-resolver.ts:16` 加 role 分支；子代理与 summarizer 传 role。
8. 测试：`server/config/config-service.test.ts`、`server/config/normalizer.test.ts`、`shared/dto/app-settings.dto.test.ts`、`server/api/config/project-http-contract.test.ts`，以及 `model-resolver` 的新优先级断言。

## 备选方案与取舍

| 取舍 | 选择 | 理由 |
| --- | --- | --- |
| 角色目录写死 vs 可配置 | **写死** | 目录与回落链是产品语义（UI 已写死，`roles-settings-draft.ts:38-105`）；写死则配置段只管绑定，形状最小 |
| `Record<role, modelKey>` vs `Array<{role, modelKey}>` | **Record** | 与 `agent.profiles` 的键值风格一致；数组的重复 role 需要额外去重 |
| 自动候选回退 vs 只存不消费 | **只存不消费** | Pi 层没有模型级回退；自动回退要新机制（失败探测、切换语义、可观测），属独立提案 |
| 本地模型单独 Provider 类型 | **不做** | 证据显示本地端点已能当普通 Provider 用（`inspectRunnableModel` 只查 baseURL、空 key 有占位） |
| role 与 profile 的关系 | **并列两层，靠 role 名与 profileKey 同名时约定** | `@writer` 不是正式标识；正式对应关系是「role 名 ↔ profileKey」 |

## 数据、接口、安全、迁移、发布与回滚影响

- 持久化：`StateRoot/.nbook/config.json` 新增 `roles` 段；旧配置无该段时按空绑定处理（回落到 profile 链），**无需迁移**。
- 接口：`GlobalConfigUpdateDtoSchema` 变宽；`roles` 未出现时行为不变，回滚只需删段。
- 安全：`roles` 只是模型选择，不引入新的凭据面；`redactGlobalConfig` 必须登记，否则 GET 静默丢失（已有 `history` 的反面证据）。
- 未白名单的风险：不写 `normalizer` 会被静默丢弃——这是本提案里最容易踩空的一步。

## 对 Spec 的预期改动

- 目标 capability：全局配置的 `roles` 段（写入、读取、引用校验）与「按 role 解析模型」的解析规则。
- 输入：`{bindings: Record<roleId, modelKey | null>}`；输出：配置读回与解析结果 `modelKey`。
- 状态：未配置（调用方传了 role 而链上没有绑定 → 配置错误）/ 已绑定 / 坏引用（modelKey 不可运行）。
- 副作用：仅影响显式传 role 的调用方。
- 失败：坏引用按模型引用问题报错；role 链上没有任何绑定时报配置错误（不静默回落，2026-09-10 决策）。
- 验收：`roles` 段往返不丢（写 → 读 → 归一化后仍在）；role 有绑定时子代理取到该模型；未绑定时行为与今天一致。

## 决策记录

- 2026-09-10：开发者确认「UI 先行，保证 Lab 可用，后端契约缺口记录下来，正式接入时再做」；本提案即为该缺口的整理。
- 2026-09-10：开发者拍板四条取舍（见上表）——`accepted`。解析规则据此收严：**调用方传了 role 而该角色（及其回落链）没有绑定时按配置错误处理**，不再静默沿 profile 链取值；`chains` 本期只存不消费；Project 不参与；本地模型不在本契约内。

## 未决取舍（开工前必须定）

四条取舍已由开发者于 2026-09-10 拍板（下表为结论）：

| 取舍 | 结论 |
| --- | --- |
| 未配置的角色怎么取模型 | **必须显式绑定，否则报错**（不静默回落到 profile 链；`fallback: null` 的角色同样要求显式绑定） |
| 候选链是否本期实现运行时回退 | **只存不消费**；配置里留 `chains` 位置，解析不用它 |
| role 是否允许 Project 级覆盖 | **只做全局**（不动 ProjectConfigDtoSchema） |
| 本地模型是否要分类与一键模板 | **不在本契约里做**（已由 Provider 机制覆盖，模板属 Provider 页的产品工作） |

## 参考

- UI 侧唯一改写入点：`packages/neuro-book/app/components/novel-ide/settings/sections/roles/roles-settings-draft.ts`（catalog、回落、写回体形状）。
- 事实依据来源：`RoleContractScout` 报告（本提案「当前行为与证据」一节的 `文件:行号` 均来自它，已抽查复核）。
