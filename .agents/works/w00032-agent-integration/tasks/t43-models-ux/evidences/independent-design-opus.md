# t43 后端与数据的独立设计（Opus）

日期 2026-11-20。只依据 Task README 的决定 1 到 17、`research/` 两份调研与 master 上的代码（`nb-models`、`nb-harness/src/models`、`nb-harness/src/kernel`、`plugins/models`、`plugins/agent/web/session-host.ts`）。没有读 `plan.md`。下文“实测”是本次在本机跑过的，“从代码推断”是读代码得出、没有运行验证的。

## 0. 结论先行

- 服务商统一成“实例 + 模板引用”：设置里每家存 `template`（OMP 服务商 id 或通用模板 id）与相对模板的覆盖；没有 `kind`。旧值靠“同一个 schema 同时接受新旧两种写法、读时归一、写时写新形状”兼容，**不能让 schema 拒收旧值**：设置层对不合 schema 的键整键丢弃（`docs/specs/settings/configuration.md` 输出 4），`providers` 会整份变成 `[]`，下一次写入就把用户的服务商全冲掉。
- 模型列表来自每个实例一份 pi-catalog 的 `createModelManager`（打包目录 + `<状态根>/agent/models.db` + stencil + 端点发现）；设置里只存“移除的 id”“改过的字段”“手动加的模型”。解析从这个实例当前的 `Model[]` 里按 id 取，不再 `getBundledModel`。
- 代理归新插件 `nbook.network`（设置键前缀就是插件 id，选错 owner 以后要迁移用户设置），对外交出 `fetchFor(choice)`；nb-models 只定义服务商级的代理形状并经依赖注入拿 `fetch`。注入点四处：对话（`OmpTarget.fetch`）、端点发现与 stencil（model manager 的 `fetch`）、检测与协议检测（同对话）、代理测试。socks5 第一版不支持，自定义时拒收并提示改用 http 混合端口。
- 思考档：角色加 `effort?`；`ModelInfo` 加 `defaultEffort?`（宿主按角色填）；内核在一处算“会话明确选的 ?? 宿主给的默认”，对话、预览、就地压缩、主动调用四处共用。会话的 `core.effort === null` 就是“跟随”，现有语义不用改。
- 协议检测放 `nb-harness/models` 的新模块，走与真实请求相同的 `buildModel` + `ompCall` 路径，经 nb-models 的远程方法 `detectProtocols` 暴露，结果不落盘，“用这个”是一次普通的 `updateProvider`。

### 本次实测的几条事实

1. Bun 1.4.4 的 `fetch` 会**自动**用进程环境里的 `HTTP_PROXY`（目标非回环时），`proxy: ""` 关不掉它，启动时或运行时设的 `NO_PROXY`（`*`、主机名、`.invalid` 后缀三种写法）都没有生效；显式的 `proxy: "http://…"` 会盖过环境变量；运行时从 `process.env` 删掉 `HTTP_PROXY` 之后的请求变为直连。回环目标不走环境代理。（`bun` 脚本在 `/tmp`，起本机假代理对 `http://example.invalid/` 发请求。）
2. 打包目录 79 家服务商里，对话模型的 `api` 不止一种的有 12 家（`zenmux`、`opencode-zen`、`zai`、`github-copilot`、`google-vertex` 等），`baseUrl` 不止一个的 11 家。
3. OpenRouter 的模型 `api` 是 `"openrouter"`，Gemini 是 `"google-generative-ai"`，Anthropic 的 `baseUrl` 不带 `/v1`，OpenAI 带 `/v1`，DeepSeek 不带。即服务商的“协议”不只是现在配置里那三个值。
4. pi-ai 源码里按 `model.provider === "<id>"` 分支的有 65 处（如 `anthropic`、`openrouter`、`github-copilot` 的专用处理）。`ompModelInfo` 与 `ompCall` 用 `model.provider` 拼模型全名（`kernel/model/omp.ts` 71、246 行）。
5. pi-ai 的 OpenAI completions、Responses、Anthropic、Google 几个提供方都读 `options.fetch`（`node_modules/@oh-my-pi/pi-ai/src/providers/*.ts`）；pi-catalog 的发现工厂（`ModelManagerConfig.fetch`）与 `modelsDevCatalogFallback(providerId, fetchImpl)` 也都收 `fetch`。

## 1. 配置形状 v2 与旧配置兼容

### 1.1 服务商 `nbook.models/providers`

```ts
type Protocol = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

type ProviderV2 = {
    id: string;                 // [a-z0-9][a-z0-9._-]*，不含 /；建后不变。由名字生成，与已有实例冲突加 -2、-3（不再与目录 id 互斥）
    template: string;           // OMP 服务商 id（"openrouter"）或通用模板 id（"generic-openai"、"generic-anthropic"、"generic-gemini"、"generic-responses"）；建后不变
    name: string;
    icon?: ProviderIcon;        // 缺省用模板的图标
    baseUrl?: string;           // 缺省跟随模板（模板对每个模型给的地址）；通用模板必填
    api?: Protocol;             // 缺省跟随模板（每个模型自己的 api，可能是 "openrouter" 这类专用值或混合）；通用模板必填
    apiKeyEnv?: string;
    auth: "default" | "bearer" | "none";
    headers?: Record<string, string>;
    proxy?: ProviderProxy;      // 缺省跟随应用
    autoAdd?: boolean;          // 服务商新出的模型自动加入；新建时写 true；缺省（旧值）按 false 读
    removed?: string[];         // 从来源里移除的模型 id（不再自动加回）
    models: ModelEntry[];       // 只有改过的来源模型与手动加的模型
    // 只为读旧值保留，写入时去掉：
    kind?: "catalog" | "custom";
};

type ModelEntry = {
    id: string;
    manual?: true;              // 手动加的（不在来源里也保留，不算漂移）；手动模型启用时 contextWindow 必填（沿用输出 5）
    enabled?: boolean;          // 缺省 true；旧值里是必填，照读
    name?: string; group?: string;
    contextWindow?: number; maxOutput?: number; vision?: boolean; reasoning?: boolean;
    efforts?: Effort[];         // 只对手动模型生效（见第 4 节），来源模型的档位以目录为准
    compaction?: CompactionSetting; compactAt?: number;  // compactAt 沿用现有的读旧写新
    price?: [number, number, number, number] | null;
    headers?: Record<string, string>;
};

type ProviderIcon =
    | {kind: "builtin"; key: string}           // lobehub 图标键，界面按键取 SVG
    | {kind: "upload"; file: string}           // ^[0-9a-f]{16}\.(png|jpg|gif|webp|ico)$，文件在 <状态根>/models/icons/
    | {kind: "letter"; text?: string; hue?: number};  // 缺省按名字取首字、按名字哈希取色相（浏览器算）

type ProviderProxy = {mode: "system" | "custom" | "direct"; url?: string};  // 不写这个字段就是“跟随应用”；url 在切回其它模式时保留，再选“自定义”能找回
```

