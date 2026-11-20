调研对象 pi-catalog 18.14.0、neuro-book master c36699fae 附近，日期 2026-11-20。

# OMP 模型目录的在线刷新与 NeuroBook 的差距

本文只读调研，回答开发者在 t43 提的四点反馈（A 不升级依赖拿新目录、B 目录服务商也要能发现与重新拉取、C 添加服务商即添加全部模型、D 角色推理档）。行号以调研时的文件为准。pi-catalog 源码位置：`node_modules/@oh-my-pi/pi-catalog/src/`（下文简写 `cat/`）；omp 的 coding-agent 层用本机全局安装 `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/`（18.14.1，依赖的 pi-catalog 与仓库里的 18.14.0 源码逐文件相同，下文简写 `ca/`）。仓库 `.local/pi-src` 里只有两个无关文件，没有 coding-agent 源码。

## 1. pi-catalog 不升级依赖怎样拿到新目录

结论：pi-catalog 自带“打包目录 + 两种在线来源 + SQLite 缓存”的完整合并器，在线来源的 fetch 与 map 都在 pi-catalog 里写好了，宿主只需要按服务商构造 `ModelManagerOptions` 并调用 `refresh(strategy)`；但“给哪些服务商装哪种来源、凭据从哪来、缓存放哪、何时刷新”是宿主（omp 的 coding-agent）决定的。开发者说的“omp 不更新依赖就能拿到最新模型”就是这套：每个服务商的 `/models` 端点发现，加上 stencil.so 托管的 models.dev 副本，结果写进 `models.db`。

### 1.1 来源与合并顺序

`cat/model-manager.ts`：

- 刷新策略 `ModelRefreshStrategy = "online" | "offline" | "online-if-uncached"`（25 行）；默认 `online-if-uncached`（153、250 行）。
- 判定是否联网在 `shouldFetchRemoteSources`（541–560 行）：`offline` 永不联网；`online` 总是联网；`online-if-uncached` 缓存不新鲜才联网，上次联网失败留下的“非权威”缓存按 `NON_AUTHORITATIVE_RETRY_MS = 5 分钟`（20 行）重试。`alwaysRefetchDynamicModels` 会把 `online-if-uncached` 升成 `online`（252 行）。
- 合并顺序（243–247 行注释与 248–499 行实现）：打包目录（`getBundledModels(providerId)`，即 `models.json`）→ 缓存（只在至少一个远端来源这次没成功时参与）→ models.dev（stencil.so）→ 服务商端点发现（`fetchDynamicModels`）。后者按模型 id 覆盖前者。`dynamicModelsAuthoritative` 为真时端点发现结果就是全集，会剪掉只在打包目录里有的模型（58 行、361、403–409 行）。
- 返回 `{ models, stale, source: "bundled" | "cache" | "models.dev" | "provider", updatedAt }`（120–138 行）；`stale` 为真表示远端没刷新成功、用的是打包或旧缓存。
- 远端失败不抛错：`fetchModelsDev`、`fetchDynamicModels` 都把异常吞成 `null`（507–536 行），结果回落到打包目录或旧缓存，并把旧缓存重写成“非权威”行以触发 5 分钟退避（426–470 行）。

### 1.2 stencil.so / models.dev 回退

