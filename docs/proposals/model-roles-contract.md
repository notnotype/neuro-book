# 模型角色（role）的后端契约

- **状态**：accepted（2026-09-10 开发者就四条取舍作出结论；2026-09-11 按 UI 重设计修订，见「决策记录」）

## 问题

开发者要求「哪个角色用哪个模型」可配置。UI 已做出 Lab 页面（`app/components/novel-ide/settings/sections/roles/`，UI 先行）。但后端没有 role 这一层：

- 一次会话的模型只由一条固定优先级链解析，链上没有「用途」这一维；
- 只有两处隐式用途分派：子代理的 `invoke_agent.model` 单次覆盖、后台 summarizer 的独立 profile（标题 + 摘要）。`tiny` / `fast` / `deep` / `plan` / `vision` / `writer` / `narrative` 在运行时**零分派**；
- 全局配置没有承载 role 绑定的段；即使 DTO 放行，`normalizeGlobalConfig` 是显式 allowlist，未登记的段会被静默丢弃。

## 目标与非目标

目标：

1. 在全局配置里新增 `roles` 段，承载**角色条目**：id、轴（梯度 / 专精）、名字、描述、绑定的已启用模型。
2. 在模型解析链上增加 role 维度，使调用方可以按角色取模型（第一个消费方是子代理与 summarizer，其次是把 role 暴露给 profile 默认值）。
3. 让角色条目成为**模型看到的目录**的真相源：条目里的描述就是模型读到的那句话，目录由已绑定且有描述的条目组成。

非目标：

- 不做运行时的自动候选回退，也**不存**候选链（Pi 层只有 `requestOptions.maxRetries` 重试，没有模型级回退机制；自动回退要新机制——失败探测、切换语义、可观测——属独立提案）。
- **不做回落**：角色没有「跟随另一个角色」的语义，没绑定就是配置错误（2026-09-10 决策，2026-09-11 从 UI 到契约一致）。
- 不把这份目录注入提示词：本契约只负责它落进配置并能被读回，消费是产品侧接线的下一步。
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
- 不强制 https（`server/models/discovery.ts:276-281`）；测试已用 `http://127.0.0.1:11434/v1` 作合法 baseURL（`server/models/model-config.test.ts:41`）。
- 限制：每个模型必须显式声明 `api` / `reasoning` / `input` / `contextWindowTokens` / `maxTokens`（`provider-config-contract.ts:82-113`），runtime 不读 Pi 内置目录补全（`server/agent/harness/pi-runtime-resolver.ts:20-21`）。
- **结论：本地端点（ollama / lm studio / llama.cpp）今天已经能当 Provider 用；「本地模型」不是后端缺口**，缺的只是产品层的「本地」分类与一键模板。

**profile 与 visibleModels**：

- profile 指定模型：`agent.profiles[key].model.modelKey`（`server/config/types.ts:23-29`，DTO `shared/dto/app-settings.dto.ts:109-115`）。
- profile key 来自 `manifest.key`，文件约定 `<key>.profile.tsx`（`server/agent/profiles/catalog.ts:888-895`，`keyFromFileName:1017-1019`）；现存 key 形如 `writer` / `leader.default` / `summarizer` / `retrieval`。
- **`@writer` 这种写法在代码中不存在**（`@` 只是编辑器引用菜单前缀，`app/composables/useStructuredReferenceMenu.ts:227-228`）；正式标识就是 profileKey。t18 里记的「`@writer` → `writer.default` 映射」应改述为「role 与 profileKey 的对应关系」。
- `visibleModels` 唯一真相源 `server/agent/harness/agent-visible-models.ts:33-58`，约束 Leader 选择（`assertVisibleModel:62-66`）。

## 方案

### 配置形状

`roles` 段承载**条目本身**，因为专精轴允许用户增删角色（gradient 固定四档，specialist 可自定义），角色集合不再是代码里的固定枚举：

```ts
// shared/dto/config.dto.ts 的 GlobalConfigDtoSchema / GlobalConfigUpdateDtoSchema 新增
roles: {
    items: Array<{
        id: string;                                  // 稳定标识：custom-N 或固定档位名；建后不变
        axis: "gradient" | "specialist";
        name: string;                                // 给人看的名字
        description: string;                         // 给模型看的一句话；进模型目录
        modelKey: string | null;                      // `providerId/modelId`，与 models.defaultModelKey 同形
    }>,
}
```