要点与理由：

- **为什么 `template` 建后不变**：它决定“去哪查模型能力”（发现描述、stencil 映射、打包目录、默认图标、“恢复模板地址”）。决定 1 要的“从 Gemini 模板建、再改成 GPT 也没关系”由可改的 `api` 与 `baseUrl` 达成，不需要改 `template`；允许改 `template` 会让 `removed` 与 `models` 里的 id 失去参照。若开发者确实要“换模板”，做成“复制一份并换模板”。
- **`api` 只收四种通用协议**：模板自带的专用值（`openrouter`、`google-vertex`、混合 api 的服务商）只能“跟随模板”，不能写进设置。写了 `api` 就表示“这一家整体按这个协议发”，盖过每个模型自己的 api（12 家混合 api 的模板写了 `api` 后会全部改走一种，界面要写明）。
- **`autoAdd` 缺省按 false**：旧的目录服务商里 `models` 就是用户挑过的显式列表；若缺省按 true 读，升级后 OpenRouter 用户会突然多出 587 个模型。新建的实例总是显式写 `autoAdd: true`。
- **`autoAdd` 从开到关**：服务端在同一次写里把当前生效的来源模型 id 逐个写成 `{id}` 条目（OpenRouter 约 587 行，约 25 KB），以后有效集合 = 条目 ∪ 手动；从关到开时去掉只有 `id` 的条目。这样“关”的语义就是现在的显式列表，不需要第三种状态。
- **`removed` 与 `enabled: false` 的区别**沿用输出 15：移除会解除角色绑定、不再自动加回；停用保留绑定，角色解析为 `unknown-model`。
- **代理地址不带用户名密码**：设置文件对浏览器可读，`user:pass@` 写进去等于把凭据暴露给页面与设置文件视图。第一版拒收带 userinfo 的地址（`invalid-value`）；要支持时把凭据放凭据库、按 `proxy:<范围>` 存。

### 1.2 模型角色 `nbook.models/roles`

```ts
type RoleV2 = {id; axis; name; description; model: string | null; effort?: Effort};  // 不写 = 跟随模型
type Effort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
```

存用户选的原值，写入时只校验是六档之一，不按绑定的模型夹（换绑、目录刷新改了档位表时意图不丢，夹取在请求时做）。`"off"`（显式关思考，对应内核已有的 `params.disableReasoning`）决定里没有提，第一版不加；以后要加只扩字面量联合，旧值照读。

### 1.3 新的设置项

| 键 | 形状 | 缺省 | owner、分区 |
|---|---|---|---|
| `nbook.network/proxyMode` | `"system" \| "custom" \| "direct"` | `"system"` | `nbook.network`，分区 `nbook.network`，组 `proxy` |
| `nbook.network/proxyUrl` | `string`（`^https?://`，无 userinfo）或不写 | 不写 | 同上 |
| `nbook.models/catalogAutoUpdate` | `boolean` | `true` | `nbook.models`，`section: "nbook.network"`，组 `catalog`（小组 id 是分区声明的公开合同，按 id 引用，同 `RUN_GUARDS_SECTION` 的做法） |

代理拆成两个键而不是一个对象：两处同时改“方式”和“地址”不会互相覆盖；“地址”在切到直连后保留。三项都只允许用户层（指定网络出口，同现有“网络地址与凭据来源不让项目层改”的作者规则）。

### 1.4 兼容：读旧写新

- **schema**：`ProviderConfigSchema` 改成一个同时接受新旧字段的对象：`kind`、`template` 都可选（至少有一个，靠服务核心校验，不靠 schema 的 `anyOf`，免得报错信息不可读）；`ModelEntry.enabled` 可选。`additionalProperties: false` 保留。
- **读时归一**（`nb-models/src/config/normalize.ts`，浏览器也要用，放 `./config`）：
  - `kind: "catalog"`、无 `template` → `template = id`，`autoAdd = false`，原 `baseUrl` 留作覆盖，`api` 不写（跟随模板）；`models` 里的条目照旧是“覆盖 + 显式列表”。
  - `kind: "custom"` → `template` 按 `api` 映射到通用模板（`openai-completions` → `generic-openai`，`openai-responses` → `generic-responses`，`anthropic-messages` → `generic-anthropic`），`autoAdd = false`，全部模型条目标 `manual: true`（它们是用户给的完整配置，不能因为发现结果里没有就变成漂移）。
  - 旧的 `compactAt` 照现有做法读成 `compaction: {mode: "tokens"}`。
- **写时写新**：服务核心每次写 `providers` 都写归一后的新形状（去掉 `kind`），同现有 `compactAt` 的做法。不在启动时批量迁移：启动时写文件会与设置文件视图、别的窗口抢写，且用户什么都没做文件就变了。
- **id 规则的变化**：旧规则“自定义 id 不与目录 id 冲突”在新规则下不再需要，但已有的 id 不改（引用 `<服务商>/<模型>` 写在角色、会话设置、Profile 设置里）。
- **降级不支持**：新形状被旧版本的 schema 整键丢弃，旧版本里服务商会全部消失，且旧版本任何一次写入都会把文件里的服务商冲成旧版本看到的样子。写进发布说明；不为降级做双写。
- **远程合同**：`nbook.models/settings` 升到版本 2（方法表见第 2.5 节）。浏览器与服务端同一构建发布，没有跨版本调用方。
- **验收要点**：用真实设置场地（`settings-store.test.ts` 的做法）喂 v1 的目录与自定义服务商各一份，确认快照、解析、角色有效性与升级前相同；做一次任意写入后文件变成新形状、再读结果不变；`autoAdd` 缺省不会给旧的 OpenRouter 加模型。