- 钩子接口 `ModelsDevFallback { fetch(): Promise<payload>; map(payload, providerId): ModelSpec[]; additiveOnly? }`（`cat/model-manager.ts` 30–37 行）。接口本身由宿主注入，但 pi-catalog 已提供现成实现 `modelsDevCatalogFallback(providerId, fetchImpl?, timeoutMs?)`（`cat/provider-models/openai-compat.ts` 7832–7843 行），宿主一般直接用它。
- 请求的 URL：`https://catalog.stencil.so/models.json.zstd`（openai-compat.ts 97 行）。`fetchCatalogPayload`（245–270 行）发 `GET`，头 `Accept: application/zstd, application/json` 与 omp 的 User-Agent，带 ETag 做条件请求（304 复用内存里的上一份）；按 zstd 帧魔数判断是否解压（`Bun.zstdDecompress`），再 `JSON.parse`。超时 10 秒（`DEFAULT_OPENAI_COMPATIBLE_DISCOVERY_TIMEOUT_MS`，`cat/discovery/openai-compatible.ts` 17 行）。同一个 fetch 实现内并发请求合并为一次（`CatalogSession`，173–200 行）；刷新失败时返回上次成功的内存副本（`fetchWellKnownModels`，218–224 行）。
- 返回形状（2026-11-20 实测：压缩后 235 KB，解压 3.58 MB，324 个服务商键）：`Record<服务商键, { id, name, env, api?, models: Record<模型 id, ModelsDevModel> }>`。`ModelsDevModel`（openai-compat.ts 124–149 行）字段：`id、name、kind、tool_call、reasoning、reasoning_options[{type:"effort"|"toggle", values?, min?, max?}]、limit{context,output}、cost{input,output,cache_read,cache_write}、modalities{input,output}、status`。实测样例：`deepseek.models["deepseek-flash"].reasoning_options = [{type:"toggle"},{type:"effort",values:["low","high","max"]}]`；`openrouter` 键下有 381 个模型，部分 `reasoning_options: []`。
- map：`mapModelsDevToModels(payload, descriptors)`（7098 行起）按 `ModelsDevProviderDescriptor`（`modelsDevKey`、`providerId`、`api`、`baseUrl`、过滤与变换函数，7058–7095 行）把某个键下的模型转成 `ModelSpec`，默认跳过 `tool_call !== true` 的行；再经 `filterModelsDevCatalogRows` 去掉 KDL 规则排除的模型（`cat/provider-models/models-dev-policies.ts`）。`modelsDevCatalogFallback` 固定 `additiveOnly: true`：远端只能新增 id，不能改写打包目录里已有模型的元数据。
- 哪些服务商有 models.dev 描述：`MODELS_DEV_CATALOG_PROVIDER_IDS`（7818 行），实测 40 个：amazon-bedrock、google-vertex、anthropic、google、openai、groq、cerebras、cline-pass、together、coreweave、nvidia、xai、deepseek、zai、umans、xiaomi、minimax-code、minimax-code-cn、alibaba-coding-plan、zhipu-coding-plan、azure、cloudflare-ai-gateway、mistral、opencode-zen、opencode-go、github-copilot、minimax、minimax-cn、huggingface、kilo、moonshot、nanogpt、synthetic、venice、ollama-cloud、xiaomi-token-plan-ams/cn/sgp、qwen-portal、zenmux。**openrouter 不在其中**（它靠端点发现，见 1.4）。
- 同一份 stencil 数据还有第二个用途：端点发现到的推理模型若没有服务商自报的思考档，用 stencil 里发布的 `reasoning_options.effort.values` 补档（`applyPublishedEffortLadders`，openai-compat.ts 434–458 行，见第 3 节）。

### 1.3 磁盘缓存 models.db

`cat/model-cache.ts`：

- 依赖 `bun:sqlite`（5 行），只能在 Bun 进程里用。一个库两张表：`model_cache(provider_id 主键, version, materialization_policy, updated_at, authoritative, static_fingerprint, header_omitted_model_ids, unrestorable_header_model_ids, header_restore_version, models_hash, models)` 与只记新鲜度的 `model_cache_refresh`（244–265 行）；WAL 模式，跨进程原子读写。
- 存的是物化后的完整 `Model`（含 thinking、compat），不存请求头（避免把凭据写进缓存，10–29 行注释）。缓存键含 `CACHE_SCHEMA_VERSION = 14`、`app-<VERSION>:builder-1:rules-<规则版本>-<hash>`（30–49 行）：pi-catalog 升级或 KDL 规则变化后旧行自动作废。
- TTL：pi-catalog 默认 2 小时（`DEFAULT_CACHE_TTL_MS`，model-manager.ts 19 行，`cacheTtlMs` 可覆盖，56 行）；omp 的 coding-agent 实际传 24 小时（`ca/config/model-registry.ts` 2171、3721 行）。
- 路径：不传 `cacheDbPath` 时用 `getModelDbPath()`（model-cache.ts 386 行），即 omp 的 agent 目录 `~/.omp/agent/models.db`（`pi-utils/src/dirs.ts` 968 行）。**NeuroBook 若接入必须显式传 `cacheDbPath`，否则会写进用户的 omp 目录**。

### 1.4 服务商端点发现

- `PROVIDER_DESCRIPTORS`（`cat/provider-models/descriptors.ts` 191 行）：每个有 KDL 条目且在 `MODEL_MANAGER_FACTORIES`（99–181 行）里有工厂的服务商一项，实测 78 个；`createModelManagerOptions({ apiKey, baseUrl, fetch })` 返回带 `fetchDynamicModels` 的 `ModelManagerOptions`。没有运行时发现的打包服务商只有 gitlab-duo、google-antigravity、google-gemini-cli、openai-codex、snowflake（后四个由 coding-agent 用 OAuth 另建）。
- 通用实现 `fetchOpenAICompatibleModels`（`cat/discovery/openai-compatible.ts` 143 行起）：`GET <baseUrl>/models[?query]`，有 apiKey 时加 `Authorization: Bearer`；接受 `{data|models|result|items:[...]}` 或裸数组；失败返回 `null`，成功无模型返回 `[]`；每个服务商用 `mapModel`/`filterModel` 处理自家字段。
- **OpenRouter 有发现描述**：`openrouterModelManagerOptions`（openai-compat.ts 3574 行起）。KDL 写 `discovery label="OpenRouter" allow-unauthenticated=#true`（`cat/compat/rules/providers/openrouter.kdl`），即不带密钥也能拉（OpenRouter 的 `/api/v1/models` 公开）。它并行拉六类：对话模型（`/models`，只留 `supported_parameters` 含 `tools` 的）、图片、decisions、rerank、视频、embedding；对话模型的 `reasoning.supported_efforts`/`default_effort`/`mandatory` 映射成 `thinking: { mode:"effort", efforts, defaultLevel?, requiresEffort? }`（`mapOpenRouterThinking`，3555–3572 行），价格、上下文、最大输出、图片输入也来自端点。打包目录里 openrouter 有 762 行：chat 587、image 63、embedding 35、video 31、judge 31、rerank 10、stt 5。
- `dynamicModelsAuthoritative` 只在少数服务商（如 siliconflow，打包为 0 行）为真；多数服务商（含 openrouter、deepseek、openai）端点结果与打包目录合并，不剪打包行。

