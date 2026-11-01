# 模型服务：OMP、新应用与旧应用的现状（t09）

2026-11-01 为 [t09](../tasks/t09-models/README.md) 出静态稿与写计划做的调研。三份只读调研由子代理完成，关键事实主会话抽查过（OMP 凭据库路径、旧 nb-harness 的目录函数、设置 Spec 的密钥一节）。旧应用一节末尾的“建议”是主 Agent 的推荐，不是决定，交开发者逐项定。

## 1. OMP 18.14.0（`node_modules/@oh-my-pi/`）

装了 9 个包：omptype、pi-agent-core、pi-ai、pi-catalog、pi-natives（含 linux-x64）、pi-utils、pi-wire、snapcompact。没有 pi-coding-agent，所以 `models.yml`、`ModelRegistry`、`!command` 取值这些 coding-agent 层的东西都没有。

**凭据库**

- `AuthStorage.create(dbPath)`（`pi-ai/src/auth-storage.ts:268`）可以传任意路径；默认是 `<agent 目录>/agent.db`，凭据只是其中的 `auth_credentials` 表（另有限流封禁、OAuth 刷新租约、用量等表）。没有叫 `credentials.db` 的文件，t09 决定 2 写的路径照样能用，只是文件里还有别的表。
- 明文 JSON 存储，不加密；目录 0700、文件 0600；WAL，跨进程用 `PRAGMA data_version` 感知变更；删除是软删除（写 `disabled_cause`）。
- 没有 `env:<变量名>` 写法。默认的取值兜底是“值恰好是一个已设置的环境变量名就取它的值，否则当字面量”（`pi-ai/src/auth/cascade.ts:23-27`）：写了一个没设置的变量名，会被当成密钥本身发出去。
- `keys.get(provider)` 的优先级是：运行时覆盖、配置覆盖、OAuth、`/login` 存的密钥、**环境变量**、库里存的 API Key（`pi-ai/src/auth/types.ts:935-944`）。环境变量排在库里存的密钥前面：用户设了 `OPENAI_API_KEY`，界面里填的密钥会被它盖掉。
- `streamSimple` 的 `apiKey` 可以是字符串，也可以是解析函数（`ApiKeyResolver`，在发请求前解析，`pi-ai/src/auth-retry.ts:64`）。

**OAuth**（第一版不做，开发者 2026-11-01 定，事实留给以后）

- 约 20 家服务商：anthropic、openai-codex、github-copilot、google-gemini-cli 等；授权地址经 `onAuth({url})` 交给宿主打开，库本身不开浏览器。
- 回调服务器绑在 OMP 所在机器的本机地址上，端口按服务商固定（openai-codex 1455 且不换端口）；浏览器不在同一台机器上时只能粘贴回调地址（`onManualCodeInput`）。
- 令牌提前 60 秒刷新，跨进程用租约表防止重复刷新。

**模型目录与发现**

- 内置目录是静态的 `pi-catalog/src/models.json`：`getBundledProviders()`、`getBundledModels(provider)`、`getBundledModel(provider, id)`（找不到时返回 undefined，类型却标成 `Model`）。
- `Model` 字段：`id`、`name`、`api`、`provider`、`baseUrl`、`reasoning`、`thinking`（档位、映射）、`input`（text、image）、`contextWindow`、`maxTokens`（都可能为 null）、`cost`（四项单价，另有长上下文与按时间的价格）、`headers` 等。
- 自定义服务商在代码里用 `buildModel(spec)` 定义，不读家目录的配置；`/models` 发现有现成的 `fetchOpenAICompatibleModels`（缺省超时 10 秒，失败返回 null）。
- 推理档：`getSupportedEfforts(model)`、`clampThinkingLevelForModel(model, requested)`。
- 副作用：`pi-utils` 被导入时把家目录、`~/.omp`、`~/.omp/agent` 与当前目录的 `.env` 并进 `process.env`，没有关闭开关（ADR 0032 的第 3 层来源）。

**仓库里的用法**