## 2. 模型来源与解析

### 2.1 模板表

服务端由两部分合成 `templates()`：

- OMP 打包服务商（`getBundledProviders()`，79 家）：`id`、`name`、`access`（沿用 `providerAccess`）、`keyEnvs`、默认 `baseUrl` 与 `api`（取对话模型里出现最多的那个；混合的标 `mixed: true` 并列出各协议）、`discovery`（有没有端点发现描述、是否允许匿名、有没有 stencil 描述）。
- 四个通用模板 `generic-openai`、`generic-responses`、`generic-anthropic`、`generic-gemini`：没有地址与模型，建时必须给 `baseUrl`。

分组（厂商、中转、本机、通用）与内置图标键 OMP 不提供，放一张与应用无关的静态表 `nb-models/src/config/templates.ts`（`{[templateId]: {group, icon}}`，没登记的归“厂商”、图标用首字母）。图标 SVG 本身（`@lobehub/icons-static-svg`）只在浏览器入口用，nb-models 只存键。

### 2.2 每个实例的模型来源

新模块 `nb-harness/src/models/sources.ts`（Bun，依赖 `bun:sqlite`），对 nb-models 只暴露与配置形状无关的接口：

```ts
interface SourceSpec {
    readonly instance: string;              // 缓存命名空间：cacheProviderId = instance
    readonly template: string;              // OMP 服务商 id 或通用模板 id
    readonly baseUrl?: string;              // 实例覆盖；不写时用模板的
    readonly api?: Protocol;
    readonly apiKey: string | null;         // 服务端从凭据库或启动环境现取；不出服务端
    readonly headers: Readonly<Record<string, string>>;
    readonly fetch: typeof fetch;           // 已按这家的代理选择包好（第 3 节）
}
interface SourceState {
    readonly models: readonly Model[];      // 只留 modelKind(model) === "chat"、去掉 stencil 标 deprecated 的
    readonly source: "bundled" | "cache" | "models.dev" | "provider" | "none";
    readonly stale: boolean;
    readonly updatedAt: number | null;
    readonly lastError: {code: "auth" | "unreachable" | "not-supported" | "failed"; status?: number} | null;
}
interface ModelSources {
    current(instance: string): SourceState | undefined;   // 同步，给 resolve 与快照
    refresh(spec: SourceSpec, strategy: "offline" | "online-if-uncached" | "online"): Promise<SourceState>;
    forget(instance: string): void;                       // 删服务商时清内存（缓存行留着无害，TTL 后作废）
}
function createModelSources(options: {cacheDbPath: string; cacheTtlMs: number; stencilFetch: typeof fetch}): ModelSources;
```

每个实例怎样组 `ModelManagerOptions`（照 omp 的 `#collectBuiltInModelManagerOptions`，见 `research/omp-catalog.md` 1.5）：

| 实例情况 | 静态来源 | 在线来源 |
|---|---|---|
| OMP 模板、地址与协议都跟随模板 | 打包目录（不传 `staticModels`） | 模板的 `PROVIDER_DESCRIPTORS` 工厂（`createModelManagerOptions({apiKey, baseUrl, fetch})`）+ `modelsDevCatalogFallback(template, stencilFetch)`（只增不改） |
| OMP 模板、改了地址（中转）或协议 | 打包目录（作能力参照与“中转没有 /models 时的候选”） | 按协议的通用发现（OpenAI 两种用 `fetchOpenAICompatibleModels`，Anthropic 用 `/v1/models`，Gemini 用 `models` 列表），不用模板的专用映射：专用映射（如 OpenRouter 只留 `supported_parameters` 含 `tools` 的）套在中转站的 `/models` 上常会滤空 |
| 通用模板 | `staticModels: []`（避免对未知 id 调 `getBundledModels`） | 同上一行的通用发现；物化走 `buildModel`，能力按 id 套 KDL 规则，与今天自定义模型的“建议值”同源 |

共同参数：`cacheDbPath = <状态根>/agent/models.db`（**必须显式传**，否则写进 `~/.omp/agent/models.db`），`cacheProviderId = instance`（两个 OpenRouter 实例的密钥不同，端点结果可能不同），`cacheTtlMs = 24h`（同 omp）。

失败原因：pi-catalog 把远端失败吞成“回落到缓存或打包”，只给 `stale`。照现有 `discoverModels` 的做法在传进去的 `fetch` 外面再包一层记状态码与网络错误，得出 `lastError`；不按错误文字分支。

“候选为空”时的取舍：改了地址的实例，发现成功且非空就以发现结果为准；发现失败或为空时退回模板的打包列表，并在状态里标 `source: "bundled"`、`stale: true`，界面写“这个地址没有列出模型，按模板列出”。

### 2.3 有效模型集合

服务核心（nb-models）对每个实例算一次、随来源或配置变化重算：

- `autoAdd !== false`：来源的对话模型 − `removed` ∪ 手动条目；条目里的覆盖字段叠上去。
- `autoAdd === false`：非手动条目里来源仍有的 ∪ 手动条目。
- 非手动条目、来源里已经没有：快照里标 `missing`、解析为 `unknown-model`、诊断一次（输出 9 的措辞要从“OMP 升级”改成“目录或服务商不再列出这个模型”）。只有在 `autoAdd` 开、用户没改过、也没有角色或会话引用的模型，下架时直接从列表消失，不报漂移。
- `contextWindow` 缺失的手动模型照旧“只能停用”。来源模型缺窗口（发现得到的新模型偶尔如此）：加入但停用，快照标 `incomplete`，同现有自定义模型的规则。

### 2.4 解析：从实例的 `Model[]` 得到 OMP 的 Model

`nb-harness/src/models/target.ts` 的 `catalogModel`/`customModel` 二分改成一条路径：