### 1.5 omp 的 coding-agent 怎样用

- `ModelRegistry` 构造时 `cacheDbPath = <models.yml 所在目录>/models.db`（`ca/config/model-registry.ts` 563–564 行）。
- 组装来源（2455–2570 行）：对每个 `PROVIDER_DESCRIPTORS` 中启用且“有凭据、或 `allowUnauthenticated`、或有 models.dev 描述”的服务商，调 `descriptor.createModelManagerOptions(config)`，再挂 models.dev 回退：服务商自带 `modelsDev` 的强制 `additiveOnly`，否则用 `modelsDevCatalogFallback(providerId, fetch)`（2522–2526 行）；只有 models.dev 描述、没有端点工厂的打包服务商也挂上 `modelsDevCatalogFallback`（2545–2560 行）。每个服务商一个 `createModelManager({...options, cacheDbPath}).refresh(strategy)`，外加超时（2577–2579 行），结果记成发现状态 `ok/empty/cached/unavailable/idle`。
- 触发时机：启动 `refresh("online-if-uncached")` 或 `refreshInBackground()`（`ca/main.ts` 1067、2419、2705 行，`ca/sdk.ts` 2076 行）；`omp models refresh` 用 `"online"` 强制刷新（`ca/cli/models-cli.ts` 7–12、403–405 行）；模型选择器里按服务商 `refreshProvider(id, "online")`（742–766 行，`ca/modes/controllers/selector-controller.ts` 2184 行）；改设置后 `refresh("offline")` 只从缓存恢复（628、694 行）。
- 所以 omp 的“最新目录”不靠升级依赖：新模型 id、价格、上下文来自端点或 stencil；但“怎么调用这个模型”（compat、思考档的 KDL 规则、模型类别）仍随 pi-catalog 版本打包，新模型落在未知类别时用通用默认（见第 3 节）。

## 2. NeuroBook 现在怎么用目录

结论：NeuroBook 只读打包目录，进程内算一次、不刷新、不落缓存，没有调用 `createModelManager`/`resolveProviderModels`/`modelsDevCatalogFallback`/`PROVIDER_DESCRIPTORS` 的任何一处。模型发现只给“自定义 OpenAI 兼容服务商”做，用的是 pi-catalog 的通用 `fetchOpenAICompatibleModels`，服务商 id 写死 `custom`、不走任何服务商专用映射。目录服务商（包括 openrouter）在服务端被明确拒绝发现（`not-supported`），前端也只对自定义服务商显示“重新拉取”。更深的一层限制：目录服务商的模型解析只认打包目录里有的 id，即使把 OpenRouter 新模型发现出来也调不了（见 2.3）。

### 2.1 目录只读打包数据

- `packages/nb-harness/src/models/catalog.ts` 1–7 行文件注释写明“OMP 内置模型目录的只读视图”；`listCatalog()`（103–111 行）对 `getBundledProviders()` 逐个 `getBundledModels(id)`，结果存进模块级变量 `catalog`（100 行），“进程内算一次”。
- `packages/nb-models/src/core/core.ts` 79–81 行：`// ---- 目录（OMP 内置，进程内不变） ----`，`const catalog = new Map(listCatalog()...)`；之后 `catalogProviders`、`catalogModels`（357–365 行）、快照 `snapshotModel`（166–185 行）、解析 `resolveReference`（129–144 行）都读这张表。
- Spec 口径一致：`docs/specs/models/service.md` 输出 9“目录漂移……（OMP 升级）”、“边界与兼容”“OMP 升级时目录与能力随之变”；`docs/specs/agent/harness.md` “模型目录”一节（78–86 行）与验收 8（220 行）“对仓库锁定的 OMP 版本”。也就是说现行合同就把“目录随依赖版本变”写成了行为，在线刷新要改这几处合同。

### 2.2 发现只给自定义服务商

服务端：

- 远程方法 `discover`（`packages/nb-models/src/core/core.ts` 497–518 行），500 行是分支：`if (provider.kind !== "custom" || provider.baseUrl === undefined || (provider.api !== "openai-completions" && provider.api !== "openai-responses")) return ctx.fail("not-supported", {detail: "only OpenAI compatible custom providers list their models"});` —— 目录服务商、Anthropic 格式的自定义服务商都在这里被拒。
- 501–502 行：密钥缺失时 `no-credentials`（即使端点本可匿名，如 OpenRouter）；503 行调 `discoverModels`。
- `discoverModels`（`packages/nb-harness/src/models/catalog.ts` 208–241 行）：包一层 fetch 记状态码，调 `fetchOpenAICompatibleModels({api, provider: "custom", baseUrl, apiKey, headers, ...})`（223–232 行），**不传 `mapModel`**，所以只拿到 `id`、`name`；上下文、视觉、推理全靠 `suggestFromCatalog(spec.id)`（156 行）按 id 去打包目录里猜参照。`DiscoverModelsOptions.api` 只允许 `openai-completions | openai-responses`（192 行）。

