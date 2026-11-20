# t43 实施计划（第三稿）：服务商、模型角色与模型选择器的体验改进

第一稿（`f7aba6415`）经三方设计审查后整份重写为第二稿（决定 24）；第二稿经第二轮审查（omp 38 条、Sonnet 前端 14 条）改为本稿。两轮的报告与逐条处理见 [`evidences/design-review-disposition.md`](evidences/design-review-disposition.md)、[`evidences/design-review-r2-disposition.md`](evidences/design-review-r2-disposition.md)。

## Context

开发者 2026-11-20 的 13 条反馈（[README](README.md#开发者的反馈2026-11-20)）经调研与三轮静态稿定为决定 1–17，计划阶段又定了 18–25（[README 的决定](README.md#决定开发者-2026-11-20-会话)）。要解决：

- 服务商分“目录”“自定义”两种：目录的不能发现、不能改协议、不能重复添加；模型解析只认 OMP 打包目录里的 id，不升级依赖拿不到新模型；添加后模型为空。
- 没有代理、协议检测、服务商图标。
- 角色不能设思考档；选择器在档位少于两个时隐藏思考档；选择器的角色卡片占地方、阴影重。

依据：[`models/service.md`](../../../../../docs/specs/models/service.md)、[`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“输入框与待处理区”、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 7、22、[`harness/models.md`](../../../../../docs/specs/harness/models.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`web/tools.md`](../../../../../docs/specs/web/tools.md)；[ADR 0036](../../../../../docs/adr/0036-app-package-installs-omp.md)、[ADR 0045](../../../../../docs/adr/0045-shared-host-packages-for-second-app.md)。取代 t09 决定 11、12（目录与自定义两种服务商）。

工作方式：分三段，**A 推理档与选择器 → B 服务商模板化与模型来源 → C 网络与代理**。每段一条分支、单独实现审查（后端 omp、前端 Claude Sonnet）、单独合入。计划审查：A、C 已审两轮、不再审；**B 开工前把本稿的段 B 单独再审一轮**（第三轮，也是最后一轮）。主会话自己写代码。代码在 Work 的 worktree 上做（`.worktree/w00032-agent-integration` 快进到 master；有别的会话在用时另开 `feat/w00032-t43-<段>`）。Spec 与 Task 记录在主工作区改，随各段合入的同一窗口更新，只写已合入的行为（第二轮 omp 第 37 条）。

## 取舍

1. **模型清单的真相源**：设置里的覆盖与成员记录（手加、来源模型的覆盖、冻结成员），加上状态根里的来源缓存（成员行带物化所需字段），再加上 OMP 的元数据（打包目录与在线目录，按“模板的 provider + 模型 id”查）。同一份设置在两台机器上可能得到不同的清单；这是“不升级也能拿到新模型”的代价。不把目录快照存进设置。
2. **发现与缓存由我方做，OMP 只提供元数据、映射函数与请求传输**：不用 OMP 的 `ModelManager` 与目录工厂（它们按 OMP 自己的 provider 身份做缓存与认证，不认实例改过的地址、认证与协议）。在线目录自己取（ETag、大小上限、`200/304/failed/cancelled`），只复用映射函数。
3. **模型身份与发送前核对**：pi-ai 按 `Model.provider` 走各家专用处理，并会按进程环境变量改写请求地址。规则：实例的协议与地址都跟随模板时 `Model.provider` 用模板的 OMP id；改了协议或地址、或空白模板时用中性身份 `nbook-compatible`。**无论哪种，最内层的 `OmpTarget.fetch` 在发出前核对**：请求的源必须等于实例有效地址的源，且该实例当前的部署身份仍与本次解析相同，否则不发并报 `endpoint-mismatch`（防环境变量改址、防解析后换了地址再读到新密钥）。对外引用是 `<实例 id>/<模型 id>`；`ModelResponse.origin = {provider, api, model, deployment}` 写进会话日志，`deployment` 是实例 id 加有效地址与协议的哈希（不含凭据）；同源还原签名要求整组相同，旧日志没有 `origin` 时按旧规则。不改上游：让 pi-ai 不按 provider 分支要改几十处。
4. **网络出口归属与范围**：出口规则、系统代理读取与按次的 `fetch` 放与应用无关的 `@notnotype/nb-host/network`，`nbook.network` 插件只持有设置项、服务键与页面。不做本机中继（决定 21）。**出口只管选路，不做重定向**：模型请求 `redirect: "error"`，列表与探测 `manual`，网页工具保持现状。

这四条写进新 ADR 0057。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 模型元数据（能力、单价、档位）与在线更新 | `@oh-my-pi/pi-catalog`：打包目录 `getBundledModels`、stencil 目录的映射函数（B1 核对公开名与 zstd 解压）、`buildModel`、`ThinkingConfig` | 已是依赖；否决它的 `ModelManager`、目录工厂与取目录函数（取舍 2，第二轮 omp 第 4 条） |
| 列表请求 | 我方三个适配器；不复用 `fetchOpenAICompatibleModels` | 每种协议几十行，按实例认证与地址发，保留分类证据与窗口 |
| 代理 | Bun 的按次 `proxy`（http、https）与 `proxy: false`（Bun ≥ 1.4.3），最内层总是显式写 | 决定 21；否决本机中继与 `socks` |
| 读操作系统的代理设置 | 各平台调系统命令（Linux `gsettings`、KDE `kioslaverc`，macOS `scutil --proxy`，Windows `reg query`），带超时 | 否决 `os-proxy-config`：Linux 不读桌面设置，Windows 带原生模块 |
| 服务商图标 | `@lobehub/icons-static-svg`（MIT） | 覆盖国内外主要厂商；商标风险写在最后一节 |
| 上传图标 | 经 RPC 上传（客户端用画布缩成 128 像素 PNG，≤ 64 KB），服务端存状态根文件，设置里存引用；校验用 PNG 头解析，不复用只看魔数的 `sniffStillImageType` | 否决设置里存图（RPC 1 MiB 上限）、单独 POST（上传与绑定间无事务，第二轮 omp 第 23、29 条） |

## 段 A：推理档与选择器

### A.1 档位能力（`packages/nb-harness/src/models/reasoning.ts`）

`reasoningOf(model: Model): ReasoningCapability`，快照、内核的 `ModelInfo`、角色页都用它：

```ts
type ReasoningCapability =
    | {kind: "none"}                                   // 不推理
    | {kind: "fixed"}                                  // 会推理但不能调档
    | {kind: "levels"; levels: Effort[]; off: "disable" | "lowest" | "none"; verified: boolean};
```

- `off`：协议策略真能关为 `disable`（界面写“关闭”）；只能降到最低档为 `lowest`（界面写“最低档”，不写“关闭”，第二轮 omp 第 12 条，例：`openai/gpt-5.4` 的“关闭”实发 `reasoning.effort: "low"`）；不能关为 `none`。**A1 第一步先逐协议读 pi-ai 的禁用策略（`openai-shared.ts`、`anthropic.ts`、`google.ts` 与 `compat/resolve.ts`）再定判定表**，结论记 `evidences/a1-reasoning.txt`；不能由 `requiresEffort`、`suppressWhenOff` 单独推出。
- `verified = !thinking.unverified`；决定 6 的“没声明档位的给通用几档”落成 `verified: false` 的档（界面加“?”）；OMP 没物化档位的中性模型当 `fixed` 或 `none`，按 A1 的核对结果。
- 服务端一次解析同时给出 `effectiveEffort`（夹取后的有效档，含 `"off"`）与 `effortSource: "session" | "role" | "model" | null`，经 `ModelInfo` 与会话快照交到浏览器，浏览器不重算夹取（浏览器拿不到内核函数，第二轮前端第 7 条、omp 第 13 条）。

### A.2 角色的思考档与请求档位

- `nb-models/src/config/shapes.ts`：`RoleConfig` 加 `effort?: Effort | "off"`、`icon?: string`。
- 角色的默认档是**一次解析的属性**，不写进按模型缓存的 `ModelInfo`：`resolveRole` 的结果带 `defaultEffort`；直接指名模型时没有。
- 内核 `requestEffort(...)` 的优先级（一份表，计划与验收只有这一份答案）：

| 请求 | 档位来源 |
|---|---|
| 对话（`kernel/run/loop.ts`）、预览（`kernel/session/preview.ts` 与 `kernel/view/request.ts`） | 会话 `core.effort`，否则解析的 `defaultEffort`，否则不发 |
| 就地压缩（`kit/compaction/inplace.ts`） | 沿用本轮对话的解析与档位 |
| 摘要压缩（`kit/compaction/summary.ts`、`kernel/run/model-call.ts`） | 压缩模型自己的解析（压缩角色的 `defaultEffort`），不吃会话档；`ModelDraft.effort` 显式给了就用它 |
| `complete()`（`kernel/session/complete.ts`） | 照对话 |
| 审批草稿（带 `disableReasoning`） | 不套档 |

  `"off"` 只在 `off` 为 `disable` 时映射成 `disableReasoning`，为 `lowest` 时发最低档。子会话照 `agent/subagents.md` 的参数表。
- 会话“跟随”就是 `core.effort === null`；新动作 `thinking.reset` 写 `{effort: null}`。
- 验收断言**线上实际发出的请求体**：可关闭、只能降档、强制推理、`fixed`、未验证档五类各一；`requiresEffort` 为空却只降档、单档却能关闭是两个反例。

### A.3 远程合同与快照（nb-models）

**A2 就把远程合同升到版本 2**，同一提交迁完 `nbook.models/settings` 的调用方并更新 Spec（第二轮 omp 第 28 条）：`setRole` 按字段打补丁——省略不改、`null` 清除、具体值写入，只改档不带 `model`；第一次绑 `fast` 时同步 `compaction` 的规则只在模型由未绑定变为绑定时触发。快照的角色带 `effort`、`icon`，模型带 `reasoning`、`effectiveEffort`、`effortSource`。

### A.4 选择器（`packages/nb-agent-ui/src/vue/composer/AgentRoleModelPicker.vue`）

- 视图类型（`types.ts`）新增字段全部可选，旧宿主（nb-story 的 QaPage、Lab 夹具、`AgentModelPicker`）不改：
  - `ComposerView.effort?: ComposerEffortView`（能力、明确选的档、跟随的有效档与来源、文案）；缺省时按旧的 `thinkingLevels`、`thinking` 推出；
  - `ComposerView.groups?: {id, name, icon?}[]`，`ComposerModelView` 只加 `groupId?`（分组键用服务商 id，不重复带图标）；`ComposerRoleView` 加 `icon?`、`modelIcon?`、`effortLabel?`；
  - 图标在视图里只是键：`ComposerIcon = {kind: "key"; set: "provider" | "role"; key: string} | {kind: "initial"; text: string} | {kind: "class"; name: string}`；Vue 层经宿主注入的**图标解析端口**（`provideAgentView` 旁新增）在渲染时解析，渲染里读 ref 天然被追踪，表晚到时首字母换成图标（第二轮前端第 3 条）；不用 `v-html`；
  - `applyComposerAction` 处理 `thinking.reset`。
- 跟随的档用服务端给的 `effectiveEffort`；来源是角色时写“主力的默认”，直接选模型时写“模型的默认”，模型没有默认档时不画细框。
- 版式照第 3 轮稿：头部两行；角色两列单行项，面板内容宽 < 480px 时单列（容器查询）；思考行窄时拆两行。**档位多于 5 个或面板窄于 400px 时分段里用缩写**，全名放 `title` 与当前档说明（例：“高 · xhigh”）。
- 思考档用 `SegmentedControl` 的 raised 加 inherited（A.5）。**保持 radio 语义**：方向键移动即选中；宿主对写入做 200 毫秒合并（现有滑块已是这个做法），所以不连发；跟随态点细框那一档或用方向键选中都钉成明确选择。旧的两条 dom 用例按新设计改写。
- 模型库：按服务商分组带组图标与个数；超过 30 个的组默认收起；**当前模型所在的大组只展开当前项前后各 10 行加“显示全部 N 个”**，当前项滚动到可见；搜索时只渲染命中项、命中组展开、清空后恢复。键盘规则（落进组件 `.md`）：搜索框按下方向键进入第一个命中行、在第一行按上回到搜索框；组头在方向键序列里，折叠组的行不在序列里，Home/End 作用于整个可见序列；搜索展开的组在清空后收回时，焦点所在行被收起则焦点落到该组头；进入列表的落点是当前模型行；当前模型行带 `aria-current`。`data-model-picker*` 钩子保留，`data-model-picker-thinking` 改挂在分段组上，写进组件 `.md`。

### A.5 nb-ui

- `SegmentedControl`：`variant?: "solid" | "raised"`；`inherited?: boolean`（当前档只画细框，语义不变；点已选项会发出同值 `update:modelValue`）。**不加 `activation`。** `.md` 写明：raised 用于有序档位、不超过 7 档，**不支持 `wrap` 与 `count`**；`aria-describedby` 与 Field 上下文的拼接规则；三个主题（aurora、macos、editorial）× 亮暗的 raised 截图表（`--elevation-raised` 在 editorial 是 none，要核对对比）。
- 投影（决定 10）：`themes/nbook/vars.css` 亮色块的 `--elevation-popover` 写成现在亮色菜单档的字面量；暗色块不动；`src/tokens.css` 不动。实施时把常驻卡片（提示卡、批注卡、向导的浮动形态）亮暗各截一张给开发者确认。

### A.6 图标表（`packages/neuro-book/src/ui/provider-icons/`、`src/ui/role-icons.ts`）

- 服务商图标：键 → `@lobehub/icons-static-svg` 的 SVG（`?url` 资源，动态导入），表项**显式登记 `kind: "mask" | "image"`**（不按文件名推）；构建脚本检查 image 类的 SVG 不含 `currentColor` 与 `#000` 填充，不合格的改选单色变体用 mask；暗色截图一张。加载完成前给首字母方块。放 `src/ui/` 是因为 agent 插件与 models 插件都要用，跨插件运行时导入只许指向对方的 `shared/contracts.ts`。**段 A 表键 = 目录服务商 id**，未登记（含全部自定义服务商）回退首字母；段 B 改按模板键，由对照用例保证 v1 迁移的实例取图结果逐项相同。
- 角色图标：键 → 字面量类名的表（内置五个与自建可挑的十来个），nb-models 只存键。

### A.7 角色页（`plugins/models/web/components/RolesPage.vue`）

角色图标、思考档一列：选项来自绑定模型的 `reasoning`，第一项“跟随模型”；没绑定、`none`、`fixed` 停用并把原因写在框里；未验证档加“?”。已存档位不在新模型的选项里（改绑模型后）时补一个停用项写“当前模型没有这一档，实际用 X”，`none`、`fixed` 时也显示已存档位并给“清除”；绑定的模型未启用时，档的能力取自该模型的 `reasoning`（快照里绑定的模型总在）。自建角色可挑图标。模型下拉加 `data-role-model` 钩子，焦点聚焦用它，不依赖 DOM 顺序。

### A.8 Agent 插件（`plugins/agent/web/plugin.ts`、`session-host.ts`）

构造选择器视图时带角色图标键、`groups`、`effort` 视图；图标解析端口在此注入；`thinking.reset` 写会话设置。

## 段 B：服务商模板化与模型来源

### B.1 模板表（`nb-models/src/config/templates.ts`；合成在 nb-models）

- 我方部分是纯数据：`{id, group, logo?, regions?: Array<{id, label, baseUrl}>, extra?: ...}`。`listTemplates()` 放 **nb-models**（它依赖 nb-harness，不反过来）；nb-harness 只导出 OMP 的基础目录与协议能力查询（第二轮 omp 第 27 条）。
- 每个模板声明：`addable`（有 API Key 或免认证的认证方式，且传输走 `fetch`；登录类、Cursor 这类 HTTP/2 传输、Bedrock 这类签名认证为否并给原因）；`routes`（各协议的对话地址）；`listing: {protocol: "openai" | "anthropic" | "gemini" | "openrouter" | "static"; baseUrl; headers?}` 与 `listingAuth: "required" | "optional"`（OpenRouter 为 `optional`）。用户覆盖协议或地址后，`routes` 与 `listing` 都按覆盖重绑；三种适配器兑现不了的写 `static`，“重新拉取”回 `not-supported`，不猜路径。B1 用 OpenCode Zen、CommandCode、OpenRouter 的真实组合做核对，记 `evidences/b1-probes.txt`；同时核对 stencil 的公开导出与 zstd 解压、会按环境变量改址的 pi-ai 分支。
- **B1 建 `nbook.network` 插件壳**：只声明设置项 `catalogAutoUpdate`（缺省开）与服务键 `networkKey`（先提供直连的 `fetchFor`），C 再加代理项与页面。这样 B 合入时自动更新开关就有拥有者（第二轮 omp 第 33 条）。

### B.2 配置形状 v2（`nb-models/src/config/shapes.ts`）

```ts
type ProviderConfig = {
    id: string;                      // 由名称生成，同模板可多份
    template: string;                // 建后不变；空白模板 blank-openai、blank-anthropic、blank-gemini
    region?: string;
    name: string;                    // 唯一；重名加“ 2”，复制默认“<原名> 副本”
    icon?: {kind: "builtin"; key: string} | {kind: "file"; name: string} | {kind: "initial"};
    api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
    baseUrl?: string;
    apiKeyEnv?: string; auth: "default" | "bearer" | "none"; headers?: Record<string, string>;
    proxy?: {mode: "system" | "custom" | "direct"; url?: string};   // 段 C
    followSource: boolean;           // 服务商新出的模型自动加入
    excluded: string[];              // 用户移出的来源模型
    models: Array<ModelConfig & {origin: "manual" | "source"; frozen?: true}>;
};
```

- **v1 的读法**：schema 每个元素同时接受新旧形状；按 v1 的运行时语义归一：目录服务商的旧 `api` 不是覆盖，旧 `baseUrl` 是覆盖，`followSource: false`，条目 `origin: "source"`；**v1 目录条目只认旧运行时认的字段**（`enabled`、`name`、`price` 等，B2 读 `target.ts` 逐项列出），其它字段原样保留但不参与，用户在界面里改才写成显式覆盖（第二轮 omp 第 10 条）；自定义服务商映射到对应的空白模板，条目 `origin: "manual"`。补丁的 `expect` 用磁盘上的原值算，冲突后重读重新归一再合并。
- **写前核对**：首写前查设置服务的 `problems`：该键存在但被 schema 拒绝时拒绝写入并提示去设置编辑器修，不当成空数组覆盖；真没有键才创建（第二轮 omp 第 32 条）。
- **关掉自动加入**：只给此刻有效、还没有条目的成员补 `{id, origin: "source", enabled, frozen: true}`，已有条目原样不动。重新打开时只删仍带 `frozen` 且无其它覆盖的条目；用户改过的条目去掉 `frozen`。冻结后设置文本超过 768 KiB 时拒绝冻结并说明。
- **来历决定解析**：手加的不看来源，缺上下文窗口照旧不能启用。来源模型取值顺序：缓存里的成员行（含物化字段）→ 跟随模板的打包目录 → 报 `source-unavailable`。来源模型从成功的完整列表里消失时，成员行标 `missing` 并保留，被启用或被角色引用的继续可调用，用户在界面上移除；用户移出（`excluded`）照现行输出 15 解除角色绑定。

### B.3 模型来源（`nb-harness/src/models/sources/`）

- `listing.ts`：三种列表协议的适配器加 OpenRouter 的变体，按实例的**有效**协议、地址、认证（`requestAuth`、`resolveHeaders`）发 `GET`，`redirect: "manual"`；`listingAuth: "optional"` 时有密钥就带、没有就匿名。每行交回 `{id, name?, kind: "chat" | "other" | "unknown", evidence, meta?}`：Gemini 看 `supportedGenerationMethods` 只作路由证据（打包目录里已知非对话的先排除，如图像模型），列表自带的 `inputTokenLimit`、`outputTokenLimit` 与 OpenRouter 的 `context_length` 进 `meta`；OpenAI 兼容按（模板 provider，id）到目录里查，查不到为 `unknown`。既不在目录又没有窗口的新对话模型标“需补字段”，不启用。失败按 `no-credentials`、`auth`、`not-found`、`unreachable`、`bad-response`、`proxy-unsupported` 分类。**完整性**：只有声明到末页且每页有效才发布；重复游标、超页数、超字节都算失败，不截断；整次（含全部分页）总截止 15 秒，小于宿主排空上限。
- `unknown` 的处理：本机自托管与空白模板里 `unknown` 默认启用（id 含 `embed`、`rerank`、`whisper` 的除外）；云服务商模板的 `unknown` 不自动启用，在“管理模型”里可一键启用；界面写明规则。
- `cache.ts`：每个实例一份 `<状态根>/agent/model-sources/<实例 id>.json`：`{identity, lastAttemptAt, lastSuccessAt, members}`。`identity` 是**规范化后的有效列表请求**（地址、列表协议、认证方式、凭据值、有效请求头的名与值）用状态根里随机密钥（`<状态根>/agent/model-sources/.key`，0600）做的 HMAC，不落原文；身份变了旧缓存不用。成功的完整空表也是权威成员。成员行带物化字段与 `missing`。写入暂存同目录再原子替换，提交时校验代次；删实例时删文件。
- `catalog.ts`：在线目录（stencil）自己取：大小上限、ETag、`200/304/failed/cancelled`，缓存 `<状态根>/agent/catalog/stencil.json`（ETag、最近尝试与最近成功分开记），随停止中止；元数据按（模板的 OMP provider，模型 id）查，在线优先、打包兜底，**只对跟随模板的实例**；缺价格保持 `null`；空白模板与改了协议或地址的实例只用来源列表自带字段加用户填写。
- `coordinator.ts`：核心按有效设置与凭据的变化统一协调来源，不只挂在远程方法上。每个实例一个配置代次：身份变了取消旧代次的在途请求，结果只在代次仍是当前时提交；同一身份的在途请求合并；手动“重新拉取”强制更新。网络等待不占设置写队列，提交经串行队列、一次清解析缓存并发 `changed`。自动更新开着时：启动先用缓存，过期（24 小时）的后台更新；关着时只在添加、填完密钥、“重新拉取”“现在更新”时请求。
- 停止：插件停止时先让当前代次不可提交、取消在途请求，限时等收尾，再关缓存句柄；手动刷新有总截止，不会拖过宿主排空；B3 夹具覆盖“响应体不结束时停止”。

### B.4 解析与模型身份（`nb-harness/src/models/target.ts`、`kernel/model/omp.ts`）

- 物化：元数据加实例覆盖经 `buildModel`；`Model.provider` 按取舍 3；中性身份时只带本次协议需要的字段，不带旧协议的 `compat` 与专用头。
- `OmpTarget` 加 `name`（公开引用）与 `fetch`（取舍 3 的发送前核对；免认证时剥掉哨兵值的 `Authorization`、`x-api-key`、`x-goog-api-key`；`redirect: "error"`；选路失败记进本次调用的槽，`ompCall` 在适配器报通用错误后优先交出）；`ompCall` 的模型名用 `name`；`ModelResponse` 加 `origin`；`toContext` 有 `origin` 时按整组判断同源。会话日志加字段按 nb-session 的兼容规则（新增可选字段）。
- 验收：模板跟随且环境变量（`MOONSHOT_BASE_URL` 等）设着时实收地址仍是配置的；解析后换地址与密钥再发送被拒；Gemini 免认证实收头不含哨兵。

### B.5 服务核心与合同（`nb-models/src/core/`、`contract/`）

- **远程合同升到版本 3**，补丁一律“省略不改、`null` 清除”：
  - `templates()`（取代 `catalogProviders`）；`addProvider({template, region?, name?, baseUrl?, api?})`：空白模板必须带名称与地址；新建前清掉同 id 的遗留密钥。
  - `duplicateProvider(id)`：复制配置；凭据只复制有效的方式（`apiKeyEnv` 复制引用，库里的密钥复制一行）；第二步失败回 `partially-applied` 带副本 id 与实际密钥状态。
  - `providerModels(provider, {query?, offset, limit})`（管理页分页）；`enabledModels({offset, limit})`（选用数据分页，含被角色或 Profile 引用的未启用模型并带标记）；`refreshModels(provider)`、`refreshCatalog()`。
  - `detectApi({provider, model?})`：只用已保存的配置，取消信号放 RPC 调用选项；见 B.6。
  - `checkAll({provider, ids})`：名单去重，单次最多 100 个（界面分批）；全局并发 4（不按实例）；单次总截止；每条失败原文遮盖后截 512 字符；取消后不再领新项，已发出未结算的标“未知”。
  - `setIcon(provider, {kind: "upload", png: bytes} | builtin | initial | null)`：校验 PNG 头（≤ 256 × 256、拒绝含 `acTL` 的动图、≤ 64 KB），写文件再改设置，设置写失败删文件；文件按“是否仍被任一服务商引用”回收。`updateProvider` 收 `region`、`api`、`baseUrl`、`proxy`、`followSource`、`name`。
- 快照：服务商带模板、地区、图标、代理、来源状态、模型数与启用数；角色同段 A；**不带模型行，只带 `modelsRevision`**。网页数据模块里一份“选用数据”由 `enabledModels` 读全、按版本失效，选择器、角色页、Profile 页（`findModel`）、agent 标签（`roleOptions.labels`）、models-store 的 `apply` 与 `checkAll` 共用；管理页按“服务商、查询、页”缓存。B6 列出现有 21 处 `provider.models` 读取点逐处迁移。
- 检测（`check`）改用 B.6 的探测，满足 Spec 输出 11 的“不带推理”。

### B.6 协议检测（`nb-harness/src/models/probe.ts`）

专门的探测请求：不经 `ompCall`（它的流恢复会重试、Anthropic 会落盘）；每种协议走**与对话同一路径与认证**（Chat Completions、Responses、Anthropic Messages、Gemini `streamGenerateContent`），用各自的输出上限字段，不带推理参数，读到第一个有效事件即取消；每种协议恰好一次 HTTP、不重试、不写文件，四种并行，整次 15 秒、可取消。参数被拒的 4xx 原文显示，不判“协议不支持”；“可用”的含义是首事件正常。模型 id 依次取：调用方给的、第一个启用的、来源列表里的第一个对话模型；都没有时界面要求填一个。结果带规范化地址、所用模型、配置版本、`{ok, status, ms, message}`（原文遮盖、截断）。界面里改了地址要先保存再检测（有未保存修改时检测按钮停用并说明）；“用这个”写入协议时 `expect` 同时核对检测时的地址、协议与凭据身份。

### B.7 图标（`plugins/models/backend/icons.ts`）

图标文件存 `<状态根>/agent/provider-icons/<sha256>.png`，配置存 `{kind: "file", name}`；读取走 `GET /api/nbook.models/icons/<name>`（照 bots 头像的路由：逐段不跟链接、`nosniff`、跨站拒绝、ETag）。上传只经 `setIcon`（B.5）。

### B.8 设置页（`plugins/models/web/`）

- 添加对话框：分组多列；空白模板与有地区的模板进第二步（名称、地址、协议，或地区），校验同现状；“已添加”写进可访问名称，不停用；登录组默认收起，服务端同样拒绝。
- 服务商详情：标题区图标弹出（内置只列模板用到的、上传——客户端画布缩成 128 像素 PNG、首字母、恢复模板的）、名称就地改、“复制一份”；删除仍在列表条目上（决定 19）。协议下拉第一项“按模型（跟随模板）”；“检测协议”就地列结果；“恢复模板地址”。代理字段在段 C 加。
- 模型区：搜索框、系列默认收起（有搜索时展开命中组）、“重新拉取”、个数与来源状态、“服务商新出的模型自动加入”开关；`missing` 的行写“服务商已不再提供”与移除按钮；“需补字段”的行说明缺什么。“检测全部”超过 20 个先确认个数。
- 管理模型：列来源的全部模型（`unknown` 单独一组）、可“重新拉取”；全部模型页加搜索与按服务商收起。
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
    describe(target?: URL): Promise<EgressSummary>;   // 脱敏：{mode, origin?, hasCredentials, source, route: "proxy" | "bypassed" | "direct", unsupported?, error?}
    test(override?: ProviderProxy, signal?: AbortSignal): Promise<EgressTestResult>;
};
```

- 按次选路得到互斥的三种结果：代理（写 `proxy: <url>`）、直连（写 `proxy: false`）、错误（抛类型化的 `proxy-unsupported` 等，不发请求）。**最内层总是显式写 `init.proxy`**，盖过 pi-ai 的 `PI_PROXY` 与进程环境（第二轮 omp 第 36 条）。本机与私网地址直连（主机串判定，IPv4 映射的 IPv6 也算；不做 DNS 解析，写进 Spec 的已知行为）；`custom` 写代理（只收 http、https，带用户名密码的原位拒绝）；`system` 按目标协议取规则：启动环境的 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY` 与 `NO_PROXY`，再取操作系统设置（各平台命令，超时 2 秒，缓存 60 秒）；系统给的是 SOCKS 或 PAC 时报 `proxy-unsupported`（不悄悄直连）；读失败与“没有设代理”区分。服务商的 `proxy` 覆盖应用的。
- **不做重定向**：出口不跟随、不改写 `redirect`，由调用方决定（取舍 4）。
- 环境的 `NO_PROXY` 会让 Bun 绕过显式代理：`system` 模式本来就按它选路；`custom` 模式下 `describe(target)` 自己按 `NO_PROXY` 判断并返回 `route: "bypassed"`，写进 Spec 的已知行为。
- `test()` 的目标固定为 Cloudflare 的 `https://www.cloudflare.com/cdn-cgi/trace`（小响应、含出口 IP；写进 Spec 的外联清单）；路由为 `bypassed` 或本机时界面写“该目标没有走代理”，不报“代理正常”。
- Bun 门槛抬到 `>=1.4.3`：改 `packages/neuro-book/package.json`、`src/shared/product.ts` 的 `BUN_ENGINE`、`scripts/pack-app.ts`、桌面随包的 Bun 版本；C1 验收各入口（CLI 启动检查、托管入口、桌面）拒绝旧版（第二轮 omp 第 18 条）。

### C.2 `nbook.network` 插件（`packages/neuro-book/src/plugins/network/`）

- 设置项（都只允许用户层）：`proxyMode`（缺省 `system`）、`proxyUrl`；`catalogAutoUpdate` 已在 B1 声明。设置分区 `nbook.network`（分类 app，排“外观”之后，page 分区）。
- 服务键 `networkKey`：`fetchFor(override?)`、`describe(target?)`；远程合同 `nbook.network/settings`：`describe()`、`test()`。
- 入口依赖：`nbook.models` 后端 → `networkKey`；`nbook.web-tools` 后端 → `networkKey`（决定 22，`plugin.ts` 把全局 `fetch` 换成 `fetchFor()`，3xx 仍按原合同 `failed`）；网络页 → `nbook.models` 的远程合同。入口级不成环，`architecture.test.ts` 守住。`proxy-unsupported` 经各入口映射：模型（选路失败槽）、列表（失败类别）、探测、网页工具（`unreachable` 之外加原因）。
- 网络页：“代理方式”“代理地址”用 `SettingsRow`（新增具名插槽 `below` 放行下信息，写进 `SettingsRow.md`）；“测试代理”“现在更新”用新的 `src/ui/settings/SettingsActionRow`（标题、说明、右端动作、行下状态 `aria-live="polite"`，保留与 `SettingsRow` 一致的右侧 24px 一格）。状态集：设置读不到、`describe()` 失败或超时、测试进行中可取消、离开页面取消。代理地址的说明去掉“可以带用户名和密码”。
- 模型服务：各请求点用 `fetchFor(provider.proxy)`（`OmpTarget.fetch`、列表请求、检测、探测）；在线目录用 `fetchFor()`。服务商详情的“高级”里加代理。

## Spec 与文档改动

| 文件 | 段 | 改什么 |
|---|---|---|
| `docs/adr/0057-…md`（新） | A 前 | “取舍”四条与决定 1 |
| `harness/models.md`、`harness/runtime.md` | A、B | `ReasoningCapability` 与 `off`；优先级表与五处请求；`defaultEffort`、`effectiveEffort`；`OmpTarget.name`、`fetch` 与发送前核对；`ModelResponse.origin` 与同源判断 |
| `models/service.md` | A、B、C | 术语（模板、实例、来源、来历）；输入形状 v2 与 v1 读法、降级后果（决定 23，A 与 B 各写触发字段与最早不能退回的版本）；输出 5、7、8、9、11、12、13、15 改；新增：模型来源与在线目录、跟随与冻结、协议检测、复制、图标、角色思考档；非目标去掉“代理设置” |
| `models/settings-pages.md` | A、B、C | 输出 1、2、3、4、6、7、8、9、10、11、13 改；新增标题区、检测、来源状态、代理字段 |
| `network/egress.md`（新，planned，C 验收后写实现入口与证据） | C | 设置项、选路规则、系统代理读法与来源、测试与外联清单、已知行为（`NO_PROXY`、不做 DNS、SOCKS 拒收、不跟随 3xx）；网络页 |
| `web/tools.md` | C | 请求经网络出口 |
| `ui/agent-conversation-view.md` | A | 选择器：两列与单列、图标、思考档的状态与跟随、模型库分组与键盘 |
| `agent/conversation.md` | A | 输出 7、22：跟随与“用 X 的默认” |
| nb-ui `SegmentedControl.md`、`SettingsRow.md`、`docs/specs/theme/system.md` | A、C | raised、inherited；`below` 插槽；nbook 亮色气泡档 |
| 应用 `CHANGELOG.md`「数据与升级」 | A、B | 角色设置与服务商设置的降级后果（决定 23） |

## 切片

每片一个或几个提交，片内自跑所列验证；每段结束开实现审查、处理、合入，Task README 记进度。开工前把“验证”里列的每个 e2e 文件在起点上各跑一遍记基线。

**段 A**
- A1 ADR 0057；先核对协议的禁用策略定判定表；`reasoningOf`、`effectiveEffort`、`requestEffort` 及各处请求（含 `preview.ts`）（nb-harness）。验证：nb-harness 相关单元测试，线上请求体断言五类加两个反例。
- A2 角色 `effort`、`icon`、`setRole` 字段补丁、合同升版本 2、调用方迁移（nb-models、models 插件）；更新兼容节与 `CHANGELOG`。验证：nb-models、`models.test.ts`，A 前后合同的版本拒绝用例。
- A3 nb-ui：`SegmentedControl` 的 `variant`、`inherited`；nbook 亮色投影；`SettingsRow` 不动。验证：nb-ui 单元与 dom 测试、Lab 场景、三主题 × 亮暗截图表；常驻卡片亮暗截图交开发者。
- A4 图标表与角色图标表（`src/ui/`）、图标解析端口。验证：表键 = 目录服务商 id 都取得到、未登记回退首字母、image 类无 `currentColor` 的脚本检查、表晚到时首字母换图标（dom 测试）、暗色彩色图标截图一张。
- A5 选择器与 agent 宿主。验证：`AgentRoleModelPicker`、`AgentConversationComposer` dom 测试（340px 无溢出、7 档 × 英文 × 340px、跟随与明确的切换、587 个的组默认视图节点数与只渲染命中项的节点计数并做变异检查、键盘三条用例）、`session-host` 测试。Lab 新增场景：能力四态 × 跟随/明确、587 项大组、340px、暗色与彩色图标、英文。
- A6 角色页。验证：`RolesPage` dom 测试、`pages-focus.dom.test.ts`（有图标与档位控件时焦点仍落在模型下拉）。
- A7 段 A 收口：e2e、实现审查、合入；会话入口的真实模型 smoke 经开发者授权才跑，否则记“未验证”。

**段 B**（开工前先审本稿的段 B）
- B1 模板表与能力（`routes`、`listing`、`listingAuth`）；`nbook.network` 插件壳；核对 stencil 的公开导出与 zstd、会按环境变量改址的 pi-ai 分支、三个混合协议模板，结论记 `evidences/b1-probes.txt`。
- B2 配置 v2 与 v1 读法、写前核对、冻结与解冻（用真实设置场地喂 v1 文件做对照：首写前的外部编辑、坏条目、v1 里被旧运行时忽略的字段、只含 `enabled: false` 的条目往返）。
- B3 来源：列表适配器、缓存（HMAC 身份、原子写）、在线目录、协调器、停止顺序。验证：本机假端点（OpenAI 兼容、Anthropic、Gemini、OpenRouter 的模态字段与匿名、分页中途 503 与重复游标、401、404、503、空表、响应体不结束时停止），断言实收的地址与认证头、身份变化（含自定义请求头）不读旧缓存、成功空表的权威性、代次丢弃、写入中断、删除后同名重建。
- B4 解析、模型身份、发送前核对、日志 `origin`。验证见 B.4。
- B5 核心与合同 v3（添加、复制、分页取模型、刷新、检测全部、图标）与探测请求。验证：nb-models core、`models.test.ts`（各协议探测实收恰好一次且是首事件、取消、采纳的 `expect`、批量去重与总预算、复制的部分成功）。
- B6 设置页与“选用数据”模块，21 处读取点逐处迁移。验证：各组件 dom 测试、`models-store.test.ts`、Profile 页夹具同步；Lab 的 fake-remote 随合同 v3 重写，新增场景：来源失败、600 个模型、检测协议结果、地区、390 宽英文；600 个模型打开详情首屏 < 300 ms、搜索一次 < 100 ms（happy-dom），超了上虚拟列表。
- B7 段 B 收口：8 家 × 600 个的最大输入下快照、`enabledModels` 分页与设置全文的 UTF-8 线字节；e2e、实现审查、合入；更新兼容节与 `CHANGELOG`；真实模型 smoke 经授权才跑。

**段 C**
- C1 `nb-host/network`：选路、系统代理的各平台解析（喂样本输出）、Bun 门槛。验证：本机真实 HTTP 代理与两个目标端点，断言实收线路与头、直连盖过 `HTTPS_PROXY`、`PI_PROXY` 设着时仍直连、`NO_PROXY` 命中时 `describe` 返回旁路、SOCKS 与 PAC 样本经模型、列表、探测、网页工具都得到带原因的失败且没有连接。
- C2 `nbook.network` 的代理项与服务、网页工具与模型服务接入、服务商代理字段。验证：插件测试、`models.test.ts` 一轮对话走本机代理、web-tools 测试。
- C3 网络页与 `SettingsActionRow`、`SettingsRow` 的 `below` 插槽。验证：dom 测试（含状态集）、Lab。
- C4 段 C 收口：Windows 的系统代理在 pc-notype 上实测（macOS 标未验证），e2e、实现审查、合入；`network/egress.md` 写实现入口与证据。

## 验收映射

改完 Spec 后按编号补全；下面是要新增的覆盖。

| 行为 | 覆盖 |
|---|---|
| 五类档位能力的实际请求体；会话、角色、模型默认的优先级表；审批不套档；摘要压缩用压缩角色的档 | nb-harness 内核测试（本机假端点读请求体） |
| 只改角色档不动绑定；两窗口交错改模型与档；A 前后合同版本 | nb-models core、`models.test.ts` |
| 选择器：跟随与明确切换、方向键即选中、340px 无溢出、单列退让、大组展开当前项附近、只渲染命中项（变异）、键盘与读屏、表晚到 | `AgentRoleModelPicker.dom.test.ts`、`AgentConversationComposer.dom.test.ts` |
| v1 设置读进来行为不变；首写前外部编辑；坏条目拒写；冻结往返 | `settings-store.test.ts`、`models.test.ts` |
| 来源消失时被引用的仍可调用；`unknown` 与“需补字段”的启用规则 | `models.test.ts` |
| 列表请求的地址与认证、分类、分页完整性、身份（含请求头）变化、代次、停止 | nb-harness `sources` 测试 |
| 同模板两家的多轮签名；环境变量不改写地址；解析后换地址被拒；哨兵头 | nb-harness `omp` 测试 |
| 探测每种协议实收一次且是首事件、取消、采纳 | `models.test.ts` |
| 批量检测去重、总预算、字节上限 | `models.test.ts` |
| 选路、系统代理解析、SOCKS 与 PAC 拒绝、`NO_PROXY` 旁路、脱敏 | nb-host `network` 测试 |
| 设置页各交互、空白模板第二步、同名、检测结果失效、窄与英文 | 组件 dom 测试、`e2e/models.e2e.ts` |
| 网络页 | dom 测试、`e2e/settings.e2e.ts` |
| `data-model-picker*` 钩子仍在 | `e2e/agent-conversation.e2e.ts` |

## 验证

- 每段合入前的 e2e：A 段 `agent-conversation`、`lab-agent-ui`、`models`、`lab-scenes`；B 段 `models`、`settings`、`agent-conversation`；C 段 `settings`、`models`。已知的原有失败（`lab-scenes` 的 ThemeEditor 404 四条、`workbench-views:754` 等，见 Agent 记忆）先对照，不算本段。实施中只重跑改到的文件。
- 每段收口跑 `docs:check` 与受影响包的 `--typecheck`；本机合同测试必跑，真实模型 smoke 经开发者授权才跑，写明包与文件，没有授权或凭据记“未验证”。
- 未验证边界：macOS 的系统代理读法；需要登录的服务商（不在范围）。

## 不做与风险

- 不做：OAuth 登录；Magpie 的粘贴 curl、余额探测、导入别的应用；抓站点图标；SOCKS5 与 PAC（决定 21）；装回旧版的保护（决定 23）；出口里的重定向。
- 风险：
  - 我方三个列表适配器要跟上各家接口的变化：只用各协议公开的列表接口，失败按类别报告、沿用上一次；新增服务商的特殊列表另加适配器。
  - 中性身份会丢掉模板的专用处理：只在用户改了协议或地址时才用，界面在协议与地址旁写明“改了以后按通用协议发送”。
  - 服务商对模型请求返回 3xx 时报错：用户要把地址改成最终地址（Spec 与错误文案写明）。
  - “测试代理”会向 Cloudflare 暴露出口 IP：只在用户点击时发生，写进外联清单。
  - 品牌图标的商标归各厂商：只用于标识服务商，不改形、不作装饰，开发者知悉。
  - 几百个模型的界面：B6 有耗时预算，超了上虚拟列表。