1. 从 `ModelSources.current(instance)` 按 id 找 `Model`（`Map` 索引，`resolve` 仍是同步的）；手动模型没有来源行，用 `buildModel({provider: <OMP provider，见下>, api, baseUrl, id, ...条目})` 现场物化，同今天。
2. 叠覆盖：名字、单价、请求头、压缩触发点照旧；实例写了 `baseUrl` 而协议没变时只换 `baseUrl`（同今天的目录地址覆盖）；实例写了 `api`（与这个模型原本的 api 不同）时用 `buildModel` 以新协议重新物化（保留 id、窗口、上限、模态、单价），因为 `compat` 与思考格式是按 api 算的，直接改 `model.api` 会带着旧 api 的 compat 发请求。
3. **`Model.provider` 取什么**：协议跟随模板时保持模板的 OMP id（pi-ai 按它做 65 处专用处理，例如 OpenRouter、Anthropic 直连地址），即使地址改成了中转（今天的目录地址覆盖就是这样）；写了 `api` 换协议、或通用模板时，用实例 id（pi-ai 视为未知服务商、只按 api 走通用路径，同今天的自定义服务商）。
4. **模型全名用实例 id**：`ompModelInfo`、`ompCall` 现在拿 `model.provider` 拼 `<服务商>/<模型>`；两个 OpenRouter 实例的 `Model.provider` 都是 `openrouter`，会撞名。给 `OmpTarget` 加 `name?: string`（宿主给的全名）、`ompModelInfo(model, name?)` 同样收它，`buildResolution` 传 `<实例>/<模型>`。这是内核适配器的一处小改，`harness/models.md` 输出 14 的措辞跟着改。
5. 凭据、请求头、`env:`、`auth` 的处理不变（`requestAuth` 已经是按实例 id 取凭据）。
6. 解析缓存（`resolutions`）在来源刷新完成时与配置变化一样整体作废。

离线与失败：

- 入口激活：凭据库打开后，对每个实例 `refresh(spec, "offline")`（只读打包目录与 sqlite 缓存，不联网），全部完成再提供 `modelsKey`；首次启动没有缓存时等于今天“只有打包目录”。
- 激活后：`catalogAutoUpdate` 为真时后台逐家 `online-if-uncached`（并发 4，单家 20 秒上限），每家完成就重算快照、推一次 `changed`。
- 立即拉这一家（`online`）：添加服务商后、`setKey`/`clearKey` 后、改了地址或协议后（只在 `catalogAutoUpdate` 为真时自动触发），以及用户点“重新拉取”（总是触发，不看开关）。“现在更新”= 全部实例 `online`。
- 同一实例的刷新串行、后来的合并进正在跑的那次；刷新不进设置写入队列（它不写设置），只在完成时作废快照。
- 网络失败不影响已能用的模型：结果回落到缓存或打包目录，`stale: true` 与 `lastError` 进快照；角色绑的模型若因此变 `missing`，按目录漂移处理。
- `catalogAutoUpdate` 为假：不做后台刷新、添加与改密钥时不自动拉；用户点的“重新拉取”“现在更新”照常联网（用户主动的请求）。

### 2.5 远程合同 v2 的变化（`nbook.models/settings`）

| 方法 | 变化 |
|---|---|
| `templates()` | 取代 `catalogProviders()`：`{id, name, group, icon, api, mixed, baseUrl, access, discovery, instances: number}`；`instances` 取代 `added`（同一模板可以建多个） |
| `addProvider({template, name?, baseUrl?, api?})` | 一律从模板建；`autoAdd: true`、`models: []`、`removed: []`；返回 `{id}` 后后台对这一家 `online` |
| `duplicateProvider({id})` | 新增：复制配置为新实例（名字加“副本”），凭据库里的密钥在服务端一并复制（不出服务端）；返回 `{id}` |
| `updateProvider({id, patch})` | patch 加 `icon`（null 恢复模板的）、`api`（null 跟随模板）、`proxy`（null 跟随应用）、`autoAdd`；`baseUrl: null` 即“恢复模板地址” |
| `providerModels({provider})` | 取代 `catalogModels` 与 `discover` 的候选：来源的全部对话模型，每行带 `state: "added" \| "removed" \| "available"`（`autoAdd` 关时没进集合的为 `available`）与能力字段；只在“管理模型”打开时调，不进快照 |
| `setModels({provider, add, remove})` | 语义变成：`add` 里来源模型从 `removed` 拿掉（`autoAdd` 关时补条目），手动模型写完整条目；`remove` 里来源模型进 `removed`、手动模型删条目；解绑规则不变 |
| `refreshCatalog({provider?})` | 取代 `discover`：给了就拉这一家、不给拉全部；返回各家的 `SourceState` 摘要；业务码 `unknown-provider`；网络原因放在返回值的 `lastError` 里（拉取失败不是调用失败） |
| `detectProtocols(...)` | 新增，见第 5 节 |
| `setIcon({provider, type, data})` | 新增：`data` 为 base64，上限 1 MiB；见第 6 节 |
| `setRole({id, model?, effort?})` | `effort: null` 清掉（跟随模型）；`model` 不给就不改 |

快照的服务商加 `template`、`icon`、`proxy`、`autoAdd`、`catalog: {source, stale, updatedAt, count, refreshing, lastError}`，去掉 `kind`（浏览器里按 `kind` 分支的 4 个组件文件、Lab 的假远程要一起改）。快照的模型加 `origin: "source" \| "manual"` 与 `thinking`（第 4 节）。

快照体积要量：OpenRouter 全部加入后一家约 587 行，每行十几个字段，粗估每家 200 KB 上下（从字段数推算，未实测），每次 `changed` 都整份推给每个窗口。建议在实现“添加即全部”的那一片先量一次；超过约 100 KB 就把模型行移出快照（快照只留每家的计数、修订号与被角色引用的模型），模型行经 `providerModels` 按修订号取。

## 3. 代理与网络

### 3.1 归属