前端：

- `packages/neuro-book/src/plugins/models/web/components/ProvidersPage.vue` `loadCandidates`（195–216 行）：199 行 `if (provider.kind === "catalog")` 走 `catalogModels`（打包目录里这家的全部模型），否则走 `discover`。
- 同文件 441 行 `:discoverable="current.kind === 'custom'"`，`ManageModelsDialog.vue` 25–26 行注释“自定义服务商才有‘重新拉取’”，116 行 `v-if="discoverable"` 才渲染“重新拉取”按钮。
- `applyManage`（235–250 行）：目录模型加入时只写 `{id, enabled: true}`（237 行），自定义模型把发现与参照得到的字段写进设置。

为什么 openrouter 不能发现/重新拉取：不是 OMP 不支持（OMP 有 `openrouterModelManagerOptions`，且允许匿名，见 1.4），而是 NeuroBook 在服务端 500 行与前端 441 行两处按 `kind` 把目录服务商排除了；目录服务商的候选来自打包目录（openrouter 打包了 762 行，其中 chat 587 行），开发者看到的“不能自动发现”就是这份静态列表。

关于开发者说的“添加全部”：master 与 w00032 分支的 models 插件里都没有“添加全部”字样（全文搜过 `packages/neuro-book/src/plugins/models`、`packages/nb-models`、`docs/specs/models`）。目录服务商的模型列表头是 `ProviderDetail.vue` 256–259 行的“管理模型”与“检测全部”（“手动添加”只对自定义服务商，257 行 `v-if="provider.kind === 'custom'"`）。推断开发者说的“添加全部”是“检测全部”，需要当面确认。

### 2.3 目录服务商的模型解析只认打包 id

- `packages/nb-harness/src/models/target.ts` `catalogModel`（157–170 行）：先查 `getBundledProviders()` 有没有这家（159 行），再 `getBundledModel(provider.id, config.id)`（160 行），找不到返回 `null` → `buildResolution` 得 `unknown-model`（83–84 行）。
- `packages/nb-models/src/core/core.ts` 138 行：`if (provider.kind === "catalog" && catalogModel(provider.id, model.id) === undefined) return {ok: false, code: "unknown-model"};`，快照里同样标 `missing`（170 行，`service.md` 输出 9）。
- 后果：要让目录服务商“发现新模型并能用”，不能只放开 `discover`，还要让解析层认得在线目录里的 `Model`（来自 `createModelManager().refresh()` 的结果，或把发现行用 `buildModel` 物化）。现在的自定义服务商路径（`customModel`，173–188 行）用 `buildModel` 现场物化，但它把用户配置整个盖回（186–187 行），且不接收 `efforts`（见第 3 节）。

### 2.4 涉及的 Spec 输出

- `docs/specs/models/service.md`：术语（26 行，目录服务商“能力与单价按目录”）；输入（`Providers` 形状，38–58 行，`kind`、`models[].efforts`；“目录模型在设置里只存用户改过的字段，其余每次从目录读”，60 行）；输出 7（快照含目录）、输出 8（解析，末尾“推理档按模型支持的档夹取”）、输出 9（目录漂移）、输出 12（`catalogProviders`、`catalogModels`、`discover` 与其业务码）、输出 15（删除时解除绑定）；非目标“发现方式之外的协议”；边界与兼容“OMP 升级时目录与能力随之变”；验收 1（自定义服务商拉取）。
- `docs/specs/models/settings-pages.md`：输出 3（添加服务商：“选中即添加（`addProvider`）”，现在添加后 `models: []`，即 `core.ts` 373 行）、输出 6（列表头“检测全部”“管理模型”“手动添加（自定义服务商）”）、输出 10（管理模型：“列目录模型（目录服务商）或 `/models` 发现的结果（自定义服务商，可‘重新拉取’）”——B 要改的就是这一条）、输出 13（角色表，现在只有绑定模型，没有推理档）。
- `docs/specs/agent/harness.md`“模型目录”与验收 8；`docs/specs/harness/models.md` 输出 12、14（推理档夹取与 `ompModelInfo.efforts`）。

## 3. 推理档：pi-catalog 怎样给档位，NeuroBook 有没有字段