- 只有 nb-harness 直接依赖 OMP；nb-story 经 nb-harness 的导出使用。
- 旧 nb-harness 的根导出里已有：`defineModel`（自定义服务商的模型，密钥按变量名取）、`resolveModel`（目录模型，密钥用 OMP 的 `getEnvApiKey`）、`listCatalog`、`providerAccess`（`keyless`、`login`、`key`、`unsupported`）、`providerKeyReady`、`supportedEfforts`、`clampEffort`、`discoverModels`（包装 `fetchOpenAICompatibleModels`，按状态码区分空、不支持、鉴权、连不上、失败）。
- 新内核的模型端口 `ModelPort.resolve(settings, purpose, role?)` 是同步的；OMP 适配器 `ompCall({model, apiKey: () => string, priceKnown})` 的取密钥函数也是同步的。
- 新内核的架构测试只允许它用 pi-ai、pi-catalog、pi-utils。

## 2. 新应用（`packages/neuro-book`）

- 插件由描述 `plugin.ts`（id、版本、运行位置、声明式贡献）与 `backend/`、`web/` 里的入口（`defineEntry`：依赖、`provides`、`remoteProvides`、`activate`）组成；对外的服务键与远程合同放 `shared/contracts.ts`。内置插件登记在 `src/manifest.ts` 的 `productPlugins` 与各运行位置的常量表。
- 同一实例内的服务用 `dependencies` 加 `context.services.require(key)`；跨实例用 `defineRemoteService` 的 TypeBox 合同与 `context.remote.use(contract)`；运行时失败码有 `unavailable`、`not-provided`、`timeout`、`unknown-outcome` 等（`docs/specs/runtime/plugin-channel.md`）。
- 设置：`defineSetting` 声明在描述的 `settings.properties` 贡献里；用户层 `<状态根>/settings.json`，项目层 `<项目>/.nbook/settings.json`；“指定网络地址或凭据”的项只允许用户层。设置窗口有 `settings.sections`（按 schema 用 nb-form 画）与 `settings.pages`（插件自己的页面）两个贡献点，左栏分 app、ai、plugins 三组。
- 密钥：`secret: true` 登记时被拒；`settings/configuration.md` 输出 20（planned）写“存储方式随第一个使用者定”。w00027 t08（密钥存储）2026-10-20 搁置：开发者定暂不加密。现在没有任何插件存密钥。
- 状态根：`stateRootKey` 只在服务端提供；没有通用的插件数据目录接口，插件直接在状态根下建子目录（文件插件就是这样）。
- 仓库里还没有 `nbook.models`、`nbook.agent` 的代码。

## 3. 旧应用（`packages/neuro-book-legacy`，只作参照）

旧应用不用 OMP，用 `@earendil-works/pi-ai`；运行时只认用户配置的服务商与模型，不读内置目录。密钥明文存在 `config.json`，界面显示打码后的值。