- **新内置插件 `nbook.network`**（服务端加浏览器两个入口）：声明分区 `nbook.network`（page 分区，“网络”）、两个设置项 `proxyMode`、`proxyUrl`，服务端交出进程内服务 `networkKey` 与远程合同 `nbook.network/settings`，浏览器入口画“网络”页。
- 理由：设置键带 owner 的插件 id，代理是应用级概念，以后图片生成、网页工具、插件下载、更新检查都会用；现在放进 `nbook.models` 的话，以后挪走要迁移用户设置里的键。插件本身很薄。
- **nb-models 只管服务商级**：`ProviderProxy` 形状在 `./config`；`ModelsCoreDeps` 加 `fetchFor(proxy: ProviderProxy | undefined): typeof fetch`（`undefined` = 跟随应用），以及 `stencilFetch: typeof fetch`（stencil 目录是共用的、不属于某家，走应用级）。nb-models 不知道“网络”插件存在，NeuroBot 不配代理时传 `() => fetch`。
- **代理的读取与拼装**（地址解析、系统代理、环境变量、回环判断、`fetch` 包装）先放应用的 `plugins/network/backend/`；第二个应用要用时再下沉成包（同 ADR 0045 的下沉条件）。
- 依赖方向：服务端 `nbook.models` → `networkKey`；浏览器的“网络”页 → `nbook.models/settings`（模型目录那一组的开关状态、“现在更新”、上次更新时间与模型数），只经 `nbook/plugins/models/shared/contracts`。两个入口方向相反但不是同一个入口，不成环。

### 3.2 接口

```ts
// nbook/plugins/network/shared/contracts
type ProxyChoice = {mode: "system" | "custom" | "direct"; url?: string};   // 与 ProviderProxy 同形状
type EffectiveProxy =
    | {kind: "proxy"; url: string; source: "settings" | "env" | "system"}     // url 已去掉 userinfo
    | {kind: "direct"; reason: "setting" | "none-found" | "unsupported-scheme" | "env-overrides"};

interface NetworkService {
    /** 不给 choice 时用应用级设置。同一个有效代理交回同一个函数（按有效代理地址缓存），stencil 的并发合并与 ETag 靠函数身份。 */
    fetchFor(choice?: ProxyChoice): typeof fetch;
    describe(choice?: ProxyChoice): EffectiveProxy;
    onChange(listener: () => void): () => void;   // 设置变化或系统代理读数变化
}
```

远程合同 `nbook.network/settings`（版本 1）：

| 方法 | 读写 | 说明 |
|---|---|---|
| `status()`，事件 `changed` | read | 应用级的 `EffectiveProxy`，给“跟随系统”行下那行信息色的“现在用的代理与来源” |
| `setProxy({mode, url?})` | write | 经设置服务 `update` 带 `expect` 写两个键（与 models 一样走服务端的串行队列）；`url` 不是 `http://`、`https://` 或带 userinfo 时 `invalid-value`，socks 地址给专门的 `unsupported-scheme` |
| `testProxy({mode, url?})` | read | 经这个代理请求一次出口探测地址，交回 `{ok, ip?, country?, ms, error?}`；不改设置，表单里没保存的值也能测 |

出口探测用 `https://www.cloudflare.com/cdn-cgi/trace`（Magpie 同款，纯文本、几百字节）；只在用户点“测试代理”时发。

### 3.3 解析顺序

`describe(choice)` 按顺序取第一个有结论的：

1. 服务商级：`direct` → 直连；`custom` → 它的 `url`；`system` → 跳到第 3 步；不写 → 第 2 步。
2. 应用级 `proxyMode`：`direct`、`custom` 同上；`system` → 第 3 步。
3. 跟随系统：启动环境（`startupEnvKey` 拍下的，不读后来的 `process.env`）的 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（大小写都认）→ 操作系统设置（Linux：KDE 读 `kioslaverc`，否则 `gsettings get org.gnome.system.proxy …`，只认 manual；macOS：`scutil --proxy`；Windows：`reg query HKCU\…\Internet Settings`）。结果缓存 15 秒、没找到只缓存 2 秒、读取上限 2 秒，读不到当“没找到”。优先 HTTPS 再 HTTP；只有 SOCKS 时得 `{kind: "direct", reason: "unsupported-scheme"}`。

读系统代理用子进程命令，不引入带原生模块的库：`os-proxy-config` 在 Windows 依赖注册表的原生绑定（从它的依赖推断，未验证），桌面打包与 Bun 的原生模块兼容要另外验证；三条命令各十几行即可。

`fetchFor` 交回的包装：

```ts
(input, init) => {
    const url = new URL(requestUrl(input));
    if (isLoopbackOrPrivate(url.hostname) && 不是服务商级的显式 custom) return fetch(input, init);   // 本机 Ollama、局域网 vLLM 不绕代理
    return effective.kind === "proxy" ? fetch(input, {...init, proxy: effective.url}) : fetch(input, init);
}
```

**环境变量与“直连”**（实测 1）：Bun 对没有 `proxy` 选项的请求自动套用进程环境的 `HTTP_PROXY`，`proxy: ""` 与 `NO_PROXY` 都关不掉。所以启动环境里设了代理变量时，“直连”做不到。两种做法：

| 做法 | 内容 | 代价 |
|---|---|---|
| A（推荐第一版） | 不动 `process.env`；`describe` 在这种情况下交回 `{kind: "direct", reason: "env-overrides"}`，界面在“直连”行下写“进程环境里设了 HTTPS_PROXY，仍会走它；要直连请去掉这个变量后重启” | 一个窄场景（设了环境代理又要某家直连）做不到；其它模式不受影响，因为显式 `proxy` 盖过环境变量 |
| B | 服务端在拍下启动环境之后从 `process.env` 删掉代理变量，由网络服务统一决定 | 进程里其它没经网络服务的 `fetch`（网页工具 `plugins/web-tools`、`nb-harness/src/complete.ts`）与子进程都会失去环境代理，要一并改成经 `networkKey`，范围超出“只管模型服务”的决定 5 |

### 3.4 注入点