结论：每个模型的档位是构建时烤进 `Model.thinking.efforts` 的，运行时 `getSupportedEfforts` 只读字段；“没有声明”分两种——不支持推理（`reasoning: false`）得空表，支持推理但没有可控档（`thinking: undefined`）也得空表，两者对夹取都是“不发推理参数”。打包目录里没有档位的推理模型很少（25 个），空表绝大多数来自不推理的模型和用户没勾“支持推理”的自定义模型。NeuroBook 的推理档现在只是会话设置 `core.effort`，角色配置 `RoleConfigSchema` 没有推理档字段；自定义模型设置里的 `efforts` 字段只进快照、不进解析。

### 3.1 pi-catalog 的档位来源

- 档位全集 `THINKING_EFFORTS = minimal, low, medium, high, xhigh, max`（`cat/effort.ts`）。
- `ThinkingConfig`（`cat/types.ts` 136–200 行）：`mode`（编码方式）、`efforts`（“永不为空：没有可控档的推理模型用 `thinking: undefined`”）、`defaultLevel?`、`effortMap?`（档到线上值的映射）、`effortRouting?`（折叠的变体按档换 wire id）、`effortBudgets?`、`requiresEffort?`（上游不许关思考，关思考的请求夹到最低档）、`suppressWhenOff?`、`unverified?`（目录没有证据它会推理：给出档位供用户选，但不选时按不推理发）。
- 读取（`cat/model-thinking.ts`）：`getSupportedEfforts(model)`：`reasoning` 为假返回 `[]`，否则 `model.thinking?.efforts ?? []`（23–28 行）。`clampThinkingLevelForModel(model, requested)`（47–77 行）：`model` 缺省原样返回；`reasoning` 为假或 `requested` 未给返回 `undefined`；在档位表里原样返回；否则取“不高于所选的最高档”，比最低档还低时取最低档；档位表为空时得 `undefined`。实测 deepseek-flash（`low, high, max`）：`medium→low`、`xhigh→high`、`minimal→low`。另有 `minimumSupportedEffort`、`defaultSupportedEffort`（`requiresEffort` 模型关思考时的夹取目标）。
- 档位怎么定（`cat/compat/resolve.ts` `resolveThinkingPolicy`，1174–1229 行；构建时由 `buildModel` 或目录生成器跑一次）：显式给了 `thinking.efforts` 的（端点发现自报，如 OpenRouter 的 `supported_efforts`、stencil 的 `reasoning_options.effort.values`）以它为准；否则用 KDL 规则 `thinking-efforts`；再否则按接口格式给通用默认 `fallbackEfforts`（1073–1094 行）：`anthropic-messages`、`openai-responses` 系、`thinkingFormat: openai` 且支持 `reasoning_effort` 的 completions 给 `minimal…xhigh`，其余给 `minimal…high`（`DEFAULT_REASONING_EFFORTS`，1021–1022 行）。`reasoning` 为假且没有升级规则时 `thinking: undefined`。
- 端点发现的推理模型若服务商不报档、也没有 KDL 规则，`applyPublishedEffortLadders`（`openai-compat.ts` 434–458 行）用 stencil 目录里同一 host、同一 id 发布的档位纠正通用默认；查不到就保留通用默认。
- 实测（打包目录 18.14.0，只算 chat 类）：5703 个模型中推理 3767、不推理 1936；推理但没有档位的 25 个（多在 cline-pass）；只有一个档的 22 个（如 google gemma-4 系只有 `high`）；`requiresEffort` 672 个，带 `defaultLevel` 224 个，`unverified` 0 个。最常见档位：`minimal…xhigh` 1490、`minimal…high` 957、`low…max` 356、`low,high,max` 275。
- 自定义模型（`buildModel`，provider 为未知 id）实测：`reasoning: true` 且 id 不认识时得通用默认 `minimal…xhigh`（openai-completions）；id 认得出类别时套类别规则（如 `deepseek-flash` 得 `low, high, max`）；`reasoning: false` 得 `thinking: undefined`。

### 3.2 NeuroBook 现状