- **命名与形状对齐 UI 的写回体**：`app/components/novel-ide/settings/sections/roles/roles-settings-draft.ts` 的 `buildRolesSection()` 已经产出这个形状（字段名逐字相同），接线时无需转换层。
- 归一化规则（写进 `normalizeGlobalConfig`）：按 `id` 去重（后来的覆盖先来的）、丢弃 `id` 为空的条目、`axis` 非法回落到 `specialist`、`modelKey` 空串按 `null`；**不做**按轴排序（顺序即用户顺序，梯度轴在前由 UI 保证）。
- 固定档位（`tiny` / `fast` / `main` / `deep`）由**服务端校验**兜底：缺失时不自动补，只在该 role 被调用且无绑定时按配置错误报出（与用户删掉它们不可能发生的事实一致——UI 不允许删）。
- `modelKey` 复用 `globalModelReferences` 的引用校验路径，坏引用按现有模型引用问题的报错方式呈现。

### 解析

`resolvePiModelFromConfig` 增加一个可选入参 `role`，插在 `override` 之后、profile 之前：

```
override.modelKey ?? override.model
  ?? roles 里该 role 的 modelKey        // 没有回落，不沿任何链找别的角色
  ?? config.agent.profiles[profileKey].model.modelKey
  ?? config.agent.profileModelDefaults.modelKey
  ?? config.models.defaultModelKey
```

- **调用方显式传了 `role` 而该角色没有绑定 → 抛配置错误**，不再静默沿 profile 链取值（2026-09-10 决策）。没传 `role` 的调用方行为完全不变。
- `vision` 不再特殊：它同样要求显式绑定（主模型多半不支持原生视觉，静默回落只会把图喂给读不了图的模型）。
- 只有明确传 `role` 的调用方受影响；现有调用点行为不变（第一步只接子代理与 summarizer）。

### 落地清单

1. `shared/dto/config.dto.ts`：`:400` / `:426` 加 `roles`（只做全局，不动 ProjectConfigDtoSchema）。
2. `server/config/types.ts`：`:174` / `:241`。
3. `server/config/normalizer.ts`：`:176-218` 保留并加 `roles.items` 的归一化（去重 / 丢弃 / 回落），`:296-300` 写默认值。
4. `server/config/registry.ts`：`:5` 加一条元数据。
5. `server/config/config-service.ts`：`:230-241` 合并、`:462-497` redact、`:671-695` 引用校验（要覆盖 `items[].modelKey`）。
6. 重跑 openapi meta 生成（`global.put.ts` / `editor-snapshot.get.ts` / `project.put.ts`）。
7. 解析接入：`model-resolver.ts:16` 加 role 分支（显式绑定或报错）；子代理与 summarizer 传 role。
8. 测试：`server/config/config-service.test.ts`、`server/config/normalizer.test.ts`、`shared/dto/app-settings.dto.test.ts`、`server/api/config/project-http-contract.test.ts`，以及 `model-resolver` 的新优先级与「未绑定即报错」断言。

## 备选方案与取舍

| 取舍 | 选择 | 理由 |
| --- | --- | --- |
| 角色目录写死 vs 可配置 | **可配置（条目进配置）** | 2026-09-11 改：专精轴允许用户增删角色，固定枚举表达不了自定义角色；条目自带名字与描述，运行时才知道有哪些角色 |
| `Record<role, modelKey>` vs `Array<{id, …, modelKey}>` | **Array** | 同上：集合不再固定，且顺序有意义（梯度轴在前）；重复 id 由 normalizer 去重而不是靠 Record 的键唯一性 |
| 自动候选回退 vs 只存不消费 | **都不做** | Pi 层没有模型级回退；候选链在 UI 里也已下线（建议模型只是 tooltip 提示，不进配置）。将来要做，是独立提案 |
| 角色未绑定时是否回落 | **报配置错误** | 没有回落语义；错误由宿主呈现在角色页（`roleConfigIssues()` 已给出 UI 侧同构判断） |
| 本地模型单独 Provider 类型 | **不做** | 证据显示本地端点已能当普通 Provider 用（`inspectRunnableModel` 只查 baseURL、空 key 有占位） |
| role 与 profile 的关系 | **并列两层，靠 role 名与 profileKey 同名时约定** | `@writer` 不是正式标识；正式对应关系是「role 名 ↔ profileKey」 |