| 请求 | 现在 | 改成 |
|---|---|---|
| 对话、预览、`complete()`、检测 `check` | `ompCall` 里 `observedFetch(fetch, …)`（`kernel/model/omp.ts` 296 行），pi-ai 用它 | `OmpTarget` 加 `fetch?: typeof fetch`，`observedFetch(target.fetch ?? fetch, …)`；`buildResolution` 收 `fetchFor` 并按实例的 `proxy` 取 |
| 端点发现 | `discoverModels` 里直接 `fetch`（`models/catalog.ts` 213 行） | 并入 `sources.ts`：`ModelManagerConfig.fetch` 与通用发现都用 `SourceSpec.fetch` |
| stencil 目录 | 没有 | `modelsDevCatalogFallback(template, deps.stencilFetch)`；`stencilFetch` 是应用级的同一个函数，多家并发时合并为一次下载 |
| 协议检测 | 没有 | 同对话（第 5 节） |
| 代理测试 | 没有 | `fetchFor(表单里的 choice)` |

不经 `fetch` 的传输（Bedrock SDK 的部分路径、Codex 的 WebSocket）不受代理控制，写进已知限制；这些服务商现在就标“要登录”或“不支持”，影响很小。

代理变化的生效：解析结果缓存里存的是 `fetch` 包装函数，网络服务 `onChange` 时让 nb-models 作废解析缓存（核心多订阅一个来源），下一次请求起生效；进行中的请求不改。

### 3.5 socks5

推荐：第一版不支持。

- 自定义：`socks5://`、`socks5h://` 在 `setProxy` 与 `updateProvider` 里以 `unsupported-scheme` 拒收，界面提示“Clash、v2rayN 等的混合端口同一端口也接受 http://”。服务商级同样。
- 跟随系统：系统只配了 SOCKS 时得 `unsupported-scheme`、按直连发，“网络”页那行信息色改成警告色写明。
- 以后要支持时的做法：在服务端起一个只监听 `127.0.0.1` 随机端口的 HTTP CONNECT 转 SOCKS5 的小桥（`Bun.listen` 收 CONNECT，`Bun.connect` 连 SOCKS 服务器做握手，`socks5h` 时把主机名交给代理解析），`fetchFor` 对 socks 地址交回 `proxy: "http://127.0.0.1:<桥>"`。约两百行、零依赖，但要自己处理认证、半关闭与超时，值得单独一片并有真实代理的测试；不要现在做。

## 4. 思考档的数据流

### 4.1 三层来源与优先级

“会话里明确选的 > 角色上设的 > 模型默认”（决定 6）落到三处数据：

| 层 | 存在哪 | “没有”的写法 |
|---|---|---|
| 会话明确选的 | 内核的 `CoreSettings.effort`（`kernel/api/model.ts` 147 行），已有 | `null` = 跟随，已有语义，不改 |
| 角色上设的 | `RoleV2.effort`（第 1.2 节） | 不写 = 跟随模型 |
| 模型默认 | OMP 的 `model.thinking.defaultLevel`（打包目录 224 个模型有），没有时由服务商决定 | 请求里不带 `effort` |

### 4.2 角色 → 内核

- `ModelInfo` 加两个可选字段：`defaultEffort?: string`（宿主建议的档，来自角色）与 `modelDefaultEffort?: string`（OMP 的 `defaultLevel`，只给界面显示）。`ompModelInfo` 填后者；nb-models 在 `resolveRole` 里填前者：`{...resolved, info: {...resolved.info, defaultEffort: role.effort}}`。解析缓存按“引用”缓存，角色的结果另按 `role:<id>` 缓存（同一模型被两个档位不同的角色绑着时不能共用一份）。
- 直接选模型（会话 `settings.model` 是模型引用、Profile 设置里的模型）时没有角色，`defaultEffort` 不写。走到角色的所有路径都带：`role:<id>` 的会话选择、Profile 缺省角色、`main`、压缩用的 `compaction`、审批用的 `fast`、调用方指名的角色。
- 内核只在一处算：`requestEffort(core.effort, info, params) = core.effort ?? (params.disableReasoning === true ? undefined : info.defaultEffort)`，以下四处改用它：
  - 对话请求 `run/loop.ts` 310 行；
  - 预览 `session/preview.ts` 128 行；
  - 压缩 `compaction/compact.ts` 178 行。就地压缩要求“模型、推理档与消息前缀和对话请求相同”（`agent/compaction.md` 40、89 行），所以它必须用对话那次解析得到的 `info`，不能用压缩角色的档；独立摘要请求用压缩角色解析出的 `info`；
  - 主动调用 `run/model-call.ts` 164 行：`effort: draft.effort ?? requestEffort(null, resolution.info, draft.params)`。审批钩子常带 `disableReasoning`（强制 `toolChoice` 时），所以 `disableReasoning` 为真时不套角色档。
- 夹取不变：仍在适配器 `clampThinkingLevelForModel`（`omp.ts` 309 行）。请求记录、预览、请求追踪里的 `effort` 是夹取前的值（今天同样如此）。
- 子代理 `agent_spawn` 的 `effort?` 写进子会话的 `core.effort`，属于“明确选的”，不变。

### 4.3 “支持但没写档位”的通用几档

`clampThinkingLevelForModel` 对空档位表交回 `undefined`（不发），所以界面给的通用几档必须在物化时真的进 `model.thinking`，否则选了也不发：

- 来源模型 `reasoning: true` 而 `thinking` 为空（打包里 25 个，在线发现的新模型可能更多）：解析时补 `thinking: {mode: "effort", efforts: <OMP 按接口格式给的通用默认>, unverified: true}`（通用默认即 `resolveThinkingPolicy` 的 `fallbackEfforts`：`minimal…high` 或 `minimal…xhigh`，不另造一套；`unverified` 让 pi-ai 在没选档时按不推理发，见调研 3.2 的 `withoutUnverifiedThinking`），快照里 `thinking.kind = "generic"`。
- 手动模型：条目的 `efforts` 交给 `buildModel` 作显式 `thinking.efforts`（`resolveThinkingPolicy` 以显式为准）；没写时用 `buildModel` 按 id 推出的档并写进快照，消除“快照显示的档与实际夹取的档不同”（调研 3.2）。

### 4.4 选择器与设置页拿到什么

快照模型与会话的模型摘要（`api/host.ts` 201 行的 `model`）都加同一个描述：