- `clampEffort`（`packages/nb-harness/src/models/catalog.ts` 140–143 行）就是 `clampThinkingLevelForModel` 的包装，`supportedEfforts`（136–138 行）就是 `getSupportedEfforts`。真正夹取发生在适配器：`packages/nb-harness/src/kernel/model/omp.ts` 309 行 `request.effort === undefined ? undefined : clampThinkingLevelForModel(target.model, request.effort)`；`ompModelInfo` 把 `getSupportedEfforts(model)` 交给 `ModelInfo.efforts`（75 行）。`unverified` 模型不选档时由 pi-ai 的 `withoutUnverifiedThinking` 按不推理发（`node_modules/@oh-my-pi/pi-ai/src/stream.ts` 1178 行）。
- 推理档的来源只有会话：`CoreSettings.effort: string | null`（`packages/nb-harness/src/kernel/api/model.ts` 145–150 行，缺省 `null`，`kernel/state/kernel-state.ts` 142 行），对话、预览、压缩都用它（`run/loop.ts` 310 行、`session/preview.ts` 128 行、`compaction/compact.ts` 178 行）。子代理调用可另给 `effort`（`docs/specs/agent/subagents.md` 46 行）。
- 角色没有推理档：`RoleConfigSchema`（`packages/nb-models/src/config/shapes.ts` 50–58 行）只有 `id、axis、name、description、model`；快照的 `SnapshotRoleSchema`（`contract/shapes.ts` 66–74 行）同样没有。`ModelResolution`/`ModelInfo` 也没有“建议的档”这一项，所以角色即使有档，现在也没有通道交给内核。
- 模型配置里的 `efforts?: string[]`（`config/shapes.ts` 30 行）只用在快照（`core.ts` 180 行，`model.efforts ?? 目录的 efforts ?? []`）；`modelTargetOf`（`core.ts` 108–119 行）不传它，`ModelTarget`（`target.ts` 45–58 行）也没有这个字段，所以自定义模型的实际档位由 `buildModel` 按 id 推出，可能与快照里显示的不同。前端编辑对话框不编辑它、原样带回（`ModelEditDialog.vue` 122–123 行），发现加入时也不写（`ProvidersPage.vue` 236–249 行），所以自定义模型快照里的 `efforts` 基本总是空表，界面的推理图标只写“支持推理”。
- 开发者反馈 10“有些模型没提供思考档，界面直接把思考档调节隐藏了”对应：Composer 的 `thinkingLevels` 来自会话解析结果的 `model.efforts`（`packages/neuro-book/src/plugins/agent/web/session-host.ts` 1944 行），`AgentRoleModelPicker.vue` 217 行 `v-if="props.thinkingLevels.length > 1"`——空表（不推理、没档、自定义模型没勾推理）和只有一个档（22 个）都会隐藏。

## 4. 落到 NeuroBook 的可行做法（只列选项与代价）

先补一条调研中顺带发现、影响下面几项的现状（从代码推断，未在界面上验证）：`listCatalog()` 不按模型类别过滤（`catalog.ts` 103–111 行直接 `getBundledModels(id)`），`catalogModels` 也不过滤（`core.ts` 358–365 行），所以目录服务商的“管理模型”会把 image、embedding、rerank、video、judge、stt 类模型一起列出（openrouter 762 行里非 chat 的 175 行）。NeuroBook 只用对话模型，无论选哪种做法都应只列 `modelKind(model) === "chat"`（pi-catalog 的 `types.ts` 导出 `modelKind`）。

### 4.a 在线目录刷新

放在哪一层：

| 选项 | 做法 | 代价 |
|---|---|---|
| a1（推荐） | 在 `nb-harness/src/models` 新增目录服务：每个用到的服务商一份 `createModelManager({...descriptor.createModelManagerOptions({apiKey, baseUrl, fetch}), modelsDev: 自带的强制 additiveOnly 或 modelsDevCatalogFallback(id), cacheDbPath, cacheTtlMs})`，组装方式照抄 omp 的 `#collectBuiltInModelManagerOptions`（`ca/config/model-registry.ts` 2378–2570 行，关键段 2455–2570 行）；`nb-models` 的 core 把 79–81 行的静态 `catalog` 换成这个服务的当前结果，刷新完调 `invalidate()`。目录服务商的解析（`target.ts` 157–170 行）改为接收目录服务给出的物化 `Model`，不再 `getBundledModel` | 合并、缓存、失败回退、ETag、5 分钟退避都复用 pi-catalog；要改 `listCatalog` 的“进程内不变”假设与 `agent/harness.md`“模型目录”、`models/service.md` 输出 7、9、12 与边界；`descriptor.createModelManagerOptions`、`modelsDevCatalogFallback` 走的是 pi-catalog 子路径 `provider-models`，与现有 `compat/auth` 一样属于“随版本变”的接口，需要快照测试兜底 |
| a2 | 只接 stencil：宿主自己 `fetchWellKnownModels` + `mapModelsDevToModels`，不接端点发现 | 简单；但 openrouter 等 44 个只有端点描述、没有 models.dev 描述的服务商拿不到新模型，解决不了 B |
| a3 | 直接用 omp coding-agent 的 `ModelRegistry` | 会带进 `models.yml`、AuthStorage 凭据池、OAuth、扩展等整套语义，与 NeuroBook 自己的服务商设置重复；依赖面大，不推荐 |
| a4 | 不在线刷新，只定期升级 pi-catalog | 零新代码；满足不了 A |

缓存放哪：`<状态根>/agent/models.db`，与 `credentials.db`（`plugins/models/backend/plugin.ts` 36 行）同目录。**必须显式传 `cacheDbPath`**，否则 pi-catalog 写进 `~/.omp/agent/models.db`，与用户本机的 omp 共用、互相影响（1.3）。TTL 可沿用 omp 的 24 小时（pi-catalog 缺省 2 小时）。pi-catalog 升级后缓存行按 `materialization_policy` 自动作废，第一次启动回到打包目录直到刷新成功，不需要迁移。`model-cache.ts` 依赖 `bun:sqlite`，只能在服务端（Bun）用，浏览器端照旧只经远程合同拿结果。

刷新时机（参照 omp，1.5）：