## 数据、接口、安全、迁移、发布与回滚影响

- 持久化：`StateRoot/.nbook/config.json` 新增 `roles` 段；旧配置无该段时按**空条目**处理（不影响任何现有调用方，因为没有调用方传 role），**无需迁移**。
- 接口：`GlobalConfigUpdateDtoSchema` 变宽；`roles` 未出现时行为不变，回滚只需删段。
- 安全：`roles` 只是模型选择与几行描述文本，不引入新的凭据面；`redactGlobalConfig` 必须登记，否则 GET 静默丢失（已有 `history` 的反面证据）。
- 未白名单的风险：不写 `normalizer` 会被静默丢弃——这是本提案里最容易踩空的一步。
- 文本边界：`name` / `description` 是用户输入且会进模型上下文，消费侧要当**不可信文本**处理（长度上限与注入防护在消费侧定，本契约只做长度与类型校验）。

## 对 Spec 的预期改动

- 目标 capability：全局配置的 `roles` 段（写入、读取、归一化、引用校验）与「按 role 解析模型」的解析规则。
- 输入：`{items: Array<{id, axis, name, description, modelKey | null}>}`；输出：配置读回、解析结果 `modelKey`、以及模型目录（已绑定且有描述的条目）。
- 状态：未绑定（调用方传了 role 而该条目无 `modelKey` → 配置错误）/ 已绑定 / 坏引用（modelKey 不可运行）。
- 副作用：仅影响显式传 role 的调用方。
- 失败：坏引用按模型引用问题报错；role 未绑定时报配置错误（不静默回落）。
- 验收：`roles` 段往返不丢（写 → 读 → 归一化后仍在，含自定义角色）；role 有绑定时子代理取到该模型；未绑定时按配置错误报出；`redact` 后仍能读回。

## 决策记录

- 2026-09-10：开发者确认「UI 先行，保证 Lab 可用，后端契约缺口记录下来，正式接入时再做」；本提案即为该缺口的整理。
- 2026-09-10：开发者拍板四条取舍（见上表）——`accepted`。解析规则据此收严：**调用方传了 role 而该角色没有绑定时按配置错误处理**，不再静默沿 profile 链取值；Project 不参与；本地模型不在本契约内。
- 2026-09-11：开发者验收角色页后要求重设计，契约随之修订三处——① **候选链下线**（UI 不再产出、配置里不留位置，建议模型只是 tooltip 提示）；② **回落语义删除**（角色之间不再互相跟随，`fallback` 概念从 UI 与契约一起消失）；③ **角色目录由写死改为可配置**（专精轴可增删），因此段形状从 `bindings: Record` 改为 `items: Array`，与 UI 的 `buildRolesSection()` 写回体逐字对齐。同日新增目标 3：条目描述即模型目录的内容。

## 未决取舍（开工前必须定）

四条取舍已由开发者拍板，2026-09-11 修订后如下：

| 取舍 | 结论 |
| --- | --- |
| 未配置的角色怎么取模型 | **必须显式绑定，否则报错**（不静默回落到 profile 链；视觉这类角色同样要求显式绑定） |
| 候选链是否本期实现运行时回退 | **候选链下线**：配置里不留字段，运行时也不做；将来要做属独立提案 |
| role 是否允许 Project 级覆盖 | **只做全局**（不动 ProjectConfigDtoSchema） |
| 本地模型是否要分类与一键模板 | **不在本契约里做**（已由 Provider 机制覆盖，模板属 Provider 页的产品工作） |

## 参考

- UI 侧唯一改写入点：`packages/neuro-book/app/components/novel-ide/settings/sections/roles/roles-settings-draft.ts`（条目种子、增删、配置问题、模型目录、写回体形状）。
- 事实依据来源：`RoleContractScout` 报告（本提案「当前行为与证据」一节的 `文件:行号` 均来自它，已抽查复核）。