| # | 旧应用的可观察行为 | 出处 | 建议 |
|---|---|---|---|
| 1 | 服务商列表：名称、停用徽标、可运行模型数；模板下拉加“添加”，模板是白名单内的内置服务商加“自定义” | `settings/sections/providers/components/ModelProviderRail.vue` | 做：目录服务商（OMP 内置）与自定义的 OpenAI 兼容服务商两类，见待定问题 1 |
| 2 | 新建时 id 冲突自动加 `-2` 后缀 | `useProviderTemplateSession.ts:60-71` | 做（只对自定义服务商） |
| 3 | 已保存服务商的 id、地址、代理只读，要改先“复制连接”（不带密钥） | `ModelProviderDetail.vue:47-48`、`useModelSettingsDraftSession.ts:475-510` | 不做“复制连接”：它为“按数组位置保留密钥”而存在。id 建后不变（凭据按 id 存）；地址能不能直接改见待定问题 2 |
| 4 | 代理字段 | `ModelProviderDetail.vue:174-185` | 不做：旧应用的模型检测遇到代理直接失败，本来就没走通 |
| 5 | 服务商级的接口格式（必填） | `ModelProviderDetail.vue:194-209` | 做（自定义服务商）；目录服务商随目录 |
| 6 | 密钥：密码框，已设置时显示打码后的值，可清除，留空保存表示不改 | `ModelProviderDetail.vue:213-233` | 做，但只显示“已设置／未设置”，不显示打码值（`configuration.md` 输出 20）；另加 `env:<变量名>`（t09 决定 2） |
| 7 | 超时、最大重试、请求扩展参数 JSON | `ModelProviderDetail.vue:243-270` | 不做 |
| 8 | 服务商的启用／停用 | `ModelProviderDetail.vue:94-103` | 不做：模型逐个启用已经够用，见待定问题 3 |
| 9 | 删除服务商：被引用时拒绝 | `useModelSettingsDraftSession.ts:520-561` | 改：允许删除，确认框列出会变成未绑定的角色 |
| 10 | 模型逐个启用、停用、删除；停用的进“已停用”列表 | `SavedModelsList.vue` | 做启用／停用；目录服务商的模型来自目录，只有自定义服务商的模型能删 |
| 11 | 模型编辑对话框四个页签：基本（名称、id、分组、接口）、能力（上下文窗口、最大输出、看图、推理）、请求参数（compat、headers、推理档映射三段 JSON）、价格 | `NovelIdeModelEditDialog.vue` | 做基本、能力、价格；另加按模型的压缩触发点（t11 决定 1）。三段 JSON 不做 |
| 12 | 价格：四项单价，全空为未知、0 合法，启用覆盖后四项必填，有阶梯价 | `provider-model-cost-draft.ts` | 做四项单价与未知／免费之分（t09 决定 7）；阶梯价不做 |
| 13 | 拉取模型列表：按接口选适配器（OpenAI 兼容、Anthropic、Google、OpenRouter），结果勾选加入；不完整的候选先补字段 | `server/models/discovery.ts`、`ModelDiscoveryDialog.vue` | 做 OpenAI 兼容的 `/models`（OMP 现成）；补字段做；别的协议先不做 |
| 14 | 手动添加模型（名称与 id 必填） | `useModelDiscoverySession.ts:117-150` | 做 |
| 15 | 逐个检测模型（发一条很短的真实请求），批量并发 4，结果只在内存 | `useModelCheckSession.ts`、`server/utils/model-settings.ts` | 做 |
| 16 | 默认模型单独一节，失效时自动选第一个可运行的 | `provider-settings-draft.ts:356-362` | 不做：缺省模型就是角色 `main`（t09 决定 4） |
| 17 | 任何校验问题（包括停用模型的缺陷）都整份拒绝保存；“一键修复” | `config-service.ts:552-566`、`useModelSettingsDraftSession.ts:614-661` | 不做：形状不对的值写不进去（设置的 schema 校验），语义问题（角色未绑定、自定义模型缺上下文窗口）在对应行标出来，不挡保存 |
| 18 | 改动 500 毫秒后自动保存 | `useProviderSettingsBinding.ts:336-388` | 照新应用设置窗口现有的写入方式 |
| 19 | 角色页：梯度四档固定；专精五个种子（summarize、writer、narrative、plan、vision）；能加自建专精角色（`custom-N`）、只有自建的能改名与描述、能删 | `sections/roles/roles-settings-draft.ts` | 做四档与自建；专精种子只放“压缩”（t11 决定 3），旧的五个没有使用方，不放 |
| 20 | 角色启用／停用、“专精角色出现在快捷选择器”开关 | `RolesSettingsView.vue` | 不做：没有使用方；选择器的事在 t17 |
| 21 | 角色配置问题：启用的角色没绑模型、没写描述 | `roleConfigIssues()` | 做“没绑模型”；描述给模型看的目录还没有使用方，不要求必填 |
| 22 | Composer 里另有一套写死的角色，按位置回落到第一个、第二个模型 | `AgentSessionModelControls.vue:87-150` | 不做：与“不回落”冲突，是占位 |
| 23 | 推理档：Composer 固定显示全部档位，超出的由服务端静默夹取 | `ModelPickerContent.vue:61-70` | 改：只显示模型支持的档（t09 决定 6，界面在 t17） |
| 24 | 会话费用：价格未知或为 0 时标签都为空 | `app/utils/cost-format.ts` | 改：未知与免费分开显示（t09 决定 7，界面在 t17） |

## 4. 由此要在计划里处理的点

- 取密钥不用 OMP 的 `keys.get`（环境变量会盖过界面里填的密钥），直接读凭据库里这个服务商的 API Key；`env:<变量名>` 由我们解析，只认进程启动时的环境（口径同 ADR 0032）。
- 凭据库路径照 t09 决定 2 传给 `AuthStorage.create`；OAuth 的表一起建好，第一版不用。
- `ompCall` 的取密钥函数改成可以异步（以后 OAuth 令牌要刷新）；`ModelPort.resolve` 保持同步，由模型服务在内存里维护目录与配置的快照。
- 旧 nb-harness 根导出里的目录、发现与推理档函数挪到不随旧 harness 退役的位置，nb-story 命令行与 `nbook.models` 共用。