```ts
type ThinkingInfo =
    | {kind: "unsupported"}                                  // 不推理：控件停用，原因“这个模型不支持思考”
    | {kind: "fixed"; level: string}                         // 只有一档（打包 22 个）：显示固定值
    | {kind: "levels"; levels: string[]; modelDefault: string | null}
    | {kind: "generic"; levels: string[]};                   // 第 4.3 节补的，界面加“?”
```

会话摘要再加 `defaultEffort: string | null` 与 `defaultFrom: {kind: "role"; role: string} | {kind: "model"} | null`。选择器据此画：

- `settings.effort === null`：高亮“跟随”，行尾写“主力的默认：high”（`defaultFrom.role` 取角色名）或“用模型的默认”；
- 点某一档：`changeSettings({effort: level})`（现有 `thinking.set` 动作，`session-host.ts` 1718 行）；点“跟随”：`changeSettings({effort: null})`；
- 选的档不在这个模型的档位里：显示“选 medium，实际 low”（浏览器按同一条夹取规则算，规则放 nb-models `./config`，与 `clampThinkingLevelForModel` 的行为对过测试）。

角色页拿快照角色的 `effort`（原值）与绑定模型的 `ThinkingInfo`；没绑定、不支持思考时停用并写原因（决定 15）。

需要改的合同：`harness/models.md` 输出 12、14（`defaultEffort`、全名由宿主给），`harness/runtime.md` 里对话请求取档的那条，`agent/compaction.md` 输出 2 的“会话的推理档”改成“对话请求用的推理档”，`models/service.md` 输出 8 末尾。

## 5. 协议检测

### 5.1 接口

nb-models 远程方法（`effect: "read"`，同 `check`：会发真实的计费请求，但不改设置）：

```ts
detectProtocols: {
    input: {
        baseUrl: string;                 // 表单里当前的值，可以没保存
        provider?: string;               // 给了就用这家已存的密钥、请求头与代理
        key?: string;                    // 新填、还没保存的密钥；只用于这次，不存、不回显
        auth?: "default" | "bearer" | "none";
        model?: string;                  // 用户指定的试探模型
        proxy?: ProviderProxy;           // 表单里的代理选择
    };
    output: Array<{
        api: Protocol;
        baseUrl: string;                 // 这个协议实际试的地址（已归一），“用这个”写的就是它
        model: string | null;            // 用哪个模型试的；挑不出时为 null
        result: CheckResult | {ok: false; kind: "local"; code: "no-model"; raw: ""};
        ms: number;
        auth?: "default" | "bearer";     // 换认证头后才通过时给出
    }>;
    errors: {"unknown-provider", "no-credentials"};
}
```

“用这个”= 浏览器调 `updateProvider({id, patch: {api, baseUrl, auth?}})`，之后按第 2.4 节立即拉这一家。检测本身不写任何东西。

### 5.2 实现位置

- `nb-harness/src/models/detect.ts`：与配置形状无关，收 `{baseUrl, key, headers, auth, model?, fetch, signal}`，交回上表的行。
- nb-models 核心只做：取这家的密钥与请求头（`provider` 给了时）、按 `proxy` 取 `fetch`、调它、把结果交回。
- 每种协议的做法：用 `buildModel({provider: "detect", api, baseUrl: 归一后的地址, id: 模型, contextWindow: 8192, maxTokens: 16})` 物化一个临时模型，再走 `ompCall`（与 `check` 同一条路径，最大输出 16、不带推理、`disableReasoning`），这样“检测通过”与“真实请求能发”是同一个客户端，错误分类与遮盖也复用。不另写四份手拼的请求体。
- 地址归一（照 Magpie，`research/magpie.md` 3.2）：先剥掉粘贴进来的端点后缀（`/chat/completions`、`/responses`、`/v1/messages`、`:generateContent`）；OpenAI 两种在没有路径时补 `/v1`，Anthropic 取不带 `/v1` 的根（与打包目录的写法一致，实测 3），Gemini 补 `/v1beta`。404 且没有 `/v1` 时补上再试一次。
- 只做两项容错：缺 `/v1`；Anthropic 网关只认 `Authorization` 时换 `bearer` 再试一次（`auth` 字段告诉界面）。其余中转站特判不做。
- 试探模型：用户给的 → 这家已有的启用模型里按协议挑（Anthropic 挑 `claude`、Gemini 挑含 `gemini` 的、其余挑第一个非 claude 的）→ 现拉一次 OpenAI 式 `/models`（经同一个 `fetch`）按同样规则挑 → 挑不出该行为 `no-model`。
- 四种协议并行，单个 20 秒上限，整次随 `ctx.signal` 中止；同一主机连接失败时其余行直接复用这个失败，不各等 20 秒。

## 6. 服务商图标

- 内置：`{kind: "builtin", key}`，键对应 `@lobehub/icons-static-svg` 的文件名；包只进浏览器入口，服务端不读。模板表给默认键（第 2.1 节）。
- 上传：`setIcon({provider, type, data})`。服务端按魔数判类型（PNG、JPEG、GIF、WebP、ICO），上限 1 MiB，文件名 `sha256` 前 16 位十六进制加扩展名，存 `<状态根>/models/icons/`，同内容只存一份，写临时文件再改名；成功后在同一次设置写入里把 `icon` 改成 `{kind: "upload", file}`。经 `HTTP_ROUTES_POINT` 提供 `GET /models/icons/<file>`（同 `plugins/stickers` 的做法），文件名按上面的正则核对，响应带 `X-Content-Type-Options: nosniff` 与长缓存。
- 第一版不收 SVG 上传：SVG 可以带脚本，直接打开图片地址时会在应用的来源里执行；要收时得先消毒或转成位图，不值得。
- 清理：删服务商、换图标之后，没有任何服务商引用、且超过 1 小时的文件删掉（在 models 的写入队列里做）。
- 首字母：`{kind: "letter"}`，字与色相浏览器按名字算，不存图片。

## 7. 最大的三个风险