- 入口激活时 `offline`：只读打包加缓存，不等网络，不拖慢启动（`resolve` 是同步的，`service.md` 状态与转换）。
- 激活后后台 `online-if-uncached`：缓存过期才联网；完成后重算快照、推一次 `changed`。
- 添加服务商、填完密钥、“管理模型”里点“重新拉取”：对这一家 `online`。
- 可选一个“刷新目录”的远程方法（例如 `refreshCatalog(provider?)`，读写性质为 read），返回 `source`、`stale`、`updatedAt` 给界面显示“目录更新于……/离线，用的是内置目录”。

失败与离线：`refresh` 不抛错，远端失败时结果回落到缓存或打包目录并标 `stale`（1.1）；NeuroBook 只需把 `stale`、`source` 放进快照与一条诊断（不记密钥、遮盖 URL 里的凭据）。离线时永远可用打包目录；首次离线启动等于今天的行为。

要开发者定的点：

- 每次启动连 `catalog.stencil.so`（第三方，带 omp 的 User-Agent）与各服务商 `/models`，对本地优先的产品是新的外联。是否默认开、是否给一个“在线更新模型目录”开关（关时策略固定 `offline`）。
- 目录漂移的来源变多：除了 OMP 升级，`dynamicModelsAuthoritative` 的服务商（如 siliconflow）端点不再列某模型、或 KDL 规则排除时，设置里的引用会变成 `missing`（`service.md` 输出 9 要改措辞）。
- 新模型的“怎么调用”（compat、思考格式）仍由打包的 KDL 规则决定，认不出类别的新模型套通用默认，可能与上游实际不符；omp 接受这个风险。

### 4.b 所有服务商统一“发现 + 重新拉取 + 添加即全部”

统一发现与重新拉取：

- 目录服务商：“管理模型”的候选改成 4.a 目录服务对这一家的当前结果（打包加缓存加 stencil 加端点发现），“重新拉取”即对这一家 `online`。有端点描述的 78 家里，openrouter、zenmux、ollama 等 `allowUnauthenticated` 的不要密钥也能拉；其余要密钥，没有密钥时只能用打包加 stencil（`discover` 现在的 `no-credentials` 语义要改成“没有密钥时用离线目录”而不是失败）。
- 没有任何在线来源的（gitlab-duo、google-antigravity、google-gemini-cli、openai-codex、snowflake，多为登录类，现在就标“要登录”停用）：“重新拉取”停用并写原因。
- 自定义服务商：两条路。b1 保留现在的 `discoverModels`（只拿 id 和名字，靠 `suggestFromCatalog` 补参数）；b2 也套 `createModelManager`，`fetchDynamicModels` 包 `fetchOpenAICompatibleModels`，provider 用这家自定义服务商的 id，结果进同一个缓存、经 `buildModel` 物化（得到按 id 推出的档位与上限）。b2 让两类服务商的数据通路一样，代价是自定义模型的“用户配置盖过目录推断”规则（`target.ts` 186–187 行）要重新划界。
- 开发者反馈 3 的“服务商列表是模板”：如果目录条目只作模板（复制 baseUrl、api、密钥变量与“发现用哪个描述”），设置形状要从 `kind: "catalog" | "custom"` 变成“自定义服务商 + 可选 `template: <目录 id>`”，发现按 `template` 找 `PROVIDER_DESCRIPTORS`，找不到用通用 `/models`。代价：`Providers` 形状、`service.md` 术语与输出 5、9、12 全要改，已有设置要迁移；好处是“从 Gemini 模板建、再改成 GPT 格式”自然成立，id 冲突规则也统一。这是比 B 更大的取舍，宜单独交开发者定。
- Anthropic 格式的自定义服务商现在 `not-supported`（`core.ts` 500 行）；pi-catalog 的 `anthropicModelManagerOptions` 会拉 `/v1/models`（带 `x-api-key`），中转站多半不实现，可以照试、失败按 `not-supported` 显示。

“添加即全部”的边界：

- 规模（实测）：openrouter 打包 chat 587 个，stencil 的 openrouter 键 381 个，端点发现只留支持 tools 的；zenmux 打包 296 个；多数直连厂商只有几个到几十个（deepseek 4、anthropic 19、moonshot 17、openai 73 行含非 chat）。
- 字面“全部写进设置”的代价：设置文件里几百行 `{id, enabled: true}`；模型列表、“全部模型”、Composer 的模型库、角色下拉都要承载几百项；“检测全部”并发 4、每个发一条真实请求，对 openrouter 等于几百次计费请求；之后目录新增的模型不会自动进来、下架的变 `missing`。
- 选项：

