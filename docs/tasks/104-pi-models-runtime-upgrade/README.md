# Pi Models Runtime Upgrade

> Status: Implementing（核心模型发现与设置页重构已完成；Provider连接身份、凭据来源和Session脱敏已本地收口，完整Config Service/产品验收仍待完成）

## 2026-07-19：Provider连接身份与Session模型脱敏收口

- Provider Config ID现在是不可变连接身份；Base URL或proxy变化必须显式clone，不能沿用旧ID与Secret。后续交互验收确认`modelApi`只是候选补全偏好，已从连接身份中移除并允许在原Provider上直接修改。
- discovery、Provider check和Model check统一显式提交`credentialSource: provided | saved | cleared`，删除隐式读取saved Secret和默认`true`。
- 自动发现按严格hostname/子域匹配选择Adapter，cache绑定连接fingerprint，并限制并发检查数量。
- Session JSONL只持久化`{providerConfigId, modelId}`；已有明确`providerConfigId`的完整Pi Model可原子脱敏，其他旧记录不再从`model.provider`猜本地身份。无法证明时只阻断该Session，健康Session继续可读写。
- 一次性维护入口固定为`bun scripts/maintenance/migrate-session-model-refs.ts --workspace-root <root> --mapping <mapping.json> [--dry-run]`。mapping按`sessionId + entryId`明确指定`providerConfigId + modelId`，apply前验证全部映射、Global Config目标和未使用映射；不创建包含旧完整Model的backup。
- dry-run会只读报告需要迁移的Session与历史`.redaction.tmp/.bak`敏感副本；apply对所有Session逐文件原子替换，并清理已脱敏Session旁的遗留副本。临时文件在rename前显式sync，失败保持原JSONL不变。
- Provider discovery/check/model-check在`saved`连接身份的ID、Base URL或proxy不匹配时保留HTTP 400，Resolver抛错后网络Adapter调用次数为零；同一端点显式修改`modelApi`可继续复用saved Secret，discovery不再把身份错误重映射为502。
- 最终相关组合为20个文件/190项通过，另有Harness黑盒、State Root与Payload 30项、Trace/File Change 20项通过；Faux测试统一写入真实Provider Config身份，不通过放宽生产Resolver绕过新合同。
- Runtime对失效的durable model ref严格报错，不回退当前默认模型；Model Resolver是判断引用能否解析的唯一Interface。
- Provider删除先检查当前草稿，再由服务端扫描Global与全部managed Project引用；存在任一引用时阻断，不自动清空或切换默认模型。
- 本地聚焦回归与根typecheck通过；完整Config Service、真实Provider和浏览器验收仍待完成，本Task不能标记Verified。
>
> Target baseline: `@earendil-works/pi-ai@0.80.6` and `@earendil-works/pi-agent-core@0.80.6`

## 2026-08-04：OpenCode Go 请求级重试

本轮针对 OpenCode Go 偶发 `500 status code (no body)` 收口已有 Pi request options 合同。原配置为空时，OpenAI Completions adapter 的 `maxRetries` 为 `0`，因此上游一次 500 会直接结束；同一模型后续请求成功，符合上游瞬时故障而非 NeuroBook Agent turn 状态错误的特征。

- 共享 `DEFAULT_PI_MAX_RETRIES = 5` 与 `parsePiMaxRetries()` 统一校验：只接受非负整数，不设产品硬上限；未配置时运行时补 `5`，显式 `0` 继续关闭重试。
- 配置路径保持 `models.providers[].options.requestOptions.maxRetries`。服务端 `parsePiSimpleRequestOptions()` 是运行时默认入口，Agent turn、compaction、健康检查和 runtime hook 共用它；没有新增 NeuroBook 重试器，也不自动重放完整 Agent turn。
- 设置页把 `maxRetries` 从高级 JSON 拆成独立数字字段。读取旧配置时迁移展示、保存时合并回原路径；空值保存和检查按 `5` 处理，`0` 正常保留。高级 JSON 继续保留其他字段，但再次声明 `maxRetries` 会在保存、Provider check、Model check 和 discovery 发请求前明确拒绝。`maxRetryDelayMs` 是否生效由具体 Pi adapter 决定；OpenCode Go 使用的 `openai-completions` adapter 不会把它传给 OpenAI SDK。
- 保存、检查和发现请求共用 Provider request-options 合并 helper。Provider discovery 仍使用现有直接 HTTP `/models` adapter，不因本轮需求额外重写一套重试逻辑。
- `maxRetries = 5` 遵循 Pi/OpenAI SDK 语义：首次请求之外最多重试 5 次，最终最多 6 次请求；退避和 `Retry-After` 继续由 SDK 处理。当前已用本地 OpenAI-compatible HTTP server 固化 `500` 无响应体后按 `maxRetries` 重试的回归；`maxRetryDelayMs` 不会调节 OpenCode Go 这条 Completions 链路的退避，不为其他 adapter 增加通用重试层。

### 本轮验证

- 本轮复核聚焦 Vitest：设置页草稿/检查/发现/模板、共享 DTO、Pi request options、compaction、Provider health check 与 runtime resolver 共 10 个文件 90 项通过，其中包含本地 OpenAI-compatible HTTP server 的 `500` 无响应体后按 `maxRetries` 重试回归；另定向运行 Agent turn runtime-hook 用例 1/1 通过，确认最终 TurnSnapshot 收到默认 `maxRetries: 5`。
- `bun run typecheck`：通过。
- 未自动执行浏览器验收、真实 OpenCode Go 重放、构建或发布；设置页由用户手动验收。

## 2026-08-12：Provider Discovery 可靠性与兼容性收口

- 修复 OpenAI-compatible `/models` 对数字价格元数据的兼容；tokenrhythm 真实响应保持 `HTTP 200`，当前 smoke 可发现 `16` 个模型，包含 `deepseek-v4-flash`、`contextWindowTokens=1000000`、`maxTokens=384000` 和 `reasoning=true`。
- Automatic Model Discovery 现在返回稳定的 `diagnostics` 统计：`fetchedCount`、`returnedCount`、`skippedCount`、`duplicateCount`、`pageCount`、`truncated` 和 `partial`。单个坏模型不会拖垮同一页的其它可用模型；空列表和全坏列表分别返回结构化 `empty-result` / `invalid-response` 错误。
- Provider discovery 错误改用稳定错误码映射 HTTP 状态：配置错误为 `400`，上游 `401/403/429` 保留对应状态，超时为 `504`，其它上游或响应错误为 `502`；错误不会返回完整 URL、响应体、请求 Header 或 Secret。
- discovery 请求可合并用户 `requestOptions.headers`，但 adapter 的认证与协议 Header 优先；`maxRetries` 不用于发现，也不自动重试上游错误。
- Google Models Adapter 支持 `nextPageToken`，每次最多读取 `5` 页 / `5000` 条，并共享一次 `30_000ms` 总预算；达到上限会返回 `partial=true` 和 `truncated=true`，后续分页失败不会静默返回首屏结果。
- 设置页缓存发现诊断；部分结果显示 warning，完整结果继续显示 success。诊断只显示跳过、重复和截断统计，不展示 adapter、远端 URL 或认证细节。

### 本轮验证

- Provider discovery、model settings、route、DTO、前端 discovery session 和候选补全聚焦测试：`6` 个文件、`75` 项通过；覆盖通知状态、诊断失效、request options 变化作废缓存、错误码/脱敏、价格 `null`、非法能力字段、Google `5000` 条上限和总超时预算。
- `bun run typecheck`：通过。
- `bun run generate:openapi`：成功；`provider-discover` response schema 已包含完整 `diagnostics` 字段。生成器造成的 `6` 个无关 workspace-files 空白差异已清理。
- 真实 tokenrhythm Module smoke：上游 `/v1/models` 返回 `HTTP 200` 和 `16` 个模型；`deepseek-v4-flash` 解析为 `contextWindowTokens=1000000`、`maxTokens=384000`、`reasoning=true`；API Key 未进入返回值或 diagnostics。
- 本地开发服务上的真实 `POST /api/config/models/provider-discover` 已返回 `HTTP 200`，响应包含 `16` 个模型和完整 diagnostics；响应体未包含 API Key。
- 未运行浏览器验收。全仓基线独立运行：首次直接执行 `bun run test` 约 `604020ms` 后以退出码 `124` 超时；随后 verbose 基线汇总为 `497` 个测试文件（`493` 通过、`3` 个文件失败、`1` 个跳过）、`3479` 个测试（`3461` 通过、`4` 个失败、`14` 个跳过）。失败位于 workspace 临时根 sweep、Agent Harness 取消边界和 Agent variable 编译，未涉及本轮 discovery 改动；本轮不宣称全仓通过。

## 2026-08-13：Provider Discovery 协议与代理安全修复

- 代码审查复现两个 P1 问题：Bun 全局 `fetch` 不消费 Undici `dispatcher`，导致已配置 Provider proxy 的 discovery 仍直连 API Base；同时 Bun `fetch` 接受 `file:` URL，原 discovery 只做 URL 语法解析，因此可读取本地文件并把符合 Models envelope 的内容当成模型列表。
- discovery 请求边界现在只接受 `http:` / `https:` API Base 和 proxy URL；`file:`、`data:` 等协议在任何网络或文件读取前返回结构化 `invalid-base-url`。Provider 持久化 DTO 不变。
- 代理请求改用 Bun `1.3.14` 官方支持的 `fetch(..., {proxy})`，删除不生效的 Undici `ProxyAgent`、`dispatcher` 和伪清理逻辑。Product Runtime 使用 Bun `1.3.14` 启动，真实本地 smoke 使用不可解析的 `provider.invalid` 作为 API Base，结果为 `proxyHits=1`，返回 `task104-model`，证明请求由代理响应而非直连目标。
- Source Dev/Nitro 默认由 Node `24.13.0` 运行；同一进程内 `fetch(..., {proxy})` 不消费 Bun 专属 `proxy` 字段并对 `provider.invalid` 返回 DNS 失败。该结果记录为运行时边界，不在本 PR 引入第二套 Node 请求实现；Product Runtime 的 Bun 启动路径是本任务正式产品验收合同。

### 本轮自动化与产品验证

- `bun run test -- server/models/discovery.test.ts server/utils/model-settings.test.ts server/api/config/models/provider-discover.post.test.ts shared/dto/app-settings.dto.test.ts app/components/novel-ide/settings/useModelDiscoverySession.test.ts app/components/novel-ide/settings/model-draft-factory.test.ts`：`6` 个文件、`77` 项通过。
- `bun run test -- server/config/config-service.test.ts --testTimeout=120000 --hookTimeout=120000`：`1` 个文件、`60` 项通过，耗时 `64.98s`。
- `bun run generate:openapi`：成功；`provider-discover` response schema 包含完整 `diagnostics` 字段；无关 route 生成差异已恢复。
- `bun run typecheck`：首次执行因隔离 worktree 尚未安装 `desktop/electron` 依赖而报告 `58` 个依赖/类型诊断；在 `desktop/electron` 执行 `bun install --frozen-lockfile` 后重跑，Nuxt 与 Electron typecheck 均通过。
- `bun run nuxt:build`：Product Runtime Image 构建完成，`files=3250`、`bytes=136632497`；`bun run nuxt:build:raw` 也成功。
- `bun run docs:build`：成功；`git diff --check`：通过。
- Product Runtime API 真实代理 smoke：`POST /api/config/models/provider-discover` 返回 `200`，`proxyHits=1`，`fetchedCount=3`、`returnedCount=1`、`skippedCount=1`、`duplicateCount=1`、`partial=true`，返回 `task104-model`；`file:///tmp/provider` route 返回 `400` 与 `invalid-base-url`，fixture 未命中。