1. **旧设置被整键丢弃，进而被覆盖写掉**。设置层对不合 schema 的键整键丢弃（`configuration.md` 输出 4），`providers` 是一整个数组，一项不合就整份变成缺省的 `[]`，用户下一次任何改动都会把文件里的服务商冲掉，且无法从界面恢复。同类的第二个坑是语义漂移：旧目录服务商若按新缺省“自动加入”读，OpenRouter 用户升级后多出几百个模型、“检测全部”变成几百次计费请求。缓解：schema 同时接受新旧字段、`autoAdd` 缺省按 false、读时归一写时写新；第一片就用真实设置场地跑 v1 的目录与自定义样本，断言升级前后快照与解析相同、写一次后再读不变。
2. **模型身份在“模板实例”下变得含糊**。`Model.provider` 同时决定 pi-ai 的 65 处专用处理、模型全名与缓存命名空间；同一模板两个实例、改了协议或地址的实例、12 家混合 api 的模板，每种都要选对“交给 pi-ai 的 provider 是谁、要不要重新物化”。选错的表现只在请求时出现（多发或少发专用请求头、Anthropic 直连地址规则套到中转上、两个 OpenRouter 实例的用量与会话记录记成同一个名字），单元测试很难覆盖到。缓解：全名一律由宿主给（`OmpTarget.name`）；“协议跟随模板 → 保持模板 id；换协议或通用模板 → 实例 id 并重新物化”写成一条规则、一个函数；对 OpenRouter、Anthropic 中转、混合 api 的 zenmux 各录一份真实请求的线上事实（`ModelWireObserver`）做快照。
3. **代理覆盖不全或静默失效**。Bun 会自动套用环境里的 `HTTP_PROXY` 且关不掉（实测 1），所以“直连”在这种环境下做不到；按代理分别包装的 `fetch` 会打掉 stencil 按函数身份的并发合并与 ETag，每家各下一份目录（压缩后约 235 KB、解压 3.6 MB）；不经 `fetch` 的传输不受控；本机与局域网的模型服务若被套上应用级代理会全部连不上。另外“默认开”的在线目录让每次启动都连第三方 `catalog.stencil.so` 与各家 `/models`，这对本地优先的产品是新的外联（决定 3 已接受，但要在“网络”页写清楚）。缓解：`fetchFor` 按有效代理缓存同一个函数、stencil 走应用级的单个函数；回环与私网地址默认不走代理；环境变量盖住直连时如实显示；`testProxy` 让用户能看到出口。

次一级的风险：快照体积（全部加入后每家几百行，每次 `changed` 整份推送，第 2.5 节）；在线发现的新模型落到 KDL 认不出的类别时套通用默认，能力与思考格式可能与上游不符（omp 接受同样的风险）。

## 8. 建议的实施切片顺序

| 片 | 内容 | 依赖 | 验证 |
|---|---|---|---|
| 1 | 配置 v2 形状、读时归一写时写新、`template` 取代 `kind`（行为不变：旧目录服务商 = 模板实例且 `autoAdd: false`，旧自定义 = 通用模板且全是手动模型）；合同升版本 2 的骨架；快照去 `kind`、加 `template`；前端按 `kind` 分支的几处跟着改 | 无 | nb-models 核心测试；`settings-store.test.ts` 喂 v1 样本；现有 `models.test.ts` 不改断言照过 |
| 2 | 模型来源：`sources.ts`、`<状态根>/agent/models.db`、激活时 offline 加后台 online；解析改从实例的 `Model[]` 取、`OmpTarget.name`；`templates`、`addProvider` 从模板建且 `autoAdd: true`、`duplicateProvider`、`providerModels`、`setModels` 新语义、`refreshCatalog`；`catalogAutoUpdate` 设置项；量快照体积 | 1 | pi-catalog 的 model manager 用注入的 `fetch` 指向本机假端点（不打真实网络）；离线启动等于只有打包目录；两个 OpenRouter 实例全名不撞 |
| 3 | 思考档：角色 `effort`、`ModelInfo.defaultEffort`、内核 `requestEffort` 四处、通用几档的物化、`ThinkingInfo` 进快照与会话摘要 | 1（与 2 可并行；2 合入后补来源模型的 `generic` 情况） | 内核测试：会话明确 > 角色 > 不发；就地压缩与对话同档；审批带 `disableReasoning` 时不套角色档 |
| 4 | 网络：`nbook.network` 插件、两个设置项、`describe` 的解析顺序与系统代理读取、`fetchFor`；注入 `OmpTarget.fetch`、来源、stencil；服务商级 `proxy`；`status`、`setProxy`、`testProxy` | 2（注入点在 2 里建好） | 本机假代理（同实测 1 的做法）断言对话、发现、检测都经过它；回环不经过；socks 被拒 |
| 5 | 协议检测 `detect.ts` 与 `detectProtocols`；图标上传、HTTP 路由与清理 | 4（检测走 `fetchFor`）；图标只依赖 1 | 本机假端点分别只实现一种协议，检测结果逐行正确；缺 `/v1` 的补试 |
| 6 | 前端（另派前端设计与审查）：添加服务商的分组多列、服务商详情、角色页思考档、选择器、“网络”页 | 各对应后端片 | 按 UI 验收分档 |

先做 1 的理由：后面每一片都会写 `providers`，形状不先定、兼容不先测，后面任何一片的写入都可能把旧数据写坏。2 放在 4 前面：代理要注入的“发现”“stencil”两个请求点是 2 才建出来的，先做 4 只能接一半。3 与其它片几乎不碰同一批文件，可以和 2 并行。Spec（`models/service.md`、`models/settings-pages.md`、`harness/models.md`、`agent/compaction.md`、新的 `network` Spec）建议在第 1 片之前一次写好待实现的合同，再按片晋升。

## 9. 需要开发者拍板的点

1. 代理“直连”遇到环境变量：第 3.3 节 A（如实显示、做不到）还是 B（清掉进程环境的代理变量，代价是网页工具等也要接网络服务）。推荐 A。
2. 复制服务商时是否在服务端一并复制密钥（推荐复制：多数用途是同一把密钥换协议或地址；要换密钥的用户本来就要重填）。
3. 角色思考档要不要“关闭思考”一档（`off`）。决定里没有，第一版不加。
4. `template` 建后不可改（推荐），“换模板”做成“复制一份并换模板”。
5. 代理地址不带用户名密码（第一版拒收）。