| 选项 | 做法 | 代价 |
|---|---|---|
| c1 跟随目录（推荐） | 服务商加一个“模型跟随目录”的开关（例如 `models` 外另存 `follow: true`），启用集合 = 目录当前的 chat 模型减去用户移出的；设置里只存覆盖（移出的 id、改过的字段），与“目录模型在设置里只存用户改过的字段”（`service.md` 60 行）一致 | 设置形状与 `setModels` 语义要改；目录刷新会让可用模型集合自己变（角色绑的模型下架照输出 9）；“检测全部”要限量或只检角色用着的 |
| c2 添加时写入全部，设阈值 | 添加服务商时若 chat 模型不超过 N（例如 50）个就全部写入启用，超过时（聚合商）只写 OMP 的 `defaultModel`（KDL `default-model`，openrouter 是 `openai/gpt-5.5`）并提示去“管理模型” | 实现小、行为好解释；阈值是拍出来的；之后的新模型不自动进 |
| c3 字面全部 | 不论多少都写入 | 最简单；聚合商下体验差、检测有成本 |

  不论哪种都应：只取 chat 类；去掉 `status: deprecated`（stencil 字段）与 KDL 排除的；自定义服务商缺上下文窗口的照现在规则“加入但停用”（`settings-pages.md` 输出 7）。

### 4.c 角色加推理档

配置形状（`RoleConfigSchema` 加一个可选字段，快照 `SnapshotRoleSchema` 同步加）：

- 选项 1：`effort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`，不写为“不指定”（交给会话或模型默认）。
- 选项 2：在选项 1 上加 `"off"`，对应内核已有的 `params.disableReasoning`（`kernel/api/model.ts` 82 行注释：不写 effort 时默认开思考的模型照样思考）。`requiresEffort` 的模型（打包 672 个）关不掉，pi-ai 会夹到最低档，界面要说明。

存与夹：

- 存用户选的原值，不在写入时按模型夹：换绑模型、目录刷新改了档位表时用户意图不丢。解析时用 `clampEffort` 夹（往下夹到支持的档，低于最低档取最低档，不推理的模型不发；3.1）。界面在角色行显示“选 medium，这个模型实际用 low”。
- 写入时只校验是六档之一（或 `off`），不校验模型支持。

交给内核的通道（现在没有，3.2）：

- 选项 A：`ModelInfo` 加 `defaultEffort?`（解析走到角色时由 `nb-models` 填角色的档），内核取 `core.effort ?? info.defaultEffort`。请求记录、预览、请求追踪里看到的是实际用的档。要改 `harness/models.md`、`kernel/run/loop.ts` 310 行、`session/preview.ts` 128 行、`compaction/compact.ts` 178 行等取档的几处。
- 选项 B：`nb-models` 包一层 `call()`，`request.effort` 为空时塞角色的档。改动小，但内核与请求追踪不知道档从哪来，预览与实际请求会不一致，不推荐。
- 优先级要开发者定：会话里显式拖了档（`core.effort` 非空）是否盖过角色；建议“会话显式 > 角色 > 模型的 `defaultLevel` > 不发”。压缩（`compaction` 角色）的就地压缩现在要求“模型、推理档与消息前缀和对话请求相同”（`agent/compaction.md` 40、89 行），角色档不宜改就地压缩，只用于独立摘要请求。

没有档位的模型（反馈 10）：

- 不隐藏控件：档位表为空时显示停用的控件并写原因（“这个模型不支持推理”/“目录没给推理档”/“自定义模型没勾支持推理”）；只有一个档时显示为固定值。现在 `AgentRoleModelPicker.vue` 217 行 `length > 1` 才显示。
- 自定义模型补档位：让编辑对话框能编辑 `efforts`，`modelTargetOf` 把它交给 `ModelTarget`，`customModel` 构建时作为 `thinking: {mode: "effort", efforts}` 传给 `buildModel`（`resolveThinkingPolicy` 以显式档位为准，3.1），消除“快照显示的档与实际夹取的档不一致”（3.2）。没填时沿用 `buildModel` 按 id 推出的档，并把推出的档写进快照，界面才不会显示空表。
- `unverified` 档位（目录没证据会推理，打包目录里 0 个，但在线发现的新模型可能出现）：可选、默认不发，界面标“未确认”。

## 附：调研方法

- 读源码：仓库 `node_modules/@oh-my-pi/pi-catalog/src`（18.14.0）与本机全局 `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src`（18.14.1，其依赖的 pi-catalog 18.14.0 与仓库源码 `diff -rq` 无差异）。
- 用 Bun 在仓库外的临时目录导入 pi-catalog 源码统计：`PROVIDER_DESCRIPTORS` 78 个、`MODELS_DEV_CATALOG_PROVIDER_IDS` 40 个、只有端点描述的 44 个、允许匿名发现的 19 个（charm-hyper、cline-pass、commandcode、deepinfra、factory-droid、google-vertex、kilo、litellm、lm-studio、local、novita、ollama、openrouter、umans、venice、vercel-ai-gateway、vllm、web、zenmux）；打包目录按类别与档位的计数；`clampThinkingLevelForModel` 与 `buildModel` 的实际结果。
- 2026-11-20 实际请求一次 `https://catalog.stencil.so/models.json.zstd`（200，`content-type: application/zstd`，235,431 字节，带 ETag）确认返回形状。
- 没有改动任何代码；没有在界面上验证，界面相关的结论（例如“管理模型”列出非对话模型）是从代码推断。
