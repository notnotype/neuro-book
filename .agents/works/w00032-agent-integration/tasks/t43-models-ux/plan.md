# t43 实施计划：服务商、模型角色与模型选择器的体验改进

## Context

开发者 2026-11-20 对模型设置与 Composer 选择器提了 13 条反馈（[README](README.md#开发者的反馈2026-11-20)），经调研（[Magpie](research/magpie.md)、[OMP 在线目录](research/omp-catalog.md)）与三轮静态稿定下决定 1–17（[README 的决定](README.md#决定开发者-2026-11-20-会话)）。要解决的问题：

- 服务商分“目录”“自定义”两种，目录服务商不能发现、不能改协议、不能重复添加；模型解析只认 OMP 打包目录里的 id，不升级依赖拿不到新模型。
- 添加服务商后模型为空；OpenRouter 的“管理模型”还会列出图片、embedding 等非对话模型。
- 没有代理；没有协议检测；没有服务商图标。
- 角色不能设思考档；选择器在档位少于两个时隐藏思考档；选择器的角色卡片占地方、阴影重。

依据：[`models/service.md`](../../../../../docs/specs/models/service.md)、[`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“输入框与待处理区”、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 7、22；[ADR 0036](../../../../../docs/adr/0036-app-package-installs-omp.md)（OMP 作外部模块）、[ADR 0045](../../../../../docs/adr/0045-shared-host-packages-for-second-app.md)（nb-models 与应用无关）。本计划取代 t09 决定 11、12 的“目录、自定义两种服务商”（决定 1）。

工作方式：主会话自己写代码（全局规则：开发者没要求派子代理编码）；后端、计划审查开 omp 会话，前端审查派 Claude Sonnet。代码在 Work 分支的 worktree 上做（`.worktree/w00032-agent-integration` 快进到 master；有别的会话在用时另开 `feat/w00032-t43-models-ux`），Spec 与 Task 记录在主工作区 master 上改。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 在线模型目录、各家发现、本机缓存 | `@oh-my-pi/pi-catalog` 的 `createModelManager`、`PROVIDER_DESCRIPTORS[].createModelManagerOptions`、`modelsDevCatalogFallback`、`model-cache` | 已是依赖；合并打包目录、缓存、stencil 目录、端点发现，带 ETag 与失败回落。否决：直接用 OMP 的 `ModelRegistry`（依赖面大、读 `models.yml`）；自己拉 models.dev（重复 OMP 已做的规则与合并） |
| 区分对话模型 | pi-catalog 的 `modelKind()` | 已有分类；否决按 id 猜 |
| 读操作系统的代理设置 | `os-proxy-config`（httptoolkit，Apache-2.0） | 三个平台都覆盖（Windows 注册表、macOS、Linux 的 GNOME/KDE 设置）；否决手写各平台读法 |
| SOCKS5 出站 | `socks`（MIT，SOCKSv4/5 客户端） | 本机中继按 SOCKS5 连上游时用；Bun 1.4.4 的 `fetch` 不认 `socks5://`（探针：`UnsupportedProxyProtocol`） |
| 服务商图标 | `@lobehub/icons-static-svg`（MIT，994 个 SVG） | 覆盖国内外主要厂商；否决 `simple-icons`（缺智谱、豆包、硅基流动、xAI、Groq 等，且只是 vitepress 的传递依赖） |
| 上传图标的缩放 | 浏览器 `createImageBitmap` 加 `OffscreenCanvas` | 内建；否决引图像库 |

## 关键设计

### 网络出口：为什么要本机中继（探针结论）

探针（`/tmp` 下的一次性脚本，结论记进 `evidences/proxy-probes.txt`）：

1. Bun 的 `fetch` 按次给 `proxy` 时生效，且盖过环境变量；只认 `http://`、`https://`。
2. 环境里有 `HTTPS_PROXY` 时，`proxy: ""`、`NO_PROXY=*` 都关不掉它；Bun 每次请求现读 `process.env`。
3. 不能从 `process.env` 删掉代理变量：技能安装、评估内核、作品子进程、owned-process 都把 `process.env` 交给子进程，删了它们就没有代理了。

所以“直连”与 SOCKS5 都做不到“只设 `fetch` 的选项”。做法：服务端起一个只听 127.0.0.1 的本机中继（HTTP CONNECT 与绝对 URI 的转发），代理感知的 `fetch` 对每个出站请求显式写 `proxy: <中继地址>` 并在请求头带上这次的出口（直连、某个 HTTP 代理、某个 SOCKS5 代理）；中继按出口建连。这样“直连”盖过环境变量，SOCKS5 也能用，HTTP 代理同一条路。本机与局域网地址（pi-ai `utils/proxy` 的 `isLocalOrMetadataHost`）不经代理、仍经中继直连。

### `packages/neuro-book/src/plugins/network/`（新内置插件 `nbook.network`）

- `shared/settings.ts`：设置分区 `nbook.network`（分类 app，排在“外观”之后，page 分区，`layers: ["user"]`）；设置项 `nbook.network/proxy = {mode: "system" | "custom" | "direct"; url?: string}`，缺省 `system`，`url` 只收 `http`、`https`、`socks5`、`socks5h`，不收用户名密码（设置文件里不放凭据，信任边界同 `models/service.md`）。
- `backend/relay.ts`：本机中继。`startRelay(): {url, close()}`；出口经请求头 `x-nbook-egress`（中继读后删掉，不往外发）：`direct` 或上游代理的 URL。CONNECT：直连用 `node:net`，HTTP 上游转发 CONNECT，SOCKS5 上游用 `socks` 的 `SocksClient.createConnection`。随插件入口启停，停止时断开在途连接。
- `backend/proxy.ts`：`describeSystemProxy(env)`：先读启动环境里的 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY`（与小写），再读 `os-proxy-config`（第 1 片核对它没有原生模块；有就改成调各平台的命令行读）；结果 `{url, source: "env:HTTPS_PROXY" | "os" | null}`，缓存 60 秒。stencil 目录的请求用应用级出口的同一个 `fetch` 函数（pi-catalog 按函数合并并发的目录请求）。`egressFor(url, setting, override?)`：本机地址直连；服务商的 `proxy` 不是 `app` 时用它，否则用应用设置。
- `shared/contracts.ts`：服务键 `networkKey`：`fetchFor(override?: ProviderProxy): typeof fetch`（每次请求现读设置）；远程合同 `nbook.network/settings`：`systemProxy()`、`test()`（经当前出口请求一次 Cloudflare 的 trace 地址，回出口 IP 与耗时，或失败的类别与原文）。
- `web/`：“网络”页（第 3 轮的稿）：两组“代理”“模型目录”；行用 `SettingsRow`；“现在用的”“测试代理”“现在更新”是页面自己画的部分。“自动更新模型目录”是 `nbook.models` 的设置项，`section` 指向 `nbook.network`，页面经 `nbook.models` 的远程合同调 `refreshCatalog()` 并显示更新时间与模型数。

### `packages/nb-models/src/config/`：配置形状 v2

`shapes.ts`：

```ts
type ProviderConfig = {
    id: string;                     // 由名字生成，同一模板可以建多个（openrouter、openrouter-2）
    template: string;               // 模板 id，建后不变（要换模板就“复制一份”再改）；空白模板是 blank-openai、blank-anthropic、blank-gemini
    name: string;
    icon?: {kind: "builtin"; key: string} | {kind: "image"; data: string} | {kind: "initial"};   // 没写取模板的图标；image 是 ≤48 KB 的 PNG、WebP、JPEG data URL，按魔数判类型，不收 SVG
    api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";   // 不写：每个模型用来源给的协议（OpenRouter 的专用协议、混合协议的模板都照旧）；写了：所有模型改用这个通用协议
    baseUrl?: string;               // 不写：用模板（与模型）的地址；“恢复模板地址”即删掉它
    apiKeyEnv?: string; auth: "default" | "bearer" | "none"; headers?: Record<string, string>;
    proxy?: {mode: "app" | "system" | "custom" | "direct"; url?: string};   // 没写为 app
    followSource: boolean;          // 服务商新出的模型自动加入；缺省 true
    excluded: string[];             // 从列表移出的模型 id
    models: ModelConfig[];          // 覆盖与手加的模型（形状不变）
};
type RoleConfig = {/* 原有字段 */ effort?: "off" | Effort; icon?: string};   // effort 不写为“跟随模型”；icon 只给自建角色（lucide 类名）
```

- 旧配置的读法：设置层对不合 schema 的键整键丢弃（[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md) 输出 4），所以 schema 同时接受旧字段（`kind`）与新字段，`normalizeProvider` 读时归一、下次写入时写成新形状（同 `compactAt` 的先例），不支持降级。`kind: "catalog"` → `template = id`、`baseUrl`、`api` 照原样（写了才是覆盖）、`followSource: false`（保持“只用列出来的模型”，否则旧的 OpenRouter 用户升级后突然多出几百个）；`kind: "custom"` → 按 `api` 映射到对应的空白模板、`followSource: false`，模型全部当手加的。
- `templates.ts`：模板表的我方部分（纯数据）：`{id, group: "vendor" | "plan" | "platform" | "local" | "blank" | "login", logo?: string, regions?: Array<{id, label}>, extra?: {name, api, baseUrl, catalog?: string}}`。分组与图标键按第 1 轮的稿；`extra` 是 OMP 没有的模板（Anthropic 密钥、阿里云百炼、火山方舟、三种空白协议），各自的地址与协议在第 1 片核对官方文档。查不到分组的 OMP 服务商归 `platform`。
- `rules.ts`：`providerIdFor` 改为所有服务商共用（目录 id 不再保留）；`BUILTIN_ROLE_ICONS`（极轻量 feather、快速 zap、主力 star、深度 telescope、压缩 fold-vertical）。

### `packages/nb-harness/src/models/`：模型来源

新增 `sources.ts`：

```ts
createModelSources(options: {cacheDbPath: string; fetchFor(provider: ProviderSourceConfig): FetchImpl; now?(): number}): {
    models(providerId: string): {models: readonly Model[]; updatedAt?: number; stale: boolean; error?: SourceError};   // 同步，读内存
    refresh(provider: ProviderSourceConfig, strategy: "offline" | "online-if-uncached" | "online"): Promise<SourceResult>;   // 同一服务商在途的合并成一次
    forget(providerId: string): void;
    close(): void;
};
```

- 每个服务商一个 `ModelManager`：模板有 OMP 描述时用 `descriptor.createModelManagerOptions({apiKey, baseUrl, fetch})`，并挂 `modelsDevCatalogFallback`；没有描述的（空白模板、我方补的模板）按协议用通用发现（OpenAI 系 `fetchOpenAICompatibleModels`，Gemini 用 `discovery/gemini`，Anthropic `/v1/models`），元数据按 id 到目录里找同名模型补（现有 `suggestFromCatalog`）。`cacheDbPath` 为 `<状态根>/agent/models.db`（不传会写进 `~/.omp/agent/models.db`），`cacheProviderId` 用我方服务商 id（同一模板两家不共用缓存）。只留 `modelKind() === "chat"` 的模型。
- `target.ts`：`buildResolution` 改为从来源给的 OMP `Model` 建出（覆盖项经 `buildModel` 合上：上下文窗口、名称、单价、请求头、`efforts`；服务商改了协议或地址时也经 `buildModel` 重新物化），不再调 `getBundledModel`；`ProviderTarget` 加 `fetch`，由 `fetchFor` 给。`modelTargetOf` 带上 `efforts`（消掉快照与实际夹取不一致）。
- 模型身份：pi-ai 按 `model.provider` 走各家的专用处理（几十处），所以协议跟随模板时 `Model.provider` 保持模板的 OMP id，改了协议或用空白模板时取我方服务商 id；对外的模型全名（会话记录、用量、日志）一律由宿主给（`OmpTarget.name = <我方服务商 id>/<模型 id>`），`ompModelInfo` 与 `ompCall` 不再自己拼。同一模板的两家因此不会撞名。
- 推理但没写档位的模型在物化时补上 OMP 按协议的通用档（标 `generic`），否则夹取后选了也不发。
- `kernel/model/omp.ts`：`observedFetch(target.fetch ?? fetch, …)`，其余不变。`catalog.ts` 的 `discoverModels` 接收 `fetch` 参数（检测协议、手动发现共用）。

### `packages/nb-models/src/core/`：服务核心

- 依赖新增 `sources`、`fetchFor`（应用把 `networkKey.fetchFor` 接上）、`catalogAutoUpdate()`（现读设置）。
- 有效模型列表 `effectiveModels(provider)`：`followSource` 时为“来源里的对话模型 − `excluded`”，各自合上 `models` 里的覆盖；再加上 `models` 里来源没有的（手加的；缺上下文窗口的照旧不能启用）。不跟随时只取 `models` 里列的（合上来源的元数据）。`enabled` 缺省 true。关掉“自动加入”的那次写，服务端把此刻的有效列表全部写进 `models`（只写 id 与 `enabled`），之后不再长。
- 刷新时机：入口激活时各家 `offline`（不拖慢启动）；之后开着自动更新时后台 `online-if-uncached`；`addProvider`、`setKey`、`updateProvider` 改了地址或协议、`refreshModels(provider)`、`refreshCatalog()` 时对相关的家 `online`。刷新完成经串行队列重算快照、发 `changed`。来源失败时保留上一份，快照标 `stale` 与原因。
- 目录漂移（输出 9）改为“来源里没有了”：被覆盖或被角色引用的模型不在来源里时标 `missing`。
- `addProvider({template, region?})`：写 `template`、名称、`followSource: true`（地址与协议不写，跟随模板），然后对这家 `online` 刷新。`duplicateProvider(id)`：复制配置与密钥（凭据库里复制一行；`apiKeyEnv` 照抄）。
- 远程合同升到版本 2：新增 `templates()`（取代 `catalogProviders`）、`providerModels(provider)`（取代 `catalogModels` 与 `discover`）、`refreshModels`、`refreshCatalog`、`duplicateProvider`、`detectApi`；`setRole` 收 `effort`、`icon`；`updateProvider` 收 `icon`、`proxy`、`followSource`。快照随“全部加入”变大，第 3 片量一次 OpenRouter 全量时快照的大小与序列化耗时，超出预算再改成按服务商取模型。
- `detectApi({provider, baseUrl?, model?})`：对四种协议并行各发一条极小请求（`maxTokens` 16、`disableReasoning`、超时 15 秒），模型按协议挑（Anthropic 挑含 `claude` 的、Gemini 挑含 `gemini` 的，否则第一个启用的；都没有回 `no-model`），返回 `[{api, path, ok, ms, status?, message?}]`，原文遮盖、截断同检测。不写配置；界面点“用这个”走 `updateProvider({api})`。
- `check` 补上 `disableReasoning`（现在只是没传 effort，与 Spec 输出 11 不符）。
- 角色：`setRole` 收 `effort`、`icon`；快照的角色带 `effort`、`icon`。

### 推理档的数据流

- 档位的说法统一成 `EffortLevels = {kind: "declared"; levels: string[]} | {kind: "generic"; levels: ["off", "low", "medium", "high"]} | {kind: "none"}`：模型不推理为 `none`；推理且 `getSupportedEfforts` 非空为 `declared`（只有一档时界面画成固定）；推理但没有档位为 `generic`。快照的模型、`ModelInfo` 都用同一个函数（放 `nb-harness/models`），选择器与内核看到的一致。
- 优先级（决定 6）：会话的 `core.effort`（非 null）> 解析时角色给的 `ModelInfo.defaultEffort` > 不发。内核加一个 `requestEffort(core, info)`，对话、预览、压缩、`complete()` 四处计算请求时都用它；就地压缩用这次对话的解析结果与档位；请求已带 `disableReasoning`（审批）时不套角色档。`"off"` 映射成 `disableReasoning: true`。夹取仍在 `omp.ts`。
- 会话里“跟随”与“明确选的”：`core.effort === null` 即跟随。Composer 视图加 `thinkingFollow: {source: "role" | "model"; level: string | null; roleName?: string}`；动作 `thinking.reset` 写 `{effort: null}`。

### `packages/nb-ui/`

- `themes/nbook/vars.css`（亮暗两处）与 `src/tokens.css`：`--elevation-popover` 取现在 `--elevation-menu` 的值（决定 10）；别的主题自带的值不动。
- `SegmentedControl`：加 `variant?: "solid" | "raised"`（raised：浅轨道、当前档是浮起的面板色、字用强调色）与 `tentative?: boolean`（当前档只画细框，表示还没定）；同名 `.md` 与 Lab 场景。

### `packages/nb-agent-ui/src/vue/composer/AgentRoleModelPicker.vue`

- 类型（`types.ts`）：`ComposerIcon = {kind: "svg"; svg: string} | {kind: "image"; src: string} | {kind: "initial"; text: string} | {kind: "class"; name: string}`；`ComposerModelView` 加 `icon?`、`groupIcon?`；`ComposerRoleView` 加 `icon?`、`modelIcon?`、`effortLabel?`；`ComposerView` 加 `effortLevels`、`thinkingFollow`。`svg` 只收宿主打包的图标原文，组件用 `v-html` 画（同名 `.md` 写明调用方约束）。
- 版式照第 3 轮的稿：头部两行（当前选择与“角色｜模型库”；思考档 raised 分段，跟随时 `tentative`，行尾“X 的默认”或“用 X 的默认”）；角色页两列单行项；模型库按服务商分组带图标与个数，超过 30 个的组默认收起，搜索时只渲染命中的；“跟随默认”写出默认角色。思考档按 `effortLevels` 画四种状态，不再隐藏。
- 触发器加角色图标与服务商图标；跟随时档位用次要色。

### `packages/neuro-book/src/plugins/models/web/`

- `logos.ts`：模板图标键 → `@lobehub/icons-static-svg/icons/<名>.svg?raw` 的显式导入表（Vite 的 glob 不进 node_modules），按需动态导入成一个块；`iconOf(provider)` 给出 `ComposerIcon`。
- `AddProviderDialog`：分组、组内多列的行（第 1 轮的稿）；已添加的标“已添加”不停用；只能登录的收进最后一组默认收起；有地区的模板选中后在详情里选地区。
- `ProviderDetail`：标题区只放图标按钮、名称与“复制一份”，删除仍在列表条目上（决定 19）。标题区图标按钮（弹出：内置、上传、首字母、恢复模板的图标）、名称就地改、“复制一份”；协议下拉每家都有，旁边“检测协议”，结果就地列出；“恢复模板地址”；高级里加代理；模型区头“重新拉取”与个数、更新时间，“服务商新出的模型自动加入”开关。“管理模型”对所有服务商列来源的模型并可“重新拉取”。
- `RolesPage`：角色图标、思考档一列（第 2 轮的稿）；自建角色可挑图标。
- 数据模块 `models-store.ts`：加 `detectApi`、`refreshModels`、`refreshCatalog`、`duplicateProvider` 的调用与结果状态（同检测，寿命归数据模块）。
- `agent/web/plugin.ts` 与 `session-host.ts`：构造选择器的视图时带上图标、档位与跟随状态。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/models/service.md` | 术语（模板，去掉目录、自定义之分）；输入形状 v2 与旧形状的读法；输出 5（id 规则）、7（快照加模板、图标、代理、来源新旧）、8（推理档优先级）、9（漂移改为来源里没有）、11（检测不带推理）、12（新方法）；新增输出：模型来源与在线目录、跟随与移出、协议检测、出口与代理、角色的思考档；非目标去掉“代理设置” |
| `docs/specs/models/settings-pages.md` | 输出 3（分组多列、图标、已添加不停用）、4（协议每家都有与检测、恢复模板地址、代理）、6、10（所有服务商可重新拉取、自动加入开关、更新时间）、13（角色图标与思考档）；新增标题区（图标、名称、复制一份） |
| `docs/specs/network/proxy.md`（新，planned） | `nbook.network`：设置项、出口规则、本机中继、系统代理的读法与来源、测试、网络页 |
| `docs/specs/ui/agent-conversation-view.md` | “输入框与待处理区”里选择器的几条：两列角色、图标、思考档的四种状态与跟随、模型库分组 |
| `docs/specs/agent/conversation.md` | 输出 7、22：思考档的跟随与“用 X 的默认” |
| `docs/specs/harness/models.md` | `ModelInfo.defaultEffort`、`EffortLevels`、请求经目标的 `fetch` |
| `packages/nb-ui` 的 `SegmentedControl.md`、`docs/specs/theme/system.md` | raised、tentative；气泡档投影 |

## 切片

每片一个或几个提交，片内自跑所列验证；每片结束更新 Task README。

1. **探针与模板**：探针结论入 `evidences/proxy-probes.txt`（含 `effort: "off"` 在 pi-ai 里的处理、`os-proxy-config` 在本机的结果与有无原生模块）；`templates.ts` 与我方模板的地址核对。验证：`bun test packages/nb-models`。
2. **配置 v2**（nb-models config、core 的读写与 id 规则、旧形状读法、角色的 `effort`、`icon`）：行为不变，先用真实设置场地喂 v1 的设置文件做对照测试。验证：nb-models 全部、`plugins/models/models.test.ts`、`settings-store.test.ts`。
3. **模型来源与解析**（nb-harness `sources.ts`、`target.ts`、核心的有效列表、刷新时机、`refreshModels`、`refreshCatalog`、自动更新设置项）。验证：nb-harness `tests/models.test.ts` 加来源用例（本机假端点当 `/models`，注入的 `fetch` 把 stencil 地址指到本机）、nb-models core、`models.test.ts`；`test:llm` 一轮。
4. **网络与代理**（`nbook.network` 后端：中继、出口、系统代理、`networkKey`、远程合同；models 接 `fetchFor`；`omp.ts`、发现接目标的 `fetch`）。验证：中继与出口的测试用真的本机 HTTP CONNECT 代理与 SOCKS5 服务（测试里用 `node:net` 起，`socks` 做 SOCKS5 服务端不可用时手写最小握手），断言请求真的经过、直连盖过环境变量；`models.test.ts` 一轮对话走自定义代理。
5. **推理档与协议检测**（`EffortLevels`、`defaultEffort`、`thinking.reset`、`detectApi`、`check` 的 `disableReasoning`）。验证：nb-harness kernel 的会话与请求测试、nb-models core、`models.test.ts`。
6. **nb-ui**（气泡档投影、`SegmentedControl` 的 raised 与 tentative）。验证：nb-ui 单元与 dom 测试、`SegmentedControl` 的 Lab 场景。
7. **选择器**（nb-agent-ui 类型与组件、agent 插件构造视图）。验证：`AgentRoleModelPicker`、`AgentConversationComposer` 的 dom 测试，Lab 场景截图（亮色、390 宽、英文）。
8. **设置页**（图标表、添加对话框、服务商详情、管理模型、角色页、网络页、数据模块）。验证：`models-store.test.ts`、各组件 dom 测试、`pages-focus.dom.test.ts`、Lab 场景。
9. **收口**：Spec 改完、e2e 清单、实现审查（后端 omp，前端 Sonnet）、处理、合入。

## 验收映射

改完 Spec 后按新编号补全；先列要新增的覆盖：

| 行为 | 覆盖 |
|---|---|
| 同一模板建两家、id 不冲突、旧形状读进来行为不变 | nb-models `core.test.ts`、`models.test.ts` |
| 添加即加入来源的全部对话模型；移出、关掉自动加入后不再长 | `models.test.ts`（假端点先给 3 个、再给 4 个） |
| 在线目录：离线用缓存、失败保留上一份并标 stale、缓存在状态根 | nb-harness `tests/models.test.ts` |
| 解析来源里的新模型（不在打包目录里） | `models.test.ts` 一轮对话 |
| 直连盖过 `HTTPS_PROXY`、自定义 HTTP 与 SOCKS5、服务商覆盖应用 | `network` 插件测试（真实本机代理） |
| 角色思考档进请求、会话选的优先、`off` 不推理、跟随与重置 | nb-harness kernel 测试、`session-host` 测试 |
| 协议检测四种结果、不写配置 | `models.test.ts`（假端点只实现 Chat Completions） |
| 选择器四种思考档状态、两列角色、模型库分组与搜索 | `AgentRoleModelPicker.dom.test.ts` |
| 设置页的添加、图标、检测、代理、角色思考档、网络页 | dom 测试与 `e2e/models.e2e.ts`、`e2e/settings.e2e.ts` |

## 验证

- 合入前 e2e 一次：`e2e/models.e2e.ts`、`e2e/settings.e2e.ts`、`e2e/agent-conversation.e2e.ts`、`e2e/lab-agent-ui.e2e.ts`、`e2e/lab-scenes.e2e.ts`（5 个文件）。开工前在起点上各跑一遍记基线。实施中只重跑改到的那个文件。
- 真实模型：`test:llm` 的 DeepSeek 一轮（第 3 片后与收口各一次）。
- 真实网络：本机有 Clash 一类的 HTTP 代理时手动走一遍“跟随系统”“测试代理”，结果记进 Task README；没有时写明未验证。
- 未验证边界：Windows、macOS 上 `os-proxy-config` 的读法（只在 Linux 跑）；需要登录的服务商（不在范围）。

## 独立设计的对照

Claude Opus 只拿到目标另出了一版（[`evidences/independent-design-opus.md`](evidences/independent-design-opus.md)）。采纳的：schema 同时收新旧字段（否则旧设置整键丢弃）；`api`、`baseUrl` 改为可选覆盖（OpenRouter 的专用协议、混合协议的模板）；`Model.provider` 与全名的规则；stencil 用同一个 `fetch`；没写档位的模型补通用档；`requestEffort` 统一四处；代理地址不带凭据；上传不收 SVG；模板建后不变；远程合同升版本 2；量快照体积。不同的：环境里有代理时的“直连”与 SOCKS5，它推荐第一版如实写“做不到”并拒收 SOCKS5，本计划用本机中继（开发者定，决定 18）；上传图标它存文件加 HTTP 路由，本计划存成设置里的小 data URL（少一条路由，48 KB 上限够图标用）。

## 不做与风险

- 不做：OAuth 登录；Magpie 的“粘贴 curl 建服务商”、余额探测、导入别的应用的配置；抓站点图标（决定 4）；代理用于模型服务之外的请求（决定 5，网页工具等以后接 `networkKey`）。
- 风险：
  - 中继是新的长驻网络组件：只听 127.0.0.1、随入口停、出口头不外泄；由第 4 片的真实代理测试兜底。
  - OMP 的来源合并规则随 OMP 升级变化：只经公开导出调用，`boundary.test.ts` 守住；缓存库放状态根，OMP 升级时它自己作废旧行。
  - 几百个模型的界面：选择器与管理模型默认收起大组、只渲染命中项；第 7、8 片用 600 个模型的场景量打开与搜索的耗时。
  - 旧配置的读法：第 2 片用真实的旧设置文件形状做对照测试。