### 浏览器验收阻塞

- 未生成浏览器“通过”证据。真实隔离 Source Dev 与 Product Runtime 均复现：新增 Provider 后 `activeProviderKey` 已指向 `provider-1-custom` 且 `activeProvider` 已解析，但右侧仍显示“未选择 Provider”；DOM 保留 `Transition name="fade-slide" mode="out-in"` 的离场分支。
- 对比 `origin/master`，`NovelIdeModelSettingsPanel.vue` 的 Provider 新增/激活和 Transition 实现均已存在于主干；本 PR 对该文件只有 diagnostics 绑定差异。因此不在 Task 104 修复该基线 UI 问题、不生成桌面/窄屏截图或 acceptance JSON。
- follow-up Issue [#100](https://github.com/notnotype/neuro-book/issues/100) 已创建，范围是修复新增 Provider 后详情面板保持未选择。Task 104 继续保持 `Status: Implementing`，不归档、不建立“已完成” reference。
- 本轮未运行真实外部 Provider、全量测试、Docker smoke 或浏览器保存/重开链路；未使用真实 Provider、Secret、Project 或用户 State Root。

## Model Library / Provider Template / Automatic Discovery 实施结果（2026-07-18）

本轮已完成核心合同硬切：

- `server/models/model-library.ts` 与 `server/models/provider-template-library.ts` 分离 Model Library 和 Provider Template Library；旧 `catalog.ts`、Catalog route 与测试已删除，设置页改读 `/api/config/models/library` 和 `/api/config/models/provider-templates`。
- Automatic Model Discovery Module 内部维护 OpenAI/OpenRouter/Anthropic/Google Adapter，并按已知主机或必填的连接级 `modelApi` 选择单一协议；未知 Provider 不会因响应失败切换鉴权形式。实现统一限制 HTTP(S)、同 origin、禁止 redirect、timeout、流式 5 MiB 响应体上限、Bun 原生 Provider proxy 请求和错误摘要脱敏；Provider Config、DTO 与设置页不再保存或展示 Adapter/endpoint path。
- Provider Template 只复制明确精选的模型快照：MiMo Token Plan 保留 Secret-only 模型集，OpenRouter/OpenAI/Google 等普通连接模板不再把 Pi Registry 的数十或数百个模型机械写入用户配置，模型改由发现或 Model Library 显式添加。
- Model Candidate Completion Module 按字段合并远端资料与精确 ID 的 Model Library 资料，并用 `CompleteCandidate | IncompleteCandidate` 约束不完整候选不能进入 Provider Config。
- shared Provider Config Contract Module 现在校验全部已保存模型，包括 disabled 模型；`enabled` 只决定是否进入 runnable 集合。设置页文案已从“禁用模型草稿”收敛为“已停用模型”。
- 设置页“一键修复”先应用 Model Library 可验证补全，再删除仍不完整的 disabled 模型；enabled 坏模型和能力完整的 disabled 模型不会自动删除，继续交给用户编辑。
- Group 推导已集中到 `shared/models/model-group.ts`；`@cf/mistralai/mistral-small...` 统一归入 `@cf/mistralai`。
- OpenAPI meta 已重新生成，`server/api/config/**` 不再包含持久化 `defaultApi` 或 `discovery`，新请求/响应合同包含 `modelApi`。

### Plan vs Actual：`defaultApi` 改为 `modelApi`

原计划评估直接删除 Provider 级默认 API。实施中确认普通 OpenAI-compatible `/models` 无法区分 Chat Completions 与 Responses；如果完全删除连接级提示，Responses-only Provider 的发现候选只能错误猜测或永远要求逐模型重复填写。因此实际硬切为语义更窄的 `modelApi`：

- Provider Template 用 `defaultModelApi` 预填，Custom Provider 允许用户明确选择；保存后它属于普通 Provider Config，不保留 templateId。
- `modelApi` 是 Provider Config 与 Provider request draft 的必填字段，只用于 Automatic Model Discovery、手动添加和从 Model Library 添加时补全最终 `model.api`；runtime 仍只读取每个模型自己的 `model.api`，绝不回退到 Provider 字段。同一 Provider 下的已保存模型可以分别选择不同接口。
- Base URL、Secret Key 和 `/models` 响应无法可靠区分 Chat Completions、Responses 与 Anthropic Messages，程序不得通过轮换 Bearer、`x-api-key` 或查询参数来猜协议。OpenRouter Adapter 可以明确返回 `openai-completions`，Google Adapter 返回 `google-generative-ai`；普通 OpenAI-compatible Adapter 返回 `api: null`，由必填 `modelApi` 补全；用户明确选择 Anthropic Messages 后才使用 `x-api-key + anthropic-version` 调用 `/models` 并返回 `anthropic-messages`。
- provenance 新增 `provider-config`，使设置页能够区分远端明确值与连接级补全值。

### 设置页 Module 拆分实际差异

最终实现抽出 `SavedModelsList.vue`、`ModelDiscoveryDialog.vue`、`ModelLibraryDialog.vue` 和共享视图类型 Module；三个展示 Module 只消费 props 并通过 emits 把动作交还宿主。状态与行为进一步按领域拆为四个深 Module：

- `useModelSettingsDraftSession.ts`：Provider Config 草稿、Config 快照、验证、保存与引用迁移；
- `useProviderTemplateSession.ts`：Model Library / Provider Template Library 加载与模板实例化；
- `useModelDiscoverySession.ts`：Automatic Model Discovery 的前端临时结果、手动候选和独立 Model Library 会话；
- `useModelCheckSession.ts`：模型健康检查的请求、取消、批次锁和临时结果。

`NovelIdeModelSettingsPanel.vue` 从约 1980 行降至 695 行，相关 Vue 文件全部低于 800 行。Automatic Discovery Dialog 只展示本次远端发现结果，已保存模型仅用于标注这些结果的 enabled/disabled 状态，不再把未发现的 Provider 模型混入发现列表。Phase 6 门禁已经完成。

### 本轮验证

- `bun run typecheck`：通过（OpenAPI 重新生成后复跑）。
- 聚焦 Vitest：21 个文件、156 项测试全部通过，覆盖 Provider Config、DTO、Model Library、Provider Template、Automatic Discovery、安全限制、Candidate Completion、Config normalizer/service、model settings、四个前端 session Module、两个模型检查 route 和三个 Agent harness fixture。
- `bun run generate:openapi`：42 个 route meta 更新成功；审计确认 `server/api/config/**` 无 `defaultApi` / `discovery`，相关模型 route 与 Config route 已包含 `modelApi`。
- UI 拆分后 `bun run nuxt:build` 已通过；没有自动执行浏览器、Docker 或真实 Provider smoke。
- 用户已明确授权清理真实 Workspace Root `.nbook/config.json`：删除 5 条无法由 Model Library 补全的 disabled 模型，模型合同问题由 23 条降为 0；默认模型保持 `xiaomi-token-plan-cn/mimo-v2.5-pro`，其余 Provider Secret 配置状态保持完整。

## 2026-07-19：Provider Model API 可编辑修复

- 真实设置页验收发现所有已保存 Provider 都携带 `sourceIndex`，而主表单把 `modelApi` 绑定为 `sourceIndex !== undefined` 时禁用；与此同时 Config Service 与 saved credential resolver 也把 `modelApi` 计入不可变连接 fingerprint，导致旧 Provider 缺少必填默认接口时无法修复。
- 合同纠正为：Provider Config ID、Base URL 与 proxy 继续构成不可隐式迁移的连接身份；`modelApi` 是可编辑的候选协议偏好，不修改已有模型自己的 `model.api`，也不参与 runtime 解析。
- Config 保存允许同一 `sourceIndex` 更新 `modelApi`并保留原 Secret；临时 discovery/check 请求在端点身份不变时也允许新 `modelApi` 复用 saved Secret。Base URL、proxy 或 ID 变化仍返回 400，且不调用网络 Adapter。
- Automatic Discovery 现在在发请求前冻结请求体、凭据来源和 fingerprint，避免请求期间修改 `modelApi` 后把旧协议响应绑定到新协议缓存。
- 一键修复新增确定性 Provider 默认接口补全：只有同一 Provider 的每个已保存模型都声明同一种受支持 `model.api` 时才补全；空模型、缺失/未知 API 或混合 API 不猜测。真实 Global Config 只读审计显示 10 个 Provider 缺失默认接口，其中 8 个满足确定性补全，`doubao` 无模型、`elysiver-opensource` 为混合 API；本轮未写真实配置。
- 实际计划差异：原方案曾建议把所有协议变化都强制 clone；交互验收证明这会阻断新必填字段的正常修复。实现没有放宽端点或 Secret 安全门禁，只移除了错误耦合的候选偏好。
- 验证：`bun run typecheck` 通过；模型设置、连接身份、凭据、discovery 与三个模型 route 聚焦 13 个文件、55 项通过；Config Service 的默认接口更新/Secret 保留、端点不可变、sourceIndex 与缺失默认接口 4 项通过；`bunx nuxt build --dotenv .env` 通过。Config Service 整文件仍只出现 Vitest header、没有可信汇总，因此不计为全量通过。

## Historical contract correction（2026-07-14，已被 2026-07-18 合同覆盖）

> 本节保留 2026-07-14 的历史实施记录。其中 `Catalog`、`defaultApi` 和不完整 disabled draft 相关描述不再是当前合同；当前实现以上述 2026-07-18 实施结果和后文重构合同为准。

本轮审查把产品心智模型收敛为三个概念：

- **NeuroBook Catalog**：只读维护数据，包含 Provider 创建预设和按精确 model ID 唯一索引的标准模型能力。只服务设置页，不参与 runtime。
- **Provider Config**：用户保存的完整运行快照，包含连接信息和 Provider 内每个模型的完整能力。它是 runtime 唯一真相源。
- **Session Model Selection**：只保存 `providerId/modelId`；每次 invocation 从当前 Provider Config 重新解析，运行中冻结。

Discovery 结果、模型草稿、Pi `Models` 和 invocation binding 都是内部实现，不作为产品层独立概念。

Provider Config 的默认 API 字段正式命名为 `defaultApi`。它只用于创建/发现新模型草稿；启用模型必须把最终 API 保存到 `model.api`。runtime 不从 `defaultApi` 回退、不查询 Catalog、不猜 API。

当前 Global Config 不自动应用 Catalog，也不自动禁用或改写坏模型。设置接口返回字段级 `validationIssues`，用户可以在设置页显式“重新应用 Catalog”、手工补齐或禁用模型。当前配置 audit 已确认旧数据存在未完成能力快照；这不是 Catalog 缺失，而是用户配置尚未显式保存 Catalog 能力。

模型错误现在区分“缺少 Pi API”和“Pi API 不受支持”，并携带 Provider/model 与具体字段，避免把配置缺失误报成 Provider 不可用。

实施验证结果：模型/Config/Catalog/DTO 聚焦测试通过，`bun run typecheck` 与 `bun run nuxt:build` 通过。当前 Global Config 只读 audit 返回 99 条字段问题，来自 21 个仍处于旧能力快照的启用模型；实现按已锁定合同没有自动修改这些数据。完整 `bun run test:agent` 仍有 12 个既有失败，集中在 profile 编译协调、变量 manifest、RP/资产 profile 和 payload 测试的超时链路，本轮未顺手处理。浏览器、Docker 和新的真实 Provider 重放未执行。

## Relative documents refs

- [Task 02 Pi Agent Harness Migration](../02-pi-agent-harness-migration/README.md)
- [Task 03 Config System](../03-config-system/README.md)
- [Task 86 Pi Request Observability](../86-pi-request-observability/README.md)
- [Pi Agent Harness Research](../../research/pi-agent-harness.md)
- [Project Status](../../../PROJECT-STATUS.md)
- [Pi v0.75.4...v0.80.6](https://github.com/earendil-works/pi/compare/v0.75.4...v0.80.6)
- [Pi old global API migration](https://github.com/earendil-works/pi/blob/v0.80.6/packages/ai/README.md#migrating-from-the-old-global-api)

## User Request / Topic

- 将 NeuroBook 当前锁定的 Pi 依赖从 `0.75.4` 系统性升级到 `0.80.6`。
- 不通过 `@earendil-works/pi-ai/compat` 留下临时兼容层。
- 方案必须基于真实调用面，不脱离现有 Config、Agent Harness、Provider 多实例和 Product 打包结构。
- 不用 hack 绕过新版 Provider 所有权模型，不破坏类型系统，不留下待清理的双轨运行时。
- 不顺手扩张成 Pi OAuth、Pi CredentialStore 或 Pi 高层 AgentHarness 重构。
- 重要产品边界或体验取舍在实施前交给用户决策。

## Post-implementation hardening audit（2026-07-12）

首轮实施完成后的全链路审查确认主体迁移可运行，但发现以下合同缺口，本任务重新打开并在原 walkthrough 内收口，不新建碎片任务：

- runtime 选择只检查显式 API override，导致 `providerConfigId !== model.provider` 且 API 继承 registry 的本地连接误走共享 builtin runtime。
- Agent turn、compaction 与健康检查各自维护 request options 白名单，且会静默丢弃配置字段。
- Pi `streamSimple` 不会转发任意 API 专用 options；正式合同收紧为 `0.80.6` 中已确认实际生效的 JSON-safe simple options，未知或 runtime-owned 字段明确失败。
- 自定义 OpenAI-compatible 空 API key 需要在 NeuroBook/Pi 边界显式适配无认证端点；Bedrock API key 需要映射为 `AWS_BEARER_TOKEN_BEDROCK` provider env。
- app logger 已有独立日志脱敏，原始 `Error` cause 不是已确认泄漏；真正缺口是 Provider sanitizer 与日志脱敏规则分裂，以及 `sidecar_error` SSE 直接暴露原始错误文本。
- 价格覆盖数据合同已完成，但继承状态尚未展示 registry 的实际基础价格与 tiers 摘要。

本轮冻结语义沿用 Task 18：单个 RunFrame 及其 turn/tool loop/compaction/sidecar 使用同一 binding；waiting/resume 沿用同一逻辑 `invocationId`，但 resume 重新进入 `prepareRun` 并读取当前配置。`Models`、API key 和 request options 不跨进程持久化。

### Hardening implementation results

- runtime 选择已收敛为唯一分类函数：只有正式 builtin 配置（`providerConfigId === model.provider`、无显式 API override、builtin Provider 支持 resolved API）复用进程级 `Models`；本地同类连接、override、未知 Provider 或 builtin 不支持的 API 均创建 invocation 私有 runtime。
- 新增共享 `PiSimpleRequestOptionsSchema` 与统一解析器，Agent turn、sidecar、自动/手动 compaction、健康检查和 runtime hook 共用同一合同。请求 schema 接受 `temperature`、`headers`、`websocketConnectTimeoutMs`、`maxRetries`、`maxRetryDelayMs`、`metadata`、`env`、`transport`、`cacheRetention`、`thinkingBudgets`；未知、类型错误、runtime-owned 或 Pi `streamSimple` 不会转发的字段均明确失败。字段是否实际生效仍由 adapter 决定，OpenCode Go 的 `openai-completions` 只把 `maxRetries` 传给 SDK。
- 自定义 OpenAI completions/responses 在 API key 为空时使用仅存在于当前请求内的 no-auth 占位 key，以兼容无认证端点；Bedrock API key 映射到 `AWS_BEARER_TOKEN_BEDROCK` provider env，空 key 保留 AWS ambient credential chain。Anthropic、Google 等 adapter 的无 key 行为保持明确失败。
- app logger 与 Provider error sanitizer 共用无副作用的敏感文本清洗底座；Bearer、Basic、authorization、cookie、set-cookie、API key、token、secret 和常见裸 `sk-*` 均覆盖。Provider 错误继续执行 4,000 字符上限，`sidecar_error` SSE 也只发送清洗后的文本。
- 模型设置父组件继续作为 Pi catalog/effective metadata 的唯一解析者；Dialog 在继承状态展示四项实际价格和逐 tier 摘要，registry 缺失时明确显示无可用继承价格，不再用 0 冒充继承值。
- 未增加第二套 Provider seam、测试生产后门、持久化 runtime binding 或兼容分支；Faux 测试仍通过正式 runtime resolver 注入 suite 私有 `Models`。

### Dynamic pricing catalog fix（2026-07-12）

- 实际设置页请求发现 Pi `0.80.6` 的 `openrouter/openrouter/auto` 使用 `input/output = -1000000` 表示动态/未知价格，原 catalog DTO 将其误判为用户价格并使整个 `/api/config/models/pi-catalog` 返回 500。
- 新增统一 Pi registry 价格 normalizer：只有基础价格和全部 tiers 均为有限非负数、threshold 为不重复非负整数时才作为可继承价格输出；动态/未知价格在 catalog 中投影为 `null`，模型本身继续保留。
- runtime resolver 复用同一 normalizer。没有用户完整价格覆盖时，无效 registry 价格归零，避免 Pi `calculateCost()` 把负哨兵写入 usage；用户保存的自定义价格合同仍严格要求有限非负数，没有放宽 Config 校验。
- 模型编辑 Dialog 对 `null` 价格显示“没有稳定价格/可能使用动态定价”，点击自定义价格会进入空的完整价格草稿，不把未知价格伪装为继承 0。

### Custom model metadata / maxTokens incident（2026-07-12）

session 518 的 trace 证明升级后仍有一条未收口合同：本地连接 `mimo` 下的 `mimo-v2.5-pro` 没有保存 `model.provider`，因此 runtime 将本地连接 ID 误作 Pi metadata Provider，registry lookup 失败后猜测 `openai-completions`、`contextWindow = 256000` 和 `maxTokens = 256000`。Pi `0.80.6` 的 `streamSimple()` 与 `0.75.4` 不同，会默认采用 `model.maxTokens` 并按当前上下文 clamp，最终实际发送 `max_completion_tokens = 211884`，被同一 endpoint 以 400 拒绝。

本轮重新打开 Task 104，锁定以下修正合同：

- `providerConfigId` 只表示本地连接；`model.provider` 只表示 Pi registry metadata 来源，设置页必须把二者明确区分。
- registry metadata 解析、纯自定义模型校验、compat、价格和 limits 必须只有一个服务端实现，Harness 与健康检查不得继续复制逻辑。
- 纯自定义模型不再猜测 API、base URL、context window 或 max output tokens；用户已决定四项均必须显式填写，且 `maxTokens <= contextWindowTokens`。
- 显式指定 metadata Provider 但对应 model 不存在时明确失败，不降级为纯自定义模型。
- session 持久化模型选择 key；每次新 invocation 按当前配置重新解析完整 metadata。同 key metadata 变化时追加 `model_change`，invocation 开始后仍保持冻结。
- 当前 `mimo/mimo-v2.5-pro` 连接应绑定 `xiaomi-token-plan-cn` metadata；不直接改写 session 518 历史，下一次 invocation 通过 reconcile 追加修正后的模型。

实施结果：

- 新增唯一纯函数 `resolvePiModelMetadata()`，Harness、模型健康检查和保存校验共用同一解析边界。`providerConfigId` 只定位本地连接；只有显式 `model.provider` 才绑定 Pi registry，空值始终表示纯自定义，不再按本地连接 ID 隐式猜 metadata。
- registry 绑定会继承 API、reasoning、input、context window、max tokens、headers、compat 与价格，同时保留本地连接的 API key、base URL 和 request options。显式来源缺少对应 model 时直接报配置错误。
- 纯自定义模型必须由模型或本地连接显式提供受支持 API 与 base URL，并由模型显式提供 context window、max tokens；limits 缺失或 `maxTokens > contextWindowTokens` 均在保存、健康检查和运行前明确失败。
- 模型设置 Dialog 已将 metadata 来源改为 catalog 候选选择器。catalog/远程发现只有唯一候选时自动绑定；无候选或多候选时打开编辑器，不按 URL、名称或 model ID 跨 Provider 猜来源。继承价格和 limits 也只读取显式来源。
- session invocation reconcile 改为按 `providerConfigId + model.id` 从当前配置刷新完整 metadata，并用深比较控制 `model_change`；手动 compaction 同样先 reconcile。RunFrame 创建后仍冻结完整 binding。
- 当前 `workspace/.nbook/config.json` 中 `mimo/mimo-v2.5-pro` 已绑定 `xiaomi-token-plan-cn`。session 518 历史未改写，也未使用真实凭据重放。

### Provider Preset / Model Catalog / unified runtime redesign（2026-07-13）

对 metadata 绑定实现进行全链路审查后，确认 `model.provider` 同时承担本地 runtime Provider、Pi registry 来源和 catalog 候选身份，仍会造成端点回退、同名模型歧义和 catalog 快照语义漂移。本轮按用户重新确认的产品模型硬切：

- NeuroBook 维护只读 Provider Preset 与按 model ID 唯一的标准 Model Catalog；它们只服务设置页创建/编辑，不进入 invocation runtime。
- 用户 Provider Config 是完整、自包含的运行真相源。Provider 保存本地连接和发现 Adapter；模型在 Provider Config 内保存完整 API、能力、limits、价格和 compat。
- 删除模型级 `provider` / `baseUrl`。resolved Pi model 的 `provider` 永远是本地 Provider Config ID，Base URL 永远来自本地 Provider Config。
- 所有 Provider Config 都使用独立 `createModels() + createProvider()`，删除 builtin/custom 双轨 runtime。
- 模型发现结果只存在前端。远程 metadata 完整时直接使用；不完整时按精确 model ID 用 NeuroBook Model Catalog 的完整能力块替换；Catalog 缺失时保持禁用，用户手工补齐后才能启用。
- Model Catalog 从 Pi `0.80.6` 生成唯一 canonical 条目，使用固定 Provider 来源优先级；compat/headers 按 Pi API 保存。MiMo `max_tokens` 修正改为 `model ID + API` catalog patch，不再按 Xiaomi CN Provider 写 runtime 特例。
- Catalog 中有效价格复制到所有 Provider 的模型草稿，这是用户明确锁定的产品合同。
- session 继续只以 `providerConfigId + model.id` 作为稳定选择；新增可序列化 canonicalizer，避免 `undefined` 在 JSONL round-trip 后制造重复 `model_change`。

## Goal

将 NeuroBook 的 Pi LLM 边界从 `0.75.4` 的全局 API 完整迁移到 `0.80.6` 的 `Models + Provider` 模型，验证内置 Provider、自定义 OpenAI-compatible Provider、同类 Provider 多连接、Agent turn、compaction、模型健康检查、请求观测和 Product runtime 均可工作；同时完整承接 `max` thinking 和长上下文价格 tier。迁移完成后，生产代码和测试不得导入 `/compat`，不得继续依赖全局 provider registry，旧 API guard 必须阻止回归。

如果新版 Provider API 无法在不破坏当前“Global Config 是 Provider 真相源、invocation 固定配置快照、同类 Provider 可多连接”的前提下表达需求，则停止实现，记录最小复现、受影响边界和可选设计，交由用户决策，不以类型断言或隐藏分支绕过。

## Success Criteria

- `package.json` 与 `bun.lock` 中两个 Pi 包版本一致，固定为经本任务审计的目标版本。
- 生产代码不再使用以下旧全局 API：
  - `stream` / `streamSimple` / `complete` / `completeSimple`
  - `getModel` / `getModels` / `getProviders`
  - `registerApiProvider` / `registerFauxProvider`
- 全仓不得导入 `@earendil-works/pi-ai/compat`。
- Provider catalog 使用新版内置 catalog，能暴露 Ant Ling、NVIDIA、Z.AI Coding CN 等 `0.80.6` 实际正式显示名。
- 同一个 Pi Provider 的两份本地连接使用各自 API key/base URL，不串配置、不共享错误状态。
- 自定义 OpenAI-compatible Provider 仍能使用当前 Config 中的 `api`、`baseURL`、headers、timeout、reasoning 和 compat 配置。
- `max` thinking 能通过 DTO、配置、session command、前端选择器和 provider request 全链路传递。
- `cost.tiers` 不会在 catalog、Config、模型解析或费用计算过程中丢失。
- Faux 测试使用实例化 `Models`，测试之间没有全局 provider registry 污染。
- Pi trace 继续捕获 payload、响应元数据和 TTFT，但新版错误响应正文经过统一清洗和长度限制。
- Nitro build、Docker runtime 和 Windows Portable 均包含新版 Pi 运行依赖闭包。

## Non-goals

- 不把 NeuroBook Agent 主循环替换成 Pi `Agent` 或高层 `AgentHarness`。
- 不迁移 NeuroBook JSONL session、approval、sidecar、linked agent 或 Profile DSL 语义。
- 不在本任务加入 Pi OAuth 登录 UI、订阅 Provider 登录或持久化 `CredentialStore`。
- 不重做模型设置页整体布局。
- 不为了理论上的 bundle 最小化，为每个 Provider 建立一套手写动态 import 框架。
- 不保留旧/新两套 Pi runtime 供配置切换。
- 不使用 `/compat` 作为“先升级再说”的中间正式状态。

## Current State

### Dependency baseline

- `package.json`：
  - `@earendil-works/pi-agent-core: ^0.75.4`
  - `@earendil-works/pi-ai: ^0.75.4`
- `bun.lock` 实际锁定两个包为 `0.75.4`。
- `^0.75.4` 在 `0.x` semver 下不会跨越到 `0.76.0`，因此当前不会自动获得后续 Provider/model 更新。
- 当前开发机：Node `24.13.0`、Bun `1.3.14`；Pi `0.80.6` 要求 Node `>=22.19.0`，运行时版本不是当前阻塞项。

### Production API usage

旧全局 API 的生产调用集中在四个边界：

1. `server/agent/observability/traced-provider.ts`
   - 统一包装 `streamSimple` / `completeSimple`。
   - Agent turn 与 compaction 都经过该入口。
2. `server/agent/harness/model-resolver.ts`
   - 从 Global/Project effective config 解析具体 Pi `Model`。
   - 使用 `getModel()` 继承 Pi catalog metadata。
   - 用 `providerConfigId` 区分本地 Provider 实例与 Pi Provider ID。
3. `server/utils/model-settings.ts`
   - Provider/model 健康检查。
   - 内置模型目录 metadata 合并。
4. `server/api/config/models/pi-catalog.get.ts`
   - 返回设置页可添加的内置 Provider/model catalog。

其他生产文件主要消费 Pi message/event/tool/type，不直接依赖旧全局 registry。

### Test usage

- 当前至少 9 个测试文件使用 `registerFauxProvider()`。
- Faux provider 注册在全局 registry，测试需要手工 unregister。
- 新版推荐 `fauxProvider() + createModels() + models.setProvider()`，应借升级消除全局可变测试状态。

### Existing NeuroBook invariants

- Global Config 是 Provider/API key 真相源；Pi `auth.json` 不是 NeuroBook 运行时配置源。
- Project Config 只能覆盖默认模型/Profile 模型参数，不能覆盖 Provider 列表/API key。
- invocation 开始时冻结 effective config；运行中保存配置只影响后续 invocation。
- Session 持久化具体模型选择，但不得持久化 Provider 函数对象或 `Models` 实例。
- 一个 Pi Provider 可以在 Global Config 中添加多份本地连接。
- `providerConfigId` 负责定位本地 API key；`model.provider` 当前表达 Pi Provider 类型。
- Agent turn、compaction 和健康检查必须走统一可观测入口。
- Product 构建通过 `patch-nitro-runtime-deps.mjs` 复制 runtime package dependency closure。

## Upstream Changes Relevant to NeuroBook

### Breaking API change

- `0.80.0` 将旧全局 API 移出包根入口。
- `/compat` 只用于迁移，官方明确会在未来删除。
- 新主路径是 `Models` collection 持有 Provider，由 Provider 拥有 model catalog、auth 和 stream 行为。

### Model and Provider changes

- 新增 Ant Ling、NVIDIA NIM、ZAI Coding Plan (China)。
- `zai` 显示名改为 ZAI Coding Plan (Global)。
- 新增 Claude Opus 4.8、Claude Fable 5、Claude Sonnet 5、GPT-5.6 系列等 metadata。
- OpenAI 默认模型、上下文窗口、reasoning metadata 和 Codex transport 有多轮调整。

### Contract changes

- Thinking level 新增 `max`。
- Model cost 新增 request-wide `tiers`。
- Provider HTTP error 开始包含响应正文。
- `Usage.reasoning` 可记录 provider 返回的 reasoning token。
- Provider-scoped `env`、request auth、headers 与 timeout 行为增强。
- Streaming content block 允许交错；NeuroBook 已按 `contentIndex` 合并，当前方向正确。

## Target Architecture

### 1. Static catalog and runtime execution are separate

- 内置 Provider/model 目录只读使用 `getBuiltinProvider(s)` / `getBuiltinModel(s)` 或等价新版 catalog API。
- Catalog API 不依赖当前用户 API key，也不创建业务配置。
- Runtime streaming 不再通过 catalog 静态函数隐式调度，必须由明确的 `Models` 实例执行。

### 2. Resolve a runtime binding, not only a Model object

模型解析结果从单一 `ResolvedPiModel` 扩展为运行时 binding，概念形态：

```ts
type PiModelBinding = {
    model: Model<Api>;
    models: Models;
    providerConfigId: string;
    apiKey?: string;
    timeoutMs?: number;
    requestOptions: Record<string, JsonValue>;
};
```

边界要求：

- `Models` 是当前进程内运行对象，不进入 session JSONL、DTO 或 Config。
- Session 继续保存可序列化的具体模型和本地 model key。
- invocation frame 持有 binding；同一次 turn、tool loop 和 compaction 使用同一冻结配置来源。
- `traced-provider` 接收 `Models` 或 binding，不能再自行读取 Global Config。

最终类型名以实现时现有领域语言为准，不为了与示例一致额外造层。

### 3. Built-in Provider execution

- 内置 Provider 使用 Pi 官方 provider factory 或 `builtinModels()` 注册结果。
- NeuroBook 仍显式传入 Config 中解析出的 `apiKey`、base URL、headers、timeout 和 request options。
- 对同一个 Pi Provider 的多份本地连接，调用时使用各自冻结的 binding；不得把 API key 写入共享 Provider 对象。
- `model.provider` 保持 Pi 可识别的 Provider ID；本地连接身份继续由 `providerConfigId` 表达。

### 4. Custom Provider execution

- 自定义 Provider 使用 `createProvider()` 注册到独立 `Models` collection。
- 当前支持的 Pi API adapter 必须形成显式、类型化的 API 映射；遇到未知 API 直接返回配置错误。
- 不以 `as any` 把任意字符串塞进 Provider API map。
- `baseURL` 和 compat 继续以最终 resolved model 为准。
- 一个 custom binding 只服务当前冻结配置；不建立可变的进程级 custom provider registry。

### 5. Observability remains the single provider call seam

- `tracedStreamSimple` / `tracedCompleteSimple` 保留为业务统一入口。
- 它们改为委托 `models.streamSimple()` / `models.completeSimple()`。
- `onPayload`、`onResponse` 合并语义不变。
- Provider error body 进入 trace 前统一：
  - 清除 bearer/API key/secret/cookie 等显著凭据。
  - 设置合理字符上限。
  - 明确标注截断。
- 不在多个 caller 各自复制清洗规则。

### 6. Test runtime is instance-scoped

- 建立小型 test fixture，返回 `faux` handle、`Models` 和 model。
- 每个测试或测试 suite 独立创建实例。
- Harness/compaction/trace 测试通过正常依赖注入传入 `Models`，不提供“测试专用全局后门”。
- 删除所有 `registerFauxProvider()` / `unregister()` 全局注册模式。

## Design Constraints

- 不改变 Task 03 的配置分层和 secret 语义。
- 不让 Provider runtime 反向读取前端草稿或未保存 Config。
- 不把 API key 放进 model、session entry、trace request context 或错误日志。
- 不让 catalog 请求触发 OAuth、远程模型刷新或 Provider 网络请求。
- 不把 runtime binding 混入 shared DTO。
- 不为只调用一次的简单转换过度抽函数；真正复用的 Provider 构造、API 映射和错误清洗才建立公共边界。
- 不重新实现 Pi 已提供的 Provider/model catalog、cost calculation、thinking clamp 或 auth option 合并。
- 遇到 Pi 新类型无法表达现有自定义 Provider 能力时停止并报告，不使用 `unknown`/`any` 隐藏设计问题。

## Decisions / Discussion

### D1 — Upgrade strategy

Decision: 直接迁移到新版 `Models` API，不使用 `/compat`。

Reason:

- `/compat` 已声明未来删除。
- NeuroBook 已有统一 provider seam，迁移范围可控。
- 使用 `/compat` 只会把同一迁移推迟并形成双重测试成本。

### D2 — Runtime ownership

Decision: NeuroBook 拥有 `Models` runtime binding；Pi 不读取 NeuroBook Config。

Reason:

- Config snapshot、Provider 多实例和 Project override 是 NeuroBook 领域规则。
- Pi Provider 负责协议和 stream，不负责决定当前 Project 使用哪个本地连接。

### D3 — No Pi OAuth in this task

Decision: 本任务继续只使用 NeuroBook Global Config 中的 API key/endpoint，不接入 Pi OAuth、订阅登录或持久化 CredentialStore。

Reason:

- OAuth 是独立的产品、存储和交互设计。
- 它不是完成依赖升级的必要条件。
- 把 OAuth 混入本任务会显著扩大设置页、secret storage 和 refresh lock 范围。

### D4 — Cost tier editing surface

Decision: 本轮完整支持 `cost.tiers` 的读取、保存、继承、运行时计算和逐 tier 可视化编辑。

Reason:

- 数据不丢失和费用正确是升级必须项。
- 用户需要在模型编辑 Dialog 中直接新增、删除和修改 tier，避免必须手工编辑配置文件。
- 价格覆盖采用原子完整覆盖：`cost: null` 完整继承 Pi registry；启用覆盖时复制当前有效基础价与 tiers；覆盖状态下四个基础价格全部必填；恢复继承时一次清除基础价和全部 tiers。
- tier threshold 必须唯一、保存时升序排列，并保持 Pi 的“input tokens 严格大于 threshold”匹配语义。

### D5 — Custom API support

Decision: 自定义 Provider 只允许 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 和 `bedrock-converse-stream`。

Reason:

- 新版 Provider API map 是显式协议合同，不应继续接受无法验证的任意字符串。
- 历史未知值可以读取，但保存或运行时必须明确报“不支持的 Pi API”，不得猜测或回退。
- 设置页移除任意 API 字符串输入，改为受支持 adapter 的有限选择。

### D6 — Version selection

Decision: 本任务按 `0.80.6` 精确版本实施，不使用浮动 `latest` 或 caret 范围。

If implementation begins after a newer Pi release exists, first append a delta audit to this task; do not silently change target.

## Implementation Plan

### Phase 0 — Baseline and contract tests

- 记录 `0.75.4` 当前聚焦测试结果，避免升级后把既有失败误判为回归。
- 为以下现有行为补最小契约测试，只补当前缺口：
  - 同一 Pi Provider 的两份本地连接分别解析 API key。
  - 自定义 provider base URL/model compat 保留。
  - catalog 不读取 secret、不发网络请求。
  - invocation 内配置冻结。
- 不为简单类型重导出增加无价值快照测试。

### Phase 1 — Upgrade dependencies and migrate the runtime as one compile batch

- 使用 Bun 同时安装两个 `0.80.6` 精确版本，不单独升级其中一个包。
- 在现有 `server/agent` / `server/utils` 边界中选择一个唯一归属位置建立 runtime binding。
- 依赖升级、runtime 适配和首批调用迁移必须作为同一可编译批次完成；`Models` 在 `0.75.4` 不存在，不能先基于旧依赖实现新版 binding。
- 审查 lockfile 中新增的 runtime dependencies，重点包括 `@opentelemetry/api`、`@smithy/node-http-handler` 和 Mistral SDK。

- 将 builtin catalog lookup、builtin runtime provider lookup、custom provider creation 收敛到该边界。
- 建立受支持 API adapter 的显式映射和错误类型。
- 修改 model resolver 返回 model + runtime executor/binding。
- 保持 session DTO 与 JSONL 序列化结构不含运行时对象。

Exit criteria:

- 新依赖下 runtime resolver、traced provider 和至少一个调用入口可编译。
- 没有第二套平行业务入口，也没有 `/compat` 过渡层。

### Phase 2 — Migrate streaming and observability

- `traced-provider` 改用 `Models` 实例方法。
- Agent turn、compaction、健康检查统一传 binding。
- 保持事件迭代、`result()`、abort、TTFT、payload hook 语义。
- 增加 provider error body 清洗与截断测试。
- 更新 unified entry guard：禁止旧全局调用和 `/compat`。

Exit criteria:

- 生产 provider call 只存在一个入口。
- trace 开/关两种模式行为一致。

### Phase 3 — Migrate catalog and model metadata

- Catalog API 切到新版 builtin catalog。
- Provider name 使用官方显示名，不再固定等于 ID。
- 新 Provider 自动进入设置页 preset。
- 模型合并保留：
  - `thinkingLevelMap`
  - `cost.tiers`
  - compat
  - input/context/maxTokens
- 检查被 upstream 删除的 model alias 不会作为新配置继续加入。
- 已保存的历史 model ID 不做 silent rewrite；失效时沿用 Task 03 的明确 fallback/error 语义。

### Phase 4 — Extend NeuroBook contracts

- `ThinkingLevelSchema` 增加 `max`。
- 同步 session command、DTO、Config types、设置 UI、Composer、翻译和测试。
- Model cost 类型增加 tier；同步：
  - shared DTO
  - config types/normalizer/serializer
  - catalog DTO
  - model resolver merge
  - model settings save/restore
  - cost display/calculation consumers
- 检查 `Usage.reasoning` 是否需要在 DTO/trace/UI 中保留；没有消费者时允许只透传 Pi message，不新增装饰 UI。

### Phase 5 — Migrate Faux tests

- 用 `fauxProvider()` 建立实例化 fixture。
- 迁移现有 9 个全局 faux suite。
- 测试并行运行时不得互相消费 response queue。
- 删除旧 unregister 清理逻辑和全局 registry reset。
- 保留黑盒 Harness、compaction、trace、tool loop 的现有断言强度。

### Phase 6 — Integration cleanup

- 解决剩余真实类型错误，不通过全局 module augmentation 或宽泛类型断言压制。
- 更新 guard，禁止生产代码导入 `/compat` 或调用旧全局 registry API。
- 检查 package subpath exports 在 Nuxt/Nitro 中的解析。

### Phase 7 — Verification and packaging

按风险从小到大验证：

1. Pi runtime/model resolver/catalog 单测。
2. Faux provider、traced provider、compaction 聚焦测试。
3. Agent Harness 聚焦测试。
4. Agent/server 相关全量测试。
5. `bun run typecheck`。
6. `bun run nuxt:build`，确认 Nitro runtime vendor closure。
7. Product stage / Windows Portable packaging smoke。
8. Docker build smoke。
9. 用户批准后进行真实 Provider smoke；不自动浏览器验证。

真实 Provider smoke 至少覆盖：

- 一个官方内置 API-key Provider。
- 一个自定义 OpenAI-compatible endpoint。
- 同类 Provider 两份本地连接。
- 一次有 thinking 的流式回复。
- 一次 tool call。
- 一次 compaction。
- 单模型健康检查与取消。
- trace 开启/关闭各一次。

## Expected File Impact

核心生产文件：

- `package.json`
- `bun.lock`
- `server/agent/harness/model-resolver.ts`
- `server/agent/observability/traced-provider.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/compaction.ts`
- `server/utils/model-settings.ts`
- `server/api/config/models/pi-catalog.get.ts`
- `shared/dto/app-settings.dto.ts`
- `shared/dto/agent-session.dto.ts`
- `server/config/types.ts`
- `server/config/normalizer.ts`
- 模型设置和 Agent Composer thinking 选项相关 Vue/i18n 文件
- `scripts/build/patch-nitro-runtime-deps.mjs`（仅当验证证明现有闭包复制不足时修改）

测试文件：

- `server/utils/model-settings.test.ts`
- `server/agent/observability/traced-provider.test.ts`
- Harness/compaction/file-change/subject-memory 中使用 Faux provider 的测试
- catalog、config normalizer、session command 相关测试

不得因为升级顺手修改无关 Agent/Profile/Plot/World Engine 代码。

## Verification Matrix

| Surface | Required evidence | Main regression protected |
| --- | --- | --- |
| Built-in catalog | catalog API test | Provider/model 更新可见，正式名称正确 |
| Local Provider multi-instance | resolver/runtime test | API key/base URL 不串线 |
| Custom Provider | stream smoke with local faux API | 自定义 OpenAI-compatible 不失效 |
| Thinking | DTO + resolver + request payload test | `max` 不被 schema/UI 丢弃 |
| Pricing | catalog/config round-trip + cost test | `cost.tiers` 不丢失，长上下文费用正确 |
| Streaming | traced provider tests | 事件、abort、result、TTFT 不回归 |
| Agent turn | Harness faux tests | tool loop、approval、sidecar 不受影响 |
| Compaction | compaction faux tests | summary 仍用冻结模型配置 |
| Error safety | sanitizer tests | Provider response body 不泄露凭据/无限落盘 |
| Runtime packaging | Nuxt/Product/Docker smoke | lazy provider modules 和依赖闭包完整 |
| Real provider | approved smoke | SDK/协议真实兼容性 |

## Rollout / Failure Policy

- 本项目快速开发，不保留旧 runtime feature flag，也不做数据双写。
- 实施分阶段提交补丁，但主分支最终状态必须一次性切到新版 Models API。
- 如果某阶段发现 upstream API 缺陷：
  1. 先写最小复现。
  2. 判断能否通过官方公开扩展点表达。
  3. 不能表达时停止，报告 upstream 限制和候选方案。
  4. 不复制 Pi 内部私有实现，不 monkey patch package，不修改 `node_modules`。
- 依赖升级失败时可在未发布前恢复 task 分支，但不在生产代码保留旧版本 fallback。

## Risks

### High

- Custom Provider 的 Provider/API ownership 与当前任意 `Model` 分发方式不同。
- 同一 Pi Provider 多本地连接如果错误共享 auth 状态，会造成凭据串线。
- `cost.tiers` 若只改类型、不改 resolver merge，会继续静默丢失。
- Faux 测试若部分保留全局 registry，会形成难定位的并行污染。

### Medium

- Provider error body 进入 trace/session/log 的隐私风险。
- Nitro 对新版 package subpath/lazy module 的 externalization。
- 新增 Provider 和被删除 model alias 对已保存配置的影响。
- `max` thinking 对旧前端 exhaustive switch 和 DTO 的影响。

### Low

- `pi-agent-core` 当前使用的事件、工具类型和 token estimate 根导出仍存在。
- 当前前端已按 `contentIndex` 处理交错 streaming block。
- Node/Bun 版本满足要求。

## Initial Research Walkthrough

- 确认当前依赖与 lockfile 均为 `0.75.4`。
- 阅读 `v0.75.4` 至 `v0.80.6` release/change log。
- 对比新版 provider catalog，确认新增 Ant Ling、NVIDIA NIM、ZAI Coding Plan (China)。
- 阅读新版 `pi-ai` README 的旧全局 API 迁移说明。
- 定位 NeuroBook 4 个生产旧 API 边界和 9 个 Faux 测试文件。
- 确认 Task 03 的 Config snapshot/multi-provider/secret 规则必须保持。
- 确认 Task 86 的 traced provider 是正确的统一迁移 seam。
- 确认当前 `ThinkingLevelSchema` 缺少 `max`。
- 确认当前 Model cost DTO/resolver 会丢弃 `tiers`。
- 确认当前 streaming projection 已覆盖 content block 交错。
- 确认 Product runtime dependency closure 设计上可递归复制新增依赖，但仍需真实构建验证。

## Plan vs Actual

- 依赖已精确升级到 `@earendil-works/pi-ai@0.80.6` 与 `@earendil-works/pi-agent-core@0.80.6`；`package.json` 不使用 caret，`bun.lock` 锁定同版本。
- 新增唯一 `pi-runtime-resolver`：内置 Provider 共用进程级 `builtinModels()`；显式 API override、未知 Provider 或内置 Provider 无法执行的 API 使用独立 `createModels() + createProvider()`。
- `resolvePiModelFromConfig()` 保持纯 metadata resolver；`PreparedRun`、`RunFrame`、`TurnSnapshot`、sidecar 与 compaction 携带非持久化 `Models`。settleRun sidecar 改为复用 invocation 冻结 runtime，不再结束时重新读取连接配置。
- `tracedStreamSimple` / `tracedCompleteSimple` 已改为 `Models` 实例方法，健康检查也走相同 runtime 与 traced seam；统一 guard 禁止 `/compat`、旧全局 registry API 和绕开 traced seam 的生产调用。
- 新增统一 Provider error sanitizer，覆盖 trace、health-check、Run Kernel error、session lifecycle、compaction 和最终 assistant 展示/持久化边界；保留 `reasoning` / `cacheWrite1h` usage。
- Catalog 改用 `builtinProviders()`；实际 `0.80.6` 显示名为 `Ant Ling`、`NVIDIA`、`Z.AI Coding CN`，与早期 release 文案中的 “NVIDIA NIM / ZAI Coding Plan (China)” 不完全一致，实现以包内公开 Provider metadata 为准。
- `max` thinking 已进入 DTO、Config、session command、Composer、Profile 设置和中英文文案；服务端使用 `clampThinkingLevel()`。
- `cost.tiers` 已贯通 DTO、Config、normalizer、catalog、resolver、草稿往返和 Pi 费用合同；设置 Dialog 提供新增/删除/编辑 tier，执行原子完整覆盖、基础价格必填、重复阈值拒绝和保存升序排列。
- Faux 测试迁移为 suite 私有 `fauxProvider() + createModels()` fixture，移除全局 unregister/reset，并增加并行 response queue 隔离测试。
- hardening 审查后，custom connection 判定从“是否显式 override API”修正为同时检查 `providerConfigId`、override 与 builtin API 支持能力，避免同类本地连接误共享 builtin runtime。
- `requestOptions` 没有按原审查初稿透传 `serviceTier`、Bedrock 顶层 `region/profile/bearerToken` 等 API 专用字段。阅读 Pi `0.80.6` 源码确认 `Models.streamSimple()` 不会转发这些字段后，实际实现只接受可生效的 `SimpleStreamOptions` 子集；Bedrock region/profile 使用正式 `env` 表达，Config API key 单独映射为 `AWS_BEARER_TOKEN_BEDROCK`。
- 错误安全实际实现复用了 app logger 已有脱敏职责，没有把保留原始 `Error`/stack 诊断信息误判为确认泄漏；新增的是共享清洗底座、Provider 长度限制和 sidecar SSE 错误边界。
- 曾尝试增加完整 sidecar SSE 集成测试，但 Faux sidecar response queue 无法稳定表达该独立断言，测试会在业务路径前耗尽响应。最终删除该不可靠测试，没有引入测试后门；sidecar 边界由直接代码合同和共享 sanitizer 单测覆盖。
- 与计划的实现偏差：为让价格草稿测试进入正式测试矩阵，`vitest.config.ts` 新增 settings test include；Nuxt 首次构建被 `server/.agent` 下一个测试生成的旧 World Engine cache 文件拦截，删除该生成物后完整 `bun run nuxt:build` 通过，未放宽 Product portability guard。
- session 518 收口时进一步发现 UI 曾把空 metadata 来源解释为“纯自定义”，服务端却仍按同名本地连接隐式查 registry。最终没有保留该双重语义：`model.provider` 成为唯一 metadata 来源，已有隐式配置按快速开发期规则在保存或运行时明确校验，不增加 legacy fallback。

## Verification Results

- `bun run typecheck`：通过；hardening 收尾于 2026-07-12 再次复核通过。
- Pi/runtime/model/cost/usage/trace/health-check/compaction/guard 聚焦测试：通过。
- hardening 最终聚焦组合：`8` files / `229` tests 通过，覆盖 request options、runtime resolver、Provider sanitizer、app logger、compaction、主 Harness、black-box 与 harness trace。
- 动态价格回归：catalog API、model resolver 与价格草稿 `3` files / `19` tests 通过；全量 catalog 解析成功，`openrouter/openrouter/auto` 保留且 `cost: null`；修复后 `bun run typecheck` 再次通过。
- Harness 聚焦：主 Harness `165/165` 通过；一次较宽 Harness 组合为 `239/239` 通过。后续高并发组合中 black-box steer 时序用例出现非确定性失败并伴随测试目录提前清理，记录为既有测试时序问题，没有修改业务代码掩盖。
- Config / model settings / shared DTO：`138/138` 通过。
- 全量 Vitest：`1698` 通过、`9` 失败、`3` 跳过。失败集中在 auth 环境开关、Profile artifact compiler 版本断言、Profile build/publisher 超时、leader assets 超时和 Harness steer 时序；均不在 Pi 变更面。独立复跑后 auth 两项与 compiler version 断言稳定复现，其他为时序性失败。
- `bun run nuxt:build`：通过；Nitro vendor 已核实包含五个 lazy API subpath、`@opentelemetry/api`、`@smithy/node-http-handler`、`@mistralai/mistralai@2.2.6`。
- `bun run product:stage`：初次升级与 hardening 收尾均通过；hardening 产物再次核实包含五个 lazy API subpath和上述 runtime dependencies。
- Windows Portable：初次升级与 hardening 收尾均通过；本轮产物位于 `.agent/workspace/task-104-hardening/neuro-book-windows-x64.zip`，zip 内再次核实包含五个 Pi lazy API 与上述 runtime dependencies。
- Docker build smoke：未执行，当前环境没有 `docker` 命令。
- 真实 Provider smoke：未执行，未获得使用现有凭据的明确授权。
- 浏览器验证：按项目约束未自动执行。

### 真实 Provider smoke（2026-07-13）

用户明确授权使用当前 Global Config 凭据后完成以下真实请求：

- MiMo `mimo/mimo-v2.5-pro` 单模型健康检查通过，约 `2.4s`。
- DeepSeek `deepseek/deepseek-v4-flash` 单模型健康检查通过，约 `0.9s`。
- 临时 `leader.default` Agent session 使用 MiMo 完成真实 turn，返回 `reasoning` usage；随后手动 compaction 成功。
- MiMo tool schema live probe 使用真实 Provider 完成原生对象 tool call，正式 schema 校验通过。
- trace-on 链路记录了真实 `turn`、`toolUse` 与 `compaction`，HTTP 均为 `200`；MiMo 原生 payload 只含 `max_tokens`，不含 `max_completion_tokens`。
- trace-off 链路由健康检查覆盖，请求行为正常。
- 对真实 trace 文件执行凭据扫描：未发现当前配置 API key、Authorization、Cookie 或 Set-Cookie。
- smoke 支持脚本同步修复：临时 session repo 与 Global Config 的 runtime workspace 语义分离，不再把临时绝对目录误当作外部 Workspace Root；移除已下线的 `result.events` 读取，并增加可选真实 compaction smoke。

真实 smoke 同时确认一个观测缺口：健康检查目前调用统一 `tracedStreamSimple` seam，但没有传入 `PiTraceBinding`，因此不会持久化 `kind=health-check` trace。请求、错误清洗和取消合同不受影响，但这与 Task 104“健康检查 trace 可审计”的目标不完全一致；本轮作为验证发现记录，不在未获修复指令时修改业务代码。
- session 518 metadata/maxTokens 收口：resolver、payload、设置保存与 catalog 候选决策聚焦 `4` files / `37` tests 通过；session selection metadata reconcile 聚焦 `3/3` 通过，主 Harness 文件完整运行退出码为 0。
- 本轮收口后的 `bun run typecheck` 与 `bun run nuxt:build` 通过。
- 本轮未调用 session 518 invocation 接口，也未执行真实 Provider smoke 或浏览器验证。

## Provider Preset / Model Catalog / unified runtime 实施结果（2026-07-13）

本轮按用户最终设计硬切了模型配置架构，以下内容覆盖前文仍描述 builtin/custom runtime、`model.provider` metadata binding 和模型级 Base URL 的旧实施记录。

### 实际架构

- 新增只读 **Provider Preset**：从 Pi builtin Provider 生成名称、默认 Base URL 和支持 API，再叠加 NeuroBook Discovery Adapter；另提供五种 Custom 预设。预设只用于创建时复制，保存后用户 Provider Config 与其完全独立。
- 新增按精确 model ID 唯一的 **Model Catalog**：Pi `0.80.6` builtin models 是主要 seed，canonical source 使用固定厂商优先级选择，不依赖遍历顺序；compat/headers 按 Pi API 保存。动态或负价格哨兵归一化为 `null`。
- MiMo 修正集中在 Catalog normalizer 的 `mimo-v2.5-pro + openai-completions` 条目，统一补充 `maxTokensField: "max_tokens"`，不再依赖 Xiaomi CN Provider ID。
- Global Config 的 **Provider Config** 保存 Provider Base URL、API key、proxy、timeout、request options、Discovery Adapter 和完整模型能力。模型级 `provider` / `baseUrl` 已删除；resolved Pi model 的 `provider` 永远是本地 Provider Config ID。
- runtime 不读取 Provider Preset、Model Catalog 或发现接口。所有 Provider 一律为当前 invocation 创建独立 `createModels() + createProvider()`；`customPiRuntime/customRuntime` 双轨标记已从 RunFrame、turn、sidecar 和 compaction 删除。
- Catalog API 从旧 `/api/config/models/pi-catalog` 硬切为 `/api/config/models/catalog`。

### 发现与设置页

- 新增正式 Provider Discovery Adapter seam：`openai-models`、`openrouter-models`、`google-models`、`none`。各 Adapter 使用 Zod response schema，归一化不同 path 的 context/max token、modalities、reasoning 和可选价格，不支持任意 JSONPath。
- 发现结果只保存在前端内存。完整远程能力直接采用；不完整时按精确 ID 用 Model Catalog 的完整能力块替换，不逐字段混合；Catalog 未命中时保存为禁用草稿并显示缺失字段。
- Catalog 添加、发现回填、手动添加和“重新应用 Catalog”共用 Model Draft Factory。模型 Dialog 已删除 Pi metadata source 和模型级 Base URL，直接编辑最终 API、reasoning、input、limits、compat、headers、thinking map 与价格。
- Provider 表单新增 Discovery Adapter 与 endpoint path；保存和健康检查继续由服务端校验所有启用模型的完整能力。

### Session 与当前数据

- session 稳定选择 key 仍是 `providerConfigId + model.id`。新 invocation 从当前 Provider Config 刷新完整模型，JSONL canonicalizer 删除 `undefined` 后深比较，避免 round-trip 后重复写 `model_change`；RunFrame 内继续冻结。
- 当前 Global Config 已硬切：DeepSeek、MiMo、SiliconFlow 启用模型复制标准 Catalog 能力；MiMo 保存 `max_tokens` compat；Doubao 与 Gemini 模型因缺少可验证完整能力暂时禁用。所有启用模型 resolver audit 通过，现有 Profile modelKey 仍指向可用模型。

### 与计划的差异

- 最终实现进一步删除了此前 hardening 阶段保留的 builtin/custom runtime 分类以及 `customPiRuntime` 传播字段；这不是兼容层，而是用户最终统一 runtime 决策的直接结果。
- OpenAI-compatible `/models` 本身通常不声明 reasoning，因此只有远程明确提供完整必需能力时才直接启用；否则严格走 Catalog 整块替换或禁用草稿，没有用 model ID 猜 reasoning。
- Windows Portable 输出使用发布脚本的标准 `dist/neuro-book-windows-x64.zip`，没有沿用旧 walkthrough 中 `.agent/workspace/task-104-hardening/` 临时路径。

### 本轮验证

- Catalog/Discovery/Draft Factory/session canonicalizer/runtime/model settings/DTO/Config 聚焦测试通过：新增核心组合 `49/49`、Config/DTO 组合 `74/74`、runtime/auth/compaction/guard `47/47`。
- session metadata reconcile 专项 `1/1` 通过；payload Harness 文件单独运行 `7/7` 通过。
- 较宽 Harness 并行组合中 `204/211` 通过，7 个失败均为现有 Windows 测试资源争用/超时形态；其中首个 black-box 用例隔离复跑通过（25s，接近其 30s timeout），没有修改业务代码或放宽超时掩盖。
- `bun run typecheck`：通过。
- `bun run nuxt:build`：通过；新 `/api/config/models/catalog` route 已进入 Nitro 输出。
- `bun run product:stage`：通过。
- Source archive 与 Windows Portable：通过，输出 `dist/neuro-book-source.zip`、`dist/neuro-book-windows-x64.zip`。
- `.output`、Product 和 Windows Portable 均核实包含五个 Pi lazy API subpath、`@opentelemetry/api` 与 `@smithy/node-http-handler`。
- Docker：当前环境无 `docker` 命令，未执行。
- 真实 Provider smoke：未获凭据授权，未执行。
- 浏览器验证：按项目约束未自动执行。

## Provider Config 写入合同与一键修复收口（2026-07-14）

本轮修复了“设置读取能够报告问题，但 Global Config 实际保存仍能写入坏模型”的 seam 缺口：

- 新增 shared Provider Config Contract Module，统一支持的 Pi API、模型能力、Provider Base URL、limits、重复 ID、默认模型和 Agent Profile 引用校验。服务端 `ModelConfigError`、设置读取、健康检查、runtime 和前端草稿共用同一 issue code。
- `/api/config/global` 仍是唯一写入路径。当请求包含 `models` 时，先构建候选配置并完成完整校验，再执行 Profile resource mutation 和文件写入；失败返回 400 字段级 `issues`，不会留下部分 mutation。主题、Web、历史等不包含 `models` 的独立保存不会被现有坏模型阻断。
- 删除无生产调用者的旧 Model Settings DTO/转换函数和独立保存函数；模型选项调用者直接使用 `EnabledModelOptionDto[]`。`provider.defaultApi` 与 `model.api` 的边界保持硬切，runtime 不从 Provider 默认值回退。
- 设置页新增纯 `model-settings-draft` Module，实时按当前草稿计算 issue，默认模型、Profile 引用和健康检查候选只接受 runnable 模型。顶部问题提示改为紧凑告警条，并提供“一键修复”：按精确 model ID 预览并应用 Catalog 能力、禁用仍不可运行模型、清理失效引用和默认模型；操作只修改前端草稿，必须由用户检查后手动保存。
- Catalog 应用的 API 选择严格使用“现有受支持 model.api → provider.defaultApi → Catalog defaultApi”，非法旧 API 不会被保留。MiMo 仍得到 `openai-completions`、`1048576`、`131072` 和 `max_tokens` compat。

本轮实际验证：`bun run typecheck`、`bun run nuxt:build` 通过；model draft、model validation、runtime/auth、DTO 和 Global Config 写入合同聚焦测试通过。未自动执行浏览器、Docker 或真实 Provider 验证。当前 workspace 的坏 Global Config 与 session 521 未被自动修改。

## Model Library / Provider Template / Automatic Discovery 重构决策与计划（2026-07-18）

以下目标合同覆盖 2026-07-13/14 实施结果中仍把 Provider Preset、Discovery Adapter 和不完整 disabled draft 作为正式设置模型的部分；旧章节保留为历史实施记录，不能再作为下一轮实现依据。

### 用户反馈与诊断结论

用户验收模型设置页时确认当前产品模型仍然过于复杂：主面板同时出现“已启用模型”和“禁用模型草稿”，任意 Provider 的“管理模型库”会混入全部 NeuroBook Catalog 模型，并展示与当前 Provider 无关的 Cloudflare Workers AI `@cf/...` 模型。只读诊断确认这不是缓存或偶发现象，而是当前实现的直接结果：

- `enabled=false` 同时表达“用户停用”和“能力字段不完整”，导致一个布尔字段承担两种不同状态。
- 模型库 Dialog 将当前发现结果、全部 Model Catalog、已停用模型和已启用模型合并为一个列表；当前 Model Catalog 约有 730 个条目，因此任意 Provider 都会看到全量目录。
- Catalog 模型和远程发现模型使用不同 Group 推导规则；`@cf/mistralai/mistral-small-...` 被前端按首个连字符错误分成 `@cf/mistralai/mistral`。
- Provider Config 暴露并持久化 Discovery Adapter 与 endpoint path；用户需要理解内部发现协议。
- “由 metadata 决定；纯自定义时必填”仍是旧合同文案。当前 runtime 已经要求每个启用模型保存明确 `model.api`，不会通过 metadata 猜测。

诊断后已完成核心业务代码硬切；Global Config 与 session 数据仍没有自动修改。当前实现和剩余差异见本文件顶部“2026-07-18 实施结果”。

### 最终产品模型

产品层收敛为三个持久概念和一个临时操作：

1. **Model Library**：NeuroBook 维护的只读标准模型资料，按精确 model ID 唯一索引，只保存与模型身份和通用能力有关的资料。
2. **Provider Template Library**：NeuroBook 维护的精选连接模板，例如 MiMo Token Plan。模板应尽量做到只输入 Secret 即可创建完整 Provider 草稿；保存后结果仍是普通 Provider Config，不保留模板引用。
3. **Provider Config**：用户保存的完整连接和模型配置，是 runtime 唯一真相源。
4. **Automatic Model Discovery**：用户显式触发的一次性设置操作。程序在内部有限试探发现协议，结果只存在前端；它不是 Provider Config 字段，也不是 runtime 概念。

Session Model Selection 与既有 runtime 合同不变：session 只保存 `providerConfigId + model.id`，每次 invocation 从当前 Provider Config 重新解析完整模型，RunFrame 内冻结；runtime 不访问 Model Library、Provider Template Library 或 Automatic Model Discovery。

### 数据所有权与补全规则

#### Model Library

Model Library 可以维护：

- 精确 model ID、标准名称与资料来源；
- reasoning 与输入模态等通用能力；
- 标准 context window、max output 等参考能力；
- thinking level 等与模型身份稳定相关的资料。

Model Library 不得把以下 Provider 相关数据当作全局事实：

- Base URL、鉴权、headers 和 request options；
- Provider 实际价格；
- Provider 实际限额；
- 传输 Adapter 专属 compat。

相同 model ID 在不同 Provider 上可能具有不同价格、限制和传输行为。Model Library 的资料是精确 ID 对应的标准补全候选，不代表当前 Provider 一定提供该模型，也不能伪装成远程发现结果。

#### Provider Template Library

Provider Template 是只读创建资料，可以包含：

- 默认名称、Base URL、Pi API 与鉴权方式；
- request options 和必要传输设置；
- Automatic Model Discovery 的内部 hint；
- 推荐 model ID 与必要的模板级模型 patch。

MiMo Token Plan 等精选模板的常见路径应只要求用户输入 Secret。Custom Provider 仍至少需要名称、Base URL 和 Secret。模板实例化完成后不在 Provider Config 中保存 `templateId`，避免持续继承和隐式漂移。

#### Automatic Model Discovery

Provider Config 不再保存 Discovery Adapter 或 endpoint path。Automatic Model Discovery Module 对调用者只公开“使用当前连接发现模型”这一条 Interface，Implementation 内部维护真正存在的 Adapter seam：

- OpenAI-compatible Models Adapter；
- OpenRouter Models Adapter；
- Google Models Adapter。

自动探测必须满足以下安全合同：

- 只尝试由用户 Base URL 派生的有限已知路径，按确定顺序执行，成功后短路；
- 禁止重定向，或在任何凭据发送前严格验证目标 origin 不变；
- Secret 不进入返回值、日志或错误文案；
- 每次请求有 timeout 与响应体大小上限；
- 返回经过清洗的尝试摘要，但前端不展示 Adapter 配置。

#### Model Candidate Completion

远程发现返回 `Discovered Model Candidate`，允许字段不完整，只存在于当前前端发现会话。候选补全使用确定优先级：

1. 远端明确返回的字段优先；
2. 按精确 model ID 使用 Model Library 补充缺失的通用能力；
3. 使用 Provider Template 或用户明确选择的 Pi API 补充连接与传输资料；
4. 仍缺少必填字段时保持为前端临时候选，打开编辑器要求用户补齐。

补全需要记录字段 provenance（`remote` / `model-library` / `provider-config` / `provider-template` / `user`），供设置页解释数据来源。禁止模糊 model ID 匹配，禁止把 Model Library 能力整块覆盖远端已经明确返回的 Provider 实际限制。

### Provider Config 新不变量

- 所有持久化模型，无论 `enabled` 为 true 或 false，都必须拥有完整可校验能力。
- `enabled` 只表达“是否允许被选择和运行”，不再表达“配置是否完整”。
- 不完整发现结果不得自动进入 Provider Config，也不得通过 `enabled=false` 绕过保存合同。
- “禁用模型草稿”概念删除。设置页只展示“已启用模型”和能力完整的“已停用模型”。
- 用户选择不完整候选时，只能补齐后保存，或放弃该候选；如未来需要保留待办，必须另建显式草稿模型，不能复用 Provider Config。
- `/api/config/global` 继续作为唯一写入路径，shared Provider Config Contract Module 在任何文件写入和 Profile mutation 前验证全部已保存模型。

### 深化 Module 与 Interface seam

1. **Model Library Module**
   - 从当前同时生成 Provider Preset、Model Catalog 和发现策略的 `server/models/catalog.ts` 中拆出。
   - Interface 只暴露目录读取与精确 model ID 查询；Pi provider 遍历、canonical 选择、去重和模型 patch 隐藏在 Implementation 内。
   - 提升 Locality：发现补全、手动添加和显式修复共用同一模型资料真相源。

2. **Provider Template Library Module**
   - 维护精选连接模板和 Secret-only 常见创建路径，不再从全部 Pi Provider 机械生成用户必须理解的 Preset。
   - Interface 负责列出模板和实例化普通 Provider 草稿；保存后不保留模板身份。

3. **Automatic Model Discovery Module**
   - 将 Adapter 选择、URL 构造、鉴权、安全限制、response schema 和归一化收进 Implementation。
   - 当前已有 OpenAI/OpenRouter/Google 三个 Adapter，因此这是实际存在的 seam，不新增假想扩展点。

4. **Model Candidate Completion Module**
   - 深化当前 `model-draft-factory.ts`，集中字段级补全、provenance、完整性检查和持久化转换。
   - Interface 必须区分 `CompleteCandidate` 与 `IncompleteCandidate`；只有 CompleteCandidate 可以转换为 Provider Config model，从类型和调用顺序上约束以后不能再次保存坏草稿。

5. **Provider Config Contract Module**
   - 延续并强化现有 `shared/models/provider-config-contract.ts`，不建立第二套平行校验。
   - disabled 模型同样执行完整能力校验；`enabled` 只影响 runnable model key 集合。

6. **Settings UI Module**
   - 当前 `NovelIdeModelSettingsPanel.vue` 已同时承担 Provider 创建、保存、发现、Catalog、候选补全、健康检查、分组和多个 Dialog，Interface 与 Implementation 都过宽。
   - 本次重构必须拆出 Provider Template 创建、已保存模型列表、Automatic Discovery Dialog 和发现会话状态 Module；宿主只负责页面编排，单文件继续遵守 `<800` 行约束。

### 前端目标交互

Provider 主页面只展示：

- 已启用模型；
- 已停用模型；
- “发现/添加模型”入口。

Automatic Discovery Dialog 只展示：

- 当前 Provider 本次实际发现的模型；
- 当前 Provider 已保存状态；
- `远端信息完整`、`已由 Model Library 补充`、`仍需手动补充`等来源/完整性状态；
- 手动添加入口。

全局 Model Library 不再自动混入远程发现列表。如需要从标准资料直接添加，提供明确独立的“从 Model Library 添加”入口，并提示“该条目未由当前 Provider 发现，需要用户确认并执行健康检查”。Group 由统一纯函数产生，优先使用明确分组或模型资料来源，不再分别按 `/`、`:` 和首个 `-` 推导。

### 实施计划

#### Refactor Phase 0 — 基线与失败合同

- 为当前误导行为建立测试 seam：任意 Provider 的发现 Dialog 不得自动出现全部 Model Library；Model Library-only 模型不得标记为远程可用。
- 固化不完整 disabled 模型当前可保存的失败用例，作为 Provider Config 新不变量的红灯。
- 固化 `@cf/...` Group 推导不一致、旧 metadata 文案和 Discovery Adapter 字段暴露。
- 只读 audit 当前 Global Config 中的不完整模型，列出实施硬切时需要显式补齐或删除的条目；本阶段不自动改用户数据。

#### Refactor Phase 1 — DTO 与稳定术语硬切

- 更新 `CONTEXT.md`、Task 03 和 shared DTO，删除 Provider Discovery Adapter 作为产品与持久化概念。
- 将 `ProviderPreset` 重命名为 `ProviderTemplate`，将 Catalog 返回结构拆成 Model Library 与 Provider Template Library 两个明确 Interface。
- 从 Provider Config、Provider 草稿、editor snapshot 和 fixture 删除 `discovery`；评估并删除不再需要的持久化 `defaultApi`，手动添加模型必须明确最终 `model.api`。
- 不提供 legacy adapter；当前数据按快速开发期规则显式硬切。

#### Refactor Phase 2 — Model Library 与 Provider Template Library 分离

- 拆分当前 `server/models/catalog.ts` 的多重职责。
- Model Library 只维护精确 ID 的模型资料，不输出 Provider 可用性结论。
- Provider Template Library 首批至少覆盖 MiMo Token Plan，并保留 Custom 创建入口。
- 模板实例化产出普通 Provider Config 草稿，验证保存后没有模板引用。

#### Refactor Phase 3 — Automatic Model Discovery

- 保留 `/api/config/models/provider-discover` 作为 HTTP 入口，但请求只包含当前连接草稿，不包含 Adapter 或 endpoint path。
- 建立内部 discovery router，按安全、有限顺序调用 OpenAI/OpenRouter/Google Adapter。
- 增加 redirect、跨 origin、timeout、响应大小、Secret 清洗和失败摘要测试。
- 发现结果保持前端临时状态，刷新替换当前会话，不进入 Global Config。

#### Refactor Phase 4 — Model Candidate Completion

- 将当前整块替换改为字段级补缺；远端明确值优先，Model Library 仅补缺。
- 引入 provenance 与 Complete/Incomplete 输出类型。
- Model Library 添加、远程发现、手动添加和显式修复共用同一 Completion Interface。
- 删除 `source: "incomplete" -> enabled: false` 的持久化路径。

#### Refactor Phase 5 — Provider Config 合同强化与数据硬切

- shared Provider Config Contract Module 校验全部已保存模型，包括 disabled 模型。
- 删除 `disableInvalidDrafts()` 通过禁用保留坏模型的策略；修复动作只能补齐、要求用户编辑或显式删除。
- 对当前 Global Config 做变更前审计；经用户确认后，补齐或删除现有不完整 disabled 条目，不保留 runtime/config legacy 兼容分支。
- 默认模型、Profile 引用、健康检查和 runtime 继续只接受完整 runnable 模型。

#### Refactor Phase 6 — 设置页 Module 重构

- 从 `NovelIdeModelSettingsPanel.vue` 拆出 Provider Template 创建、Saved Model List、Automatic Discovery Dialog 和发现会话状态。
- 删除 Discovery Adapter、endpoint path、“禁用模型草稿”和旧 metadata 文案。
- Automatic Discovery Dialog 只投影当前发现结果与已保存状态；Model Library 使用独立入口。
- 统一 Group 推导、状态 badge、错误出口和保存前检查。

#### Refactor Phase 7 — 回归验证与验收

- 聚焦测试：Model Library、Provider Template、discovery router/Adapter、安全合同、candidate completion、Provider Config、设置页纯状态与 config write。
- 运行 `bun run typecheck`、`bun run nuxt:build`；涉及 Product runtime closure 时再运行 `bun run product:stage`。
- 用户授权后执行真实 Provider smoke：MiMo Token Plan、普通 OpenAI-compatible、OpenRouter、Google 各至少一次发现与单模型健康检查。
- 按项目约束不自动运行浏览器验证；实现完成后建议由用户验收模板创建、Custom 自动发现、补全来源、手动补齐、启停模型和保存恢复。
- 更新 Task 03、Task 104、`CONTEXT.md` 与 `PROJECT-STATUS.md`，记录实际结果和本计划的出入。

### 测试影响与删除策略

重点修改或重写：

- `server/models/catalog.test.ts`：拆分为 Model Library 与 Provider Template Library 合同。
- `server/models/discovery.test.ts`：保留 Adapter schema 测试，新增自动 router、安全与失败回退。
- `server/utils/model-settings.test.ts` 与 discovery route 测试：请求不再包含 Adapter。
- `app/components/novel-ide/settings/model-draft-factory.test.ts`：改为字段级补全、provenance 与 Complete/Incomplete 类型。
- `app/components/novel-ide/settings/model-settings-draft.test.ts`：删除 disabled 不完整模型可保存的旧期望。
- Config DTO、normalizer、config-service 与 model validation 测试：删除 `discovery` fixture，disabled 模型同样要求完整。
- 设置页状态测试：覆盖发现列表不混入 Model Library、刷新替换临时结果、只允许完整候选进入 Provider Config。

旧测试如果只证明“用户可以配置 Discovery Adapter”“Catalog 未命中会持久化禁用草稿”或“disabled 条目可缺能力字段”，在新合同下已经没有价值，应删除而不是改名保留。runtime、session selection、invocation reconcile、compaction、trace 和健康检查的 Provider Config 真相源测试继续保留。

### 风险与决策

- **Model ID 冲突风险**：第三方 Provider 可能复用同一 ID 指向不同能力。Model Library 只提供精确 ID 补全候选，UI 必须展示来源并允许用户覆盖；Provider Config 最终快照承担执行真相。
- **Secret 外发风险**：自动发现比手工 Adapter 更易产生隐藏请求。必须先完成 redirect/origin/timeout/size 安全合同，再接入真实凭据。
- **探测覆盖与复杂度权衡**：有限顺序试探更安全、可测试，但无法覆盖所有私有协议；建议首批只覆盖现有三个真实 Adapter，失败后进入手动添加，不实现任意 JSONPath 或插件式用户脚本。
- **字段级合并复杂度**：provenance 会增加前端状态类型，但能避免整块 Catalog 覆盖 Provider 实际限制。建议接受这部分复杂度，并集中在 Model Candidate Completion Module，防止散落到 Vue 调用点。
- **现有数据硬切**：当前 Global Config 已存在不完整 disabled 模型。实施时应显式审计并在用户确认后清理，不保留 legacy 读取或 runtime fallback。
- **大文件风险**：如果只删除字段、继续把发现会话逻辑堆入现有设置页，会形成新的 hack。本次必须以 Settings UI Module 拆分作为完成条件。

## 2026-07-18 模型编辑体验优化

用户在真实模型设置页验收时确认，模型编辑 Dialog 仍把基本信息、接口、能力、限制、三个 JSON 字段和价格同时铺在一条长滚动页面中；信息层级弱，低频高级字段挤占首屏，JSON 使用裸 `textarea`，输入半截 JSON 时还可能触发宿主的完整草稿解析异常。

本轮实际调整：

- Dialog 改为固定摘要头与“基本信息 / 能力与限制 / 请求参数 / 价格”四个页签；去除四张同权重悬浮卡片，内容区按任务分组并保留窄屏横向页签滚动。
- 请求参数页将 Compat、Headers、Thinking Map 收进字段切换栏，同一时间只编辑一个 JSON；复用通用 `JsonViewer` 的 `json-editor-vue` 包装，开放文本/树形编辑、状态栏、格式化和即时合法性状态。
- `JsonViewer` 新增受控 `update:value` 与 `validation-change` 合同；字符串编辑使用上游 `stringified` v-model 保留输入中的非法 JSON，tree 编辑模式恢复插入热区，只读场景继续隐藏无意义的插入占位。
- 模型必需能力提示不再调用会解析 Compat / Headers / Thinking Map 的完整草稿转换；高级 JSON 暂时非法时只在字段列表标错。临时候选最终确认仍调用正式解析并把错误显示为通知，不放松持久化校验。
- 价格从高级配置中拆成独立页签，基础价格和长上下文 tiers 保留原有完整覆盖合同；Provider、Model Library、Automatic Discovery 与 Config 保存接口均未改变。
- Provider 的 `modelApi` 保留为候选补全和 discovery 路由提示，并按用户后续验收改为主连接表单中的必填“Provider 默认接口格式”。Provider Template 负责预填，Custom Provider 必须由用户明确选择后才能检查、发现或保存；已保存 Provider 可直接修改该提示并在端点身份不变时复用 saved Secret。已有模型继续只使用各自的 `model.api`，同一 Provider 可以保存不同接口格式的模型。Anthropic Messages 的模型发现只在该显式选择下发送 `x-api-key`，不拿 Secret 做多协议试探。

计划差异：本任务早期范围曾写“不重做模型设置页整体布局”，本轮用户明确要求优化该界面，因此该限制被后续指令覆盖。实际只重构 `NovelIdeModelEditDialog.vue`，没有扩大到 Provider 主设置页或重新设计 Task 104 的模型业务合同。Dialog 当前约 350 行，仍满足 `<800` 行门禁。

验证：`bun run typecheck` 通过；模型设置目录 8 个测试文件、29 项测试通过；接口收紧后的模型/DTO/Provider contract 快速套件 15 个文件、78 项测试通过；Normalizer 12 项测试通过；Config Service 的“缺少 Provider 默认 API”与旧 Provider 写回补齐 API 两个关键用例通过；`bun run generate:openapi` 更新 42 个 route meta；`bunx nuxt build --dotenv .env` 通过。`server/config/config-service.test.ts` 整文件在当前环境运行超过 300 秒未返回报告，未将其计为通过。按项目约束未自动执行浏览器验证；2048×1017 截图对应的真实主题布局、JSON Editor 键盘交互、必填接口选择和窄屏表现仍待用户验收。

## TODO / Follow-ups

- [x] D3 已锁定：本轮不加入 Pi OAuth、订阅登录或持久化 CredentialStore。
- [x] D4 已锁定：本轮实现 `cost.tiers` 完整数据支持与逐 tier 可视化编辑，并采用原子完整价格覆盖。
- [x] D5 已锁定：自定义 Provider 仅允许五种受支持 Pi API adapter，未知值明确失败。
- [x] D6 已锁定：精确目标版本为 `0.80.6`，不随最新版本漂移。
- [x] Phase 0 baseline 与缺口测试。
- [x] Phase 1 dependency + runtime binding 同批迁移。
- [x] Phase 2 streaming/observability 迁移。
- [x] Phase 3 catalog/model metadata 迁移。
- [x] Phase 4 thinking/cost contracts。
- [x] Phase 5 Faux tests。
- [x] Phase 6 integration cleanup 与 guard。
- [x] Phase 7 typecheck / Nuxt / Product / Windows Portable 验证。
- [x] 用户授权后执行真实 Provider smoke；MiMo/DeepSeek、thinking、tool call、compaction、trace-on/off 已覆盖，health-check trace binding 缺口另行修复。
- [ ] 在具备 Docker CLI 的环境执行 Docker build smoke。
- [x] 同步 `PROJECT-STATUS.md` 并记录最终验证与残余风险。
- [x] 按 2026-07-18 新合同完成 Model Library / Provider Template Library 分离。
- [x] 删除 Provider Config 的 Discovery Adapter / endpoint path，实施 Automatic Model Discovery Module。
- [x] 实施 Model Candidate Completion 字段级补全与 provenance，禁止不完整候选持久化。
- [x] 强化 Provider Config：disabled 模型也必须能力完整，删除“禁用模型草稿”语义。
- [x] 完成设置页 Module 重构：发现列表与 Model Library 已分离，三个展示 Module与四个状态/行为 Module 已抽出；宿主降至 695 行，相关 Vue 文件全部满足 `<800` 行门禁。
- [x] 用户确认后硬切清理当前 Global Config 中的不完整 disabled 模型；已删除 5 条，清理后 validation issue 为 0。
