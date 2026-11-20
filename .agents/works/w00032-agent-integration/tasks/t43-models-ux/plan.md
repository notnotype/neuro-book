# t43 实施计划（第二稿）：服务商、模型角色与模型选择器的体验改进

第一稿（提交 `f7aba6415`）经三方设计审查后整份重写（决定 24）：审查报告与逐条处理见 [`evidences/design-review-disposition.md`](evidences/design-review-disposition.md)。

## Context

开发者 2026-11-20 的 13 条反馈（[README](README.md#开发者的反馈2026-11-20)）经调研与三轮静态稿定为决定 1–17，计划阶段又定了 18–24（[README 的决定](README.md#决定开发者-2026-11-20-会话)）。要解决：

- 服务商分“目录”“自定义”两种：目录的不能发现、不能改协议、不能重复添加；模型解析只认 OMP 打包目录里的 id，不升级依赖拿不到新模型；添加后模型为空。
- 没有代理、协议检测、服务商图标。
- 角色不能设思考档；选择器在档位少于两个时隐藏思考档；选择器的角色卡片占地方、阴影重。

依据：[`models/service.md`](../../../../../docs/specs/models/service.md)、[`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“输入框与待处理区”、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 7、22、[`harness/models.md`](../../../../../docs/specs/harness/models.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`web/tools.md`](../../../../../docs/specs/web/tools.md)；[ADR 0036](../../../../../docs/adr/0036-app-package-installs-omp.md)、[ADR 0045](../../../../../docs/adr/0045-shared-host-packages-for-second-app.md)。取代 t09 决定 11、12（目录与自定义两种服务商）。

工作方式：分三段，**A 推理档与选择器 → B 服务商模板化与模型来源 → C 网络与代理**。三段一起审这一稿（决定 24），之后按顺序实施，每段一条分支、单独实现审查（后端 omp、前端 Claude Sonnet）、单独合入。主会话自己写代码。代码在 Work 的 worktree 上做（`.worktree/w00032-agent-integration` 快进到 master；有别的会话在用时另开 `feat/w00032-t43-<段>`），Spec 与 Task 记录在主工作区改。

## 取舍

1. **模型清单的真相源**：设置里的覆盖与成员记录（手加、来源模型的覆盖、冻结成员），加上状态根里我方维护的来源缓存，再加上 OMP 的元数据（打包目录与在线目录）。同一份设置在两台机器上可能得到不同的清单；这是“不升级也能拿到新模型”的代价。不把目录快照存进设置（设置要小、要能手改）。
2. **发现与缓存由我方做，OMP 只提供元数据与请求传输**：第一稿直接用 OMP 的目录工厂与 `ModelManager`，审查查出它们按 OMP 自己的 provider 身份做缓存与认证，不认实例改过的地址、认证与协议，部分失败会标成新鲜，更新时间是“最近尝试”（omp 第 5、6、13、22、23、28、30 条）。改为：我方按实例的有效协议、地址与认证发列表请求（OpenAI 兼容、Anthropic、Gemini 三种列表协议，OpenRouter 只多读它的模态字段），缓存按“来源身份”分开存；OMP 的打包目录与 stencil 在线目录只按模型 id 提供能力、单价、档位。
3. **模型身份**：pi-ai 按 `Model.provider` 走各家的专用处理，进程环境变量（例如 `MOONSHOT_BASE_URL`）还会按它改写请求地址（omp 第 24 条实测）。规则：实例的协议与地址都跟随模板时，`Model.provider` 用模板的 OMP id（保留专用处理）；改了协议或地址、或空白模板时，用中性身份 `nbook-compatible`（不会撞任何 OMP provider，也不受按 provider 的环境变量改写）。对外的模型引用（会话、用量、日志）一律是 `<实例 id>/<模型 id>`；请求结果另记原生来源 `{provider, api}`，还原历史时按它判断是否同源（omp 第 7 条）。不改上游：让 pi-ai 不按 provider 分支要改几十处，代价远大于我方多记一个字段。
4. **网络出口归属**：出口规则、系统代理读取与按次的 `fetch` 放与应用无关的 `@notnotype/nb-host/network`（NeuroBot 也能用），`nbook.network` 插件只持有设置项、服务键与页面（拉远看第 2 条）。不做本机中继（决定 21）。

这四条写进新 ADR 0057。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 模型元数据（能力、单价、档位）与在线更新 | `@oh-my-pi/pi-catalog`：打包目录 `getBundledModels`、stencil 目录的取与映射（`modelsDevCatalogFallback` 内部用的那组导出，第 B1 片核对公开名）、`buildModel`、`ThinkingConfig` | 已是依赖；否决用它的 `ModelManager` 与目录工厂（取舍 2） |
| 列表请求 | 我方三个适配器；不复用 `fetchOpenAICompatibleModels`（默认映射把所有行当对话模型，omp 第 13 条） | 每种协议几十行，按实例认证与地址发，能保留分类证据 |
| 代理 | Bun 的按次 `proxy`（http、https）与 `proxy: false`（Bun ≥ 1.4.3），无新依赖 | 决定 21；否决本机中继与 `socks` |
| 读操作系统的代理设置 | 各平台调系统命令（Linux `gsettings`、KDE `kreadconfig5`/`kioslaverc`，macOS `scutil --proxy`，Windows `reg query`），带超时 | 否决 `os-proxy-config`：Linux 不读桌面设置，Windows 经 `registry-js` 带原生模块（拉远看第 6 条、omp 第 18 条） |
| 服务商图标 | `@lobehub/icons-static-svg`（MIT） | 覆盖国内外主要厂商；品牌标志的商标归各厂商，作为风险写在最后一节 |
| 上传图标 | 存状态根下的文件，HTTP 路由取，照 `plugins/bots/backend/avatar.ts`；类型用 `nbook/shared/image-type` 的 `sniffStillImageType` | 否决存进设置（多家图标会撑过 RPC 1 MiB 上限，omp 第 29 条） |

## 段 A：推理档与选择器

### A.1 档位能力（`packages/nb-harness/src/models/` 新增 `reasoning.ts`）

`reasoningOf(model: Model): ReasoningCapability`，快照、内核的 `ModelInfo`、选择器、角色页都用它：

```ts
type ReasoningCapability =
    | {kind: "none"}                                   // 不推理
    | {kind: "fixed"}                                  // 会推理但不能调档（thinking 为空）
    | {kind: "levels"; levels: Effort[]; canDisable: boolean; verified: boolean};
// canDisable = !thinking.requiresEffort || thinking.suppressWhenOff；verified = !thinking.unverified
```

决定 6 的“没声明档位的给通用几档”落成 `verified: false` 的档（OMP 对缺证据的模型已物化出未验证的档，界面加“?”说明）；`fixed` 的写“这个模型会思考，但不能调档”。只有 `canDisable` 时才给“关闭”。

### A.2 角色的思考档与请求档位

- `nb-models/src/config/shapes.ts`：`RoleConfig` 加 `effort?: Effort | "off"`、`icon?: string`（图标键）。
- 角色的默认档是**一次解析的属性**，不写进按模型缓存的 `ModelInfo`（omp 第 12 条）：`resolveRole` 交回的解析结果带 `defaultEffort`；直接指名模型时没有。
- 内核加 `requestEffort(sessionEffort, resolution)`：会话的 `core.effort` 非 null 时用它，否则用解析带的 `defaultEffort`，都没有则不发。用在每条实际请求的构造处：对话（`kernel/run/loop.ts`）、预览（`kernel/view/request.ts`）、就地压缩沿用本轮对话的解析与档位、摘要压缩在 `ModelCaller` 选定压缩模型之后按它的解析算（`kit/compaction/summary.ts`、`kernel/run/model-call.ts`）、`complete()`（`kernel/session/complete.ts`）。审批草稿带 `disableReasoning` 时不套档。`"off"` 只在 `canDisable` 时映射成 `disableReasoning`。子会话照 `agent/subagents.md` 的参数表：不传 `effort` 按子 Profile 选，显式传才覆盖。
- 会话“跟随”就是 `core.effort === null`；新动作 `thinking.reset` 写 `{effort: null}`。
- 验收断言**线上实际发出的请求体**（omp 第 11 条）：可关闭、强制推理、`fixed`、未验证档四类各一。

### A.3 远程合同与快照（nb-models）

`setRole` 按字段打补丁：省略不改、`null` 清除、具体值写入；只改档不带 `model`（omp 第 26 条）。第一次绑 `fast` 时同步 `compaction` 的规则只在模型由未绑定变为绑定时触发。快照的角色带 `effort`、`icon`，模型带 `reasoning: ReasoningCapability`。

### A.4 选择器（`packages/nb-agent-ui/src/vue/composer/AgentRoleModelPicker.vue`）

- 视图类型（`types.ts`）全部新增可选字段，旧宿主（nb-story 的 QaPage、Lab 夹具、`AgentModelPicker`）不改：`ComposerView.effort?: ComposerEffortView`（能力、明确选的档、跟随的档与来源与文案）；缺省时按旧的 `thinkingLevels`、`thinking` 推出。`ComposerRoleView` 加 `icon?`、`modelIcon?`、`effortLabel?`；`ComposerModelView` 只加 `groupId?`（分组键用服务商 id，不用名称，前端审查第 10 条）与 `groupIcon?`；`ComposerIcon = {kind: "mask" | "image"; src: string} | {kind: "initial"; text: string} | {kind: "class"; name: string}`，不用 `v-html`（前端审查第 8 条）。`applyComposerAction` 处理 `thinking.reset`。
- 跟随的档是**夹取后的有效档**，由宿主用内核同一个夹取函数算（前端审查第 7 条）；来源是角色时写“主力的默认”，直接选模型时写“模型的默认”，模型没有默认档时不画细框。
- 版式照第 3 轮稿：头部两行；角色两列单行项，面板内容宽 < 480px 时单列（容器查询）；思考行窄时拆两行（档位占满一行，“X 的默认”换到下一行右对齐）。
- 思考档用 `SegmentedControl` 的 raised 加 inherited（A.5）。写入：方向键只移焦点、回车空格或点击才提交（`activation: "manual"`），所以不会连发；跟随态点细框那一档也提交（钉成明确选择）。旧的两条 dom 用例（滑块“停下才发”、单档不显示）按新设计改写。
- 模型库：按服务商分组带组图标与个数；超过 30 个的组默认收起，当前模型所在组展开；搜索时只渲染命中项、命中组展开、清空后恢复；方向键用 nb-ui 的 roving 焦点在行间移动；组头 `aria-expanded`、可访问名称带个数。`data-model-picker*` 钩子保留，写进组件 `.md`。

### A.5 nb-ui

- `SegmentedControl`：`variant?: "solid" | "raised"`；`inherited?: boolean`（当前档只画细框，只改外观，读屏由调用方的 `aria-describedby` 给）；`activation?: "focus" | "manual"`（缺省 `focus` 保持现状）。`.md` 写明 raised 用于有序档位、不超过 7 档。
- 投影（决定 10）：`themes/nbook/vars.css` 亮色块的 `--elevation-popover` 写成现在亮色菜单档的字面量；暗色块不动（保留亮边，前端审查第 2 条）；`src/tokens.css` 不动（避免与 `--elevation-menu: var(--elevation-popover)` 成环）。实施时把常驻卡片（提示卡、批注卡、向导的浮动形态）亮暗各截一张给开发者确认。

### A.6 图标表（`packages/neuro-book/src/ui/provider-icons/`、`src/ui/role-icons.ts`）

- 服务商图标：模板键 → `@lobehub/icons-static-svg` 的 SVG（`?url` 资源），单色的用 `mask`、彩色的用 `image`；表按需动态导入，加载完成前给首字母方块，加载完经一个 ref 触发视图重算。放 `src/ui/` 是因为 agent 插件与 models 插件都要用，而跨插件的运行时导入只许指向对方的 `shared/contracts.ts`（`architecture.test.ts`）。段 A 按现有的目录服务商 id 取图标，段 B 换成模板键。
- 角色图标：键 → 字面量类名的表（内置五个与自建可挑的十来个），nb-models 只存键。

### A.7 角色页（`plugins/models/web/components/RolesPage.vue`）

角色图标、思考档一列（第 2 轮稿）：选项来自绑定模型的 `reasoning`，第一项“跟随模型”；没绑定、`none`、`fixed` 停用并把原因写在框里；未验证档加“?”。自建角色可挑图标。

### A.8 Agent 插件（`plugins/agent/web/plugin.ts`、`session-host.ts`）

构造选择器视图时带上角色图标、组图标、`effort` 视图；`thinking.reset` 写会话设置。

## 段 B：服务商模板化与模型来源

### B.1 模板表

- `nb-models/src/config/templates.ts`（纯数据，我方部分）：`{id, group, logo?, regions?: Array<{id, label, baseUrl}>, extra?: {name, api, baseUrl}}`；分组按第 1 轮稿。
- `nb-harness/src/models/templates.ts`：`listTemplates()` 合并 OMP 的打包服务商与只有描述的本机服务商（Ollama、LM Studio、vLLM、LiteLLM、SiliconFlow）与我方表，每个模板写三种能力（omp 第 30 条）：`addable`（有 API Key 或免认证的认证方式，且模型的传输都走 `fetch`；登录类、Cursor 这类 HTTP/2 传输、Bedrock 这类签名认证为否并给原因）、`listing`（`openai` | `anthropic` | `gemini` | `openrouter` | `static`）、默认协议与地址。服务端对不可添加的模板拒绝并回原因。

### B.2 配置形状 v2（`nb-models/src/config/shapes.ts`）

```ts
type ProviderConfig = {
    id: string;                      // 由名称生成（不再保留目录 id），同模板可多份
    template: string;                // 建后不变；空白模板 blank-openai、blank-anthropic、blank-gemini
    region?: string;                 // 模板的地区，决定模板地址
    name: string;                    // 唯一；重名加“ 2”，复制默认“<原名> 副本”
    icon?: {kind: "builtin"; key: string} | {kind: "file"; name: string} | {kind: "initial"};
    api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";   // 不写：每个模型用来源与目录给的协议
    baseUrl?: string;                // 不写：用模板（与地区）的地址
    apiKeyEnv?: string; auth: "default" | "bearer" | "none"; headers?: Record<string, string>;
    proxy?: {mode: "system" | "custom" | "direct"; url?: string};   // 不写：跟随应用（段 C）
    followSource: boolean;           // 服务商新出的模型自动加入
    excluded: string[];              // 用户移出的来源模型
    models: Array<ModelConfig & {origin: "manual" | "source"}>;   // manual 手加；source 是来源模型的覆盖或冻结成员
};
```

- **v1 的读法**（omp 第 9 条）：schema 每个元素同时接受新旧形状；按 v1 的运行时语义归一：目录服务商的旧 `api` 不是覆盖（v1 本来就不读它），旧 `baseUrl` 是覆盖，`followSource: false`，模型条目 `origin: "source"`；自定义服务商映射到对应的空白模板，模型条目 `origin: "manual"`。补丁的 `expect` 用磁盘上的原值算，冲突后重读重新归一再合并。单个坏条目照设置层规则整键回退，不当成空数组写回。
- **关掉自动加入**（omp 第 4 条）：只给此刻有效、还没有条目的成员补 `{id, origin: "source", enabled}`，已有条目原样不动。重新打开时，只有 `id` 与 `enabled` 的冻结条目在同一次写里去掉，有覆盖的留下。
- **来历决定解析**（omp 第 10 条、拉远看第 3 条）：手加的不看来源，缺上下文窗口照旧不能启用；来源模型从来源消失时（列表请求成功但少了它），被启用或被角色引用的沿用上一次物化的结果继续可调用，快照标 `missing`，由用户在界面上移除；用户移出（`excluded`）照现行输出 15 解除角色绑定。

### B.3 模型来源（`nb-harness/src/models/sources/`）

- `listing.ts`：三种列表协议的适配器加 OpenRouter 的变体，按实例的**有效**协议、地址、认证（`requestAuth`、`resolveHeaders`，免认证不带任何凭据）发 `GET`，`redirect: "manual"`，分页读完；每行交回 `{id, name?, kind: "chat" | "other" | "unknown", evidence}`：Gemini 看 `supportedGenerationMethods`、OpenRouter 看输入输出模态（不按工具筛，omp 第 13 条），OpenAI 兼容按 id 到目录里查，查不到为 `unknown`。失败按 `no-credentials`、`auth`、`not-found`、`unreachable`、`bad-response` 分类。
- `cache.ts`：每个实例一份 `<状态根>/agent/model-sources/<实例 id>.json`：`{identity, lastAttemptAt, lastSuccessAt, members, retired}`。`identity` 是有效地址、列表协议、认证方式与凭据的不可逆摘要（SHA-256 截断）的组合：身份变了旧缓存一律不用（omp 第 6 条）。成功的空表也是权威成员（omp 第 23 条）。从成员里消失的条目移进 `retired`（保留物化需要的元数据），供 B.2 的“沿用”。
- `catalog.ts`：在线目录（stencil）的取与缓存 `<状态根>/agent/catalog/stencil.json`（ETag、最近尝试与最近成功分开记），元数据按 id 查：在线优先，打包兜底。
- `coordinator.ts`：核心按有效设置与凭据的变化统一协调来源（omp 第 27 条），不只挂在远程方法上。每个实例一个配置代次：身份变了取消旧代次的在途请求，结果只在代次仍是当前的时候提交；同一身份的在途请求合并；手动“重新拉取”是强制更新，不被只读缓存的在途任务吞掉。网络等待不占设置写队列，提交经串行队列、一次清解析缓存并发 `changed`。自动更新开着时：启动先用缓存，过期（24 小时）的后台更新；关着时只在添加、填完密钥、“重新拉取”“现在更新”时请求。
- 停止（omp 第 21 条）：插件停止时先让当前代次不可提交、取消在途请求，限时等它们收尾，再关缓存句柄；不在设置写队列里等网络。

### B.4 解析与模型身份（`nb-harness/src/models/target.ts`、`kernel/model/omp.ts`）

- 物化：元数据（在线目录、打包目录）加实例覆盖经 `buildModel`；`Model.provider` 按取舍 3；中性身份时只带本次协议需要的字段，不带旧协议的 `compat` 与专用头（omp 第 25 条）。
- 地址锁定：实例改过地址时，对照列出会按环境变量或凭据改写请求地址的 pi-ai 分支（第 B1 片逐个核对），由中性身份避开；仍避不开的组合在解析时报错，不把密钥发到别处（omp 第 24 条）。
- `OmpTarget` 加 `name`（公开引用）与 `fetch`；`ompCall` 的模型名用 `name`；`ModelResponse` 加 `origin: {provider, api}` 写进会话日志；`toContext` 有 `origin` 时按它判断同源，没有时（旧日志）照旧拆名字（omp 第 7 条）。会话日志加字段按 nb-session 的兼容规则（新增可选字段）。

### B.5 服务核心与合同（`nb-models/src/core/`、`contract/`）

- 远程合同升到版本 2，补丁一律“省略不改、`null` 清除”：
  - `templates()`（取代 `catalogProviders`）；`addProvider({template, region?, name?, baseUrl?, api?})`：空白模板必须带名称与地址；新建前清掉同 id 的遗留密钥（omp 第 15 条）。
  - `duplicateProvider(id)`：复制配置；凭据只复制有效的方式（`apiKeyEnv` 复制引用，库里的密钥复制一行）；第二步失败回 `partially-applied` 带副本 id 与实际密钥状态，不重复复制。
  - `providerModels(provider, {query?, offset, limit})`：分页取一家的模型（快照不再带模型全表，omp 第 29 条）；`refreshModels(provider)`、`refreshCatalog()`。
  - `detectApi({provider, baseUrl?, model?, signal})`：见 B.6。
  - `checkAll({provider, ids})`：只检测确认过的 id；同一服务商共享并发 4；取消后不再领新项（omp 第 17 条）。
  - `setIcon(provider, upload | builtin | initial | null)`、`updateProvider` 收 `region`、`api`、`baseUrl`、`proxy`、`followSource`、`name`。
- 快照：服务商带模板、地区、图标、代理、来源状态（`lastSuccessAt`、`lastAttemptAt`、失败类别）、模型数与启用数；角色同段 A；启用模型的列表只给选择器要的字段（id、名称、组、能力、窗口、单价），全量时也量线上字节（B 段验收）。
- 检测（`check`）改用 B.6 的探测请求，满足 Spec 输出 11 的“不带推理”。

### B.6 协议检测（`nb-harness/src/models/probe.ts`）

专门的一次请求（omp 第 14、16 条）：不经 `ompCall`（它的流恢复会重试、Anthropic 会落盘），按协议自己构造最小请求（Chat Completions、Responses、Anthropic Messages、Gemini generateContent，`max_tokens` 16、不带推理参数），每种协议恰好一次 HTTP、不重试、不写文件，四种并行，整次 15 秒上限、可取消。模型 id 依次取：调用方给的、第一个启用的、来源列表里的第一个对话模型；都没有时界面要求填一个。结果带规范化地址、所用模型、`{ok, status, ms, message}`（原文遮盖、截断）。采纳时协议与地址在一个补丁里写，`expect` 为检测时的值。地址改成别的来源时不带已存凭据（界面明说要先填密钥）。

### B.7 图标上传（`plugins/models/backend/icons.ts`）

`POST` 上传（≤ 256 KB，`sniffStillImageType` 只收 PNG、JPEG、WebP），服务端存 `<状态根>/agent/provider-icons/<sha256>.<ext>`，配置存 `{kind: "file", name}`；`GET /api/nbook.models/icons/<name>` 照 bots 头像的路由（逐段不跟链接、`nosniff`、跨站拒绝、ETag）。没有引用的文件在删服务商或换图标时删。

### B.8 设置页（`plugins/models/web/`）

- 添加对话框：分组多列（第 1 轮稿）；空白模板与有地区的模板进第二步（名称、地址、协议，或地区），校验同现状；“已添加”写进可访问名称，不停用；登录组默认收起，服务端同样拒绝。
- 服务商详情：标题区图标弹出（内置只列模板用到的、上传、首字母、恢复模板的）、名称就地改（Enter 写、Esc 还原、重名原位报错）、“复制一份”（复制后选中副本、焦点到名称）；删除仍在列表条目上（决定 19）。协议下拉第一项“按模型（跟随模板）”；“检测协议”就地列结果（写出所用模型；地址、协议、密钥变了清结果；离开页面取消）。“恢复模板地址”。代理字段在段 C 加。
- 模型区：搜索框、系列默认收起（有搜索时展开命中组）、“重新拉取”、个数与来源状态（失败时写类别与“沿用上一次”）、“服务商新出的模型自动加入”开关；`missing` 的行写“服务商已不再提供”与移除按钮。“检测全部”超过 20 个先确认个数。
- 管理模型：所有服务商都列来源的模型（`unknown` 分类单独一组，不自动启用）、可“重新拉取”；全部模型页加搜索与按服务商收起。
- 窄与英文：390 宽与英文场景，无横向溢出。

## 段 C：网络与代理

### C.1 出口（`packages/nb-host/src/network/`，子路径 `@notnotype/nb-host/network`）

```ts
createEgress(options: {
    setting(): {mode: "system" | "custom" | "direct"; url?: string};   // 现读
    startupEnv: Readonly<Record<string, string | undefined>>;
    platform: NodeJS.Platform;
    run(command: string[], timeoutMs: number): Promise<{code: number; stdout: string}>;   // 读系统设置用，测试可换
}): {
    fetchFor(override?: ProviderProxy): typeof fetch;
    describe(): Promise<EgressSummary>;   // 脱敏：{mode, origin?, hasCredentials, source, unsupported?, error?}
    test(override?: ProviderProxy, signal?: AbortSignal): Promise<EgressTestResult>;
};
```

- 按次选路：本机与私网地址直连（主机串判定，IPv4 映射的 IPv6 也算；不做 DNS 解析，写进 Spec 的已知行为）；`direct` 写 `proxy: false`；`custom` 写 `proxy: <url>`（只收 http、https，带用户名密码的原位拒绝，决定 20）；`system` 按目标协议取规则：启动环境的 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY` 与 `NO_PROXY`，再取操作系统设置（各平台命令，超时 2 秒，缓存 60 秒）；系统给的是 SOCKS 或 PAC 时请求失败并给 `proxy-unsupported`（不悄悄直连）；读失败与“没有设代理”区分（omp 第 19 条）。服务商的 `proxy` 覆盖应用的。
- 重定向（omp 第 20 条）：包装把 `redirect` 设成 `manual`，自己跟随最多 5 跳，每跳重新选路；跨源的一跳去掉 `Authorization`、`x-api-key`、`x-goog-api-key` 与自定义头。
- 环境的 `NO_PROXY` 会让 Bun 绕过显式代理（omp 第 3 条）：`system` 模式本来就按它选路；`custom` 模式下也照样生效，写进 Spec 的已知行为。
- pi-ai 设了 `PI_PROXY` 时会在外面再包一层：我方 `fetch` 是最里层，断言 `proxy: false` 仍直连。`packages/neuro-book/package.json` 的 `engines.bun` 抬到 `>=1.4.3`。

### C.2 `nbook.network` 插件（`packages/neuro-book/src/plugins/network/`）

- 设置项（都只允许用户层）：`proxyMode`（缺省 `system`）、`proxyUrl`、`catalogAutoUpdate`（缺省开；`nbook.models` 只读它，前端审查第 3 条）。设置分区 `nbook.network`（分类 app，排“外观”之后，page 分区）。
- 服务键 `networkKey`：`fetchFor(override?)`、`describe()`；远程合同 `nbook.network/settings`：`describe()`、`test()`。
- 入口依赖：`nbook.models` 后端 → `networkKey`；`nbook.web-tools` 后端 → `networkKey`（决定 22，`plugin.ts` 把全局 `fetch` 换成 `fetchFor()`）；网络页 → `nbook.models` 的远程合同（“现在更新”、目录状态）。入口级不成环，`architecture.test.ts` 守住。
- 网络页（第 3 轮稿）：“代理方式”“代理地址”用 `SettingsRow`；“测试代理”“现在更新”用新的 `src/ui/settings/SettingsActionRow`（标题、说明、右端动作、行下状态 `aria-live="polite"`，样式变量与 `SettingsRow` 共用）。代理地址的说明去掉“可以带用户名和密码”。
- 模型服务：各请求点用 `fetchFor(provider.proxy)`（`OmpTarget.fetch`、列表请求、检测、探测）；在线目录用 `fetchFor()` 的同一个函数（不按服务商）。服务商详情的“高级”里加代理（跟随应用、跟随系统、自定义、直连）。

## Spec 与文档改动

| 文件 | 段 | 改什么 |
|---|---|---|
| `docs/adr/0057-…md`（新） | A 前 | “取舍”四条与决定 1 |
| `harness/models.md`、`harness/runtime.md` | A、B | `ReasoningCapability`；`requestEffort` 与五处请求；`defaultEffort` 是解析属性；`OmpTarget.name`、`fetch`；`ModelResponse.origin` 与同源判断 |
| `models/service.md` | A、B、C | 术语（模板、实例、来源、来历）；输入形状 v2 与 v1 读法、降级后果（决定 23）；输出 5、7、8、9、11、12、13、15 改；新增：模型来源与在线目录、跟随与冻结、协议检测、复制、图标、角色思考档；非目标去掉“代理设置” |
| `models/settings-pages.md` | A、B、C | 输出 1、2、3、4、6、7、8、9、10、11、13 改；新增标题区、检测、来源状态、代理字段 |
| `network/egress.md`（新，planned） | C | 设置项、选路规则、系统代理读法与来源、重定向、测试、已知行为（`NO_PROXY`、不做 DNS、SOCKS 拒收）；网络页 |
| `web/tools.md` | C | 请求经网络出口 |
| `ui/agent-conversation-view.md` | A | 选择器：两列与单列、图标、思考档的状态与跟随、模型库分组与键盘 |
| `agent/conversation.md` | A | 输出 7、22：跟随与“用 X 的默认” |
| nb-ui `SegmentedControl.md`、`docs/specs/theme/system.md` | A | raised、inherited、activation；nbook 亮色气泡档 |

## 切片

每片一个或几个提交，片内自跑所列验证；每段结束开实现审查、处理、合入，Task README 记进度。

**段 A**
- A1 ADR 0057；`reasoningOf` 与 `requestEffort` 及五处请求（nb-harness）。验证：nb-harness 相关单元测试，线上请求体断言四类。
- A2 角色 `effort`、`icon` 与 `setRole` 的字段补丁（nb-models、models 插件）。验证：nb-models、`models.test.ts`。
- A3 nb-ui：`SegmentedControl` 三个属性、nbook 亮色投影。验证：nb-ui 单元与 dom 测试、Lab 场景；常驻卡片亮暗截图交开发者。
- A4 图标表与角色图标表（`src/ui/`）。验证：每个模板键都取得到、未登记回退首字母（dom 测试）。
- A5 选择器与 agent 宿主。验证：`AgentRoleModelPicker`、`AgentConversationComposer` dom 测试（含 340px 无溢出、跟随与明确的切换、只渲染命中项的节点计数并做变异检查）、`session-host` 测试；Lab（亮色、390 宽、英文）。
- A6 角色页。验证：`RolesPage` dom 测试、`pages-focus.dom.test.ts`。
- A7 段 A 收口：e2e（见“验证”）、实现审查、合入。

**段 B**
- B1 模板表与能力；核对 stencil 的公开导出与会按环境改地址的 pi-ai 分支，结论记 `evidences/b1-probes.txt`。
- B2 配置 v2 与 v1 读法（用真实设置场地喂 v1 文件做对照，含首写前的外部编辑、坏条目整键回退）。
- B3 来源：列表适配器、缓存、在线目录、协调器、停止顺序。验证：本机假端点（OpenAI 兼容、Anthropic、Gemini、OpenRouter 的模态字段、分页、401、404、503、空表），断言实收的地址与认证头、身份变化不读旧缓存、成功空表的权威性、代次丢弃。
- B4 解析、模型身份、日志 `origin`。验证：同模板两家带签名思考块与工具调用的多轮本机流；改协议或地址后不还原旧签名；`MOONSHOT_BASE_URL` 设着时实收地址仍是配置的。
- B5 核心与合同 v2（添加、复制、分页取模型、刷新、检测全部、图标）与探测请求。验证：nb-models core、`models.test.ts`（各协议探测实收恰好一次、取消、采纳的 `expect`）；`test:llm` 一轮。
- B6 设置页。验证：各组件 dom 测试、`models-store.test.ts`；600 个模型的场景打开详情首屏 < 300 ms、搜索一次 < 100 ms（happy-dom），超了上虚拟列表。
- B7 段 B 收口：快照与 `providerModels` 的线上字节（8 个大服务商全加），e2e、实现审查、合入。

**段 C**
- C1 `nb-host/network`：选路、系统代理的各平台解析（喂样本输出）、重定向。验证：本机真实 HTTP 代理与两个目标端点，断言实收线路与头、直连盖过 `HTTPS_PROXY`、`PI_PROXY` 设着时仍直连、跨源一跳不带凭据。
- C2 `nbook.network` 插件、网页工具与模型服务接入、服务商代理字段。验证：插件测试、`models.test.ts` 一轮对话走本机代理、web-tools 测试。
- C3 网络页与 `SettingsActionRow`。验证：dom 测试、Lab。
- C4 段 C 收口：Windows 的系统代理在 pc-notype 上实测（macOS 标未验证），e2e、实现审查、合入。

## 验收映射

改完 Spec 后按编号补全；下面是要新增的覆盖。

| 行为 | 覆盖 |
|---|---|
| 四类档位能力的实际请求体；会话、角色、模型默认的优先级；审批不套档；摘要压缩用压缩角色的档 | nb-harness 内核测试（本机假端点读请求体） |
| 只改角色档不动绑定；两窗口交错改模型与档 | nb-models core、`models.test.ts` |
| 选择器：跟随与明确切换、方向键不提交、340px 无溢出、单列退让、大组收起与当前组展开、只渲染命中项（变异）、键盘与读屏 | `AgentRoleModelPicker.dom.test.ts`、`AgentConversationComposer.dom.test.ts` |
| v1 设置读进来行为不变；首写前外部编辑；坏条目 | `settings-store.test.ts`、`models.test.ts` |
| 关掉、打开自动加入不动已有条目；来源消失时被引用的仍可调用 | `models.test.ts` |
| 列表请求的地址与认证、分类、部分失败、身份变化、代次 | nb-harness `sources` 测试 |
| 同模板两家的多轮签名；环境变量不改写地址 | nb-harness `omp` 测试 |
| 探测每种协议实收一次、取消、采纳 | `models.test.ts` |
| 复制的部分成功；新建不接手遗留密钥 | `models.test.ts` |
| 选路、重定向、系统代理解析、SOCKS 与 PAC 拒绝、脱敏 | nb-host `network` 测试 |
| 设置页各交互、空白模板第二步、同名、检测结果失效、窄与英文 | 组件 dom 测试、`e2e/models.e2e.ts` |
| 网络页 | dom 测试、`e2e/settings.e2e.ts` |
| `data-model-picker*` 钩子仍在 | `e2e/agent-conversation.e2e.ts` |

## 验证

- 每段合入前的 e2e：A 段 `agent-conversation`、`lab-agent-ui`、`models`、`lab-scenes`；B 段 `models`、`settings`、`agent-conversation`；C 段 `settings`、`models`。开工前在起点上各跑一遍记基线，已知的原有失败（`lab-scenes` 的 ThemeEditor 404 四条、`workbench-views:754` 等，见 Agent 记忆）先对照，不算本段。实施中只重跑改到的文件。
- 真实模型：`test:llm` 在 A、B 段收口各一次。
- 未验证边界：macOS 的系统代理读法；需要登录的服务商（不在范围）。

## 不做与风险

- 不做：OAuth 登录；Magpie 的粘贴 curl、余额探测、导入别的应用；抓站点图标；SOCKS5 与 PAC（决定 21）；装回旧版的保护（决定 23）。
- 风险：
  - 我方三个列表适配器要跟上各家接口的变化：只用各协议公开的列表接口，失败按类别报告、沿用上一次；新增服务商的特殊列表另加适配器。
  - 中性身份会丢掉模板的专用处理：只在用户改了协议或地址时才用，界面在协议与地址旁写明“改了以后按通用协议发送”。
  - 品牌图标的商标归各厂商：只用于标识服务商，不改形、不作装饰，开发者知悉。
  - 几百个模型的界面：B6 有耗时预算，超了上虚拟列表。
