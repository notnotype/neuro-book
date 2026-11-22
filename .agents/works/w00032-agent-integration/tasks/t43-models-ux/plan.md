# t43 实施计划（第四稿）：服务商、模型角色与模型选择器的体验改进

第一稿（`f7aba6415`）经三方设计审查后整份重写为第二稿（决定 24）；第二稿经第二轮审查（omp 38 条、Sonnet 前端 14 条）改为第三稿；第三稿的段 B 经第三轮审查（47 条）后拆成 B1 与 B2，改为本稿。三轮的报告与逐条处理见 [`evidences/design-review-disposition.md`](evidences/design-review-disposition.md)、[`evidences/design-review-r2-disposition.md`](evidences/design-review-r2-disposition.md)、[`evidences/design-review-r3-disposition.md`](evidences/design-review-r3-disposition.md)。

## Context

开发者 2026-11-20 的 13 条反馈（[README](README.md#开发者的反馈2026-11-20)）经调研与三轮静态稿定为决定 1–17，计划阶段又定了 18–25（[README 的决定](README.md#决定开发者-2026-11-20-会话)）。要解决：

- 服务商分“目录”“自定义”两种：目录的不能发现、不能改协议、不能重复添加；模型解析只认 OMP 打包目录里的 id，不升级依赖拿不到新模型；添加后模型为空。
- 没有代理、协议检测、服务商图标。
- 角色不能设思考档；选择器在档位少于两个时隐藏思考档；选择器的角色卡片占地方、阴影重。

依据：[`models/service.md`](../../../../../docs/specs/models/service.md)、[`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“输入框与待处理区”、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 7、22、[`harness/models.md`](../../../../../docs/specs/harness/models.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`web/tools.md`](../../../../../docs/specs/web/tools.md)；[ADR 0036](../../../../../docs/adr/0036-app-package-installs-omp.md)、[ADR 0045](../../../../../docs/adr/0045-shared-host-packages-for-second-app.md)。取代 t09 决定 11、12（目录与自定义两种服务商）。

工作方式：分五段，**A 推理档与选择器（已合入）→ B1 模板与身份（已合入）→ B2a 模型来源（已合入）→ B2b 协议检测（已合入）→ C 网络与代理**。每段一条分支、单独实现审查（后端 omp、前端 Claude Sonnet）、单独合入。计划审查：A、C 已审两轮，B 已审三轮（上限）；**不再开第四轮**，B2 开工前对照 B1 的实际形状微调本稿，靠实现审查兜底（决定 26）。主会话自己写代码。代码在 Work 的 worktree 上做（`.worktree/w00032-agent-integration` 快进到 master；有别的会话在用时另开 `feat/w00032-t43-<段>`）。Spec 与 Task 记录在主工作区改，随各段合入的同一窗口更新，只写已合入的行为（第二轮 omp 第 37 条）。

## 取舍

1. **模型清单的真相源**：设置里的覆盖与成员记录（手加、来源模型的覆盖、冻结成员），加上状态根里的来源缓存（成员行带物化所需字段），再加上 OMP 的元数据（打包目录与在线目录，按“模板的 provider + 模型 id”查）。同一份设置在两台机器上可能得到不同的清单；这是“不升级也能拿到新模型”的代价。不把目录快照存进设置。
2. **发现与缓存由我方做，OMP 只提供元数据、映射函数与请求传输**：不用 OMP 的 `ModelManager` 与目录工厂（它们按 OMP 自己的 provider 身份做缓存与认证，不认实例改过的地址、认证与协议）。在线目录自己取（ETag、大小上限、`200/304/failed/cancelled`），只复用映射函数。
3. **模型身份与发送前核对**：pi-ai 按 `Model.provider` 走各家专用处理，并会按进程环境变量改写请求地址。规则：实例的协议与地址都跟随模板时 `Model.provider` 用模板的 OMP id；改了协议或地址、或空白模板时用中性身份 `nbook-compatible`。**无论哪种，最内层的 `OmpTarget.fetch` 在发出前核对**：规范化后的完整线请求地址（含路径）必须等于实例有效地址按协议拼出的地址，且该实例当前的 `uid`、地址、协议与认证方式仍与本次解析相同，否则不发并报 `endpoint-mismatch`（防环境变量改址或改路径、防解析后换了地址再读到新密钥）。对外引用是 `<实例 id>/<模型 id>`；实例另有创建时生成、永不复用的随机 `uid`。`ModelResponse.origin = {provider, api, model, deployment, credential?}` 作为可选字段写进会话日志，`deployment` 是 `uid` 加有效地址与协议的哈希，签名型协议另带凭据值的 HMAC（不含原文）；同源还原签名要求整组相同，旧日志没有 `origin` 时按旧的实例 id 映射判断。不改上游：让 pi-ai 不按 provider 分支要改几十处。
4. **网络出口归属与范围**：出口规则、系统代理读取与按次的 `fetch` 放与应用无关的 `@notnotype/nb-host/network`，`nbook.network` 插件只持有设置项、服务键与页面。不做本机中继（决定 21）。**出口只管选路，不做重定向**：模型请求 `redirect: "error"`，列表与探测 `manual`，网页工具保持现状。

这四条写进新 ADR 0057。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 模型元数据（能力、单价、档位）与在线更新 | `@oh-my-pi/pi-catalog`：打包目录 `getBundledModels`、stencil 目录的映射函数（B1 核对公开名与 zstd 解压）、`buildModel`、`ThinkingConfig` | 已是依赖；否决它的 `ModelManager`、目录工厂与取目录函数（取舍 2，第二轮 omp 第 4 条） |
| 列表请求 | 我方三个适配器；不复用 `fetchOpenAICompatibleModels` | 每种协议几十行，按实例认证与地址发，保留分类证据与窗口 |
| 代理 | Bun 的按次 `proxy`（http、https）与 `proxy: false`（Bun ≥ 1.4.3；应用最低版本在 B1 提到 1.4.4），最内层总是显式写 | 决定 21；否决本机中继与 `socks` |
| 读操作系统的代理设置 | 各平台调系统命令（Linux `gsettings`、KDE `kioslaverc`，macOS `scutil --proxy`，Windows `reg query`），带超时 | 否决 `os-proxy-config`：Linux 不读桌面设置，Windows 带原生模块 |
| 服务商图标 | `@lobehub/icons-static-svg`（MIT） | 覆盖国内外主要厂商；商标风险写在最后一节 |
| 上传图标 | 经 RPC 上传（客户端用画布缩成 128 像素 PNG，≤ 64 KB，base64 字符串），服务端存状态根文件，设置里存引用；校验用 PNG 头解析，不复用只看魔数的 `sniffStillImageType` | 否决设置里存图（RPC 1 MiB 上限）、单独 POST（上传与绑定间无事务，第二轮 omp 第 23、29 条） |

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

## 段 B1：模板与身份

段 B 在第三轮审查（[处理](evidences/design-review-r3-disposition.md)）后拆成 B1 与 B2（决定 26）。B1 先把“服务商都是模板的实例”、身份与出站核对、v1 迁移、图标、添加与标题区、选用数据模块做完；**模型清单暂时只用打包目录**（模板跟随的实例，成员是打包目录里该模板 provider 的对话模型，添加即全部加入、可移出；空白模板没有成员，手动添加）。在线列表、缓存、在线目录、自动更新、协议检测、模型区的来源状态都在 B2。

### B1.1 模板表与能力（`nb-models/src/config/templates.ts`）

- 我方部分是纯数据：`{id, group, logo?, regions?: Array<{id, label, baseUrl}>, extra?: ...}`；`listTemplates()` 在 **nb-models**（它依赖 nb-harness，不反过来）；nb-harness 只导出 OMP 的基础目录与协议能力查询。`templates()` 给每个模板带 `modelCount`（打包目录里该 provider 的对话模型数）与地区标签，添加对话框直接用。
- 每个模板声明 `addable`（有 API Key 或免认证、且传输走 `fetch`；登录类、Cursor 这类 HTTP/2 传输、Bedrock 这类签名认证为否并给原因）与 `routes`（各协议的对话地址）。B2 再加 `listing`、`listingAuth`。
- **传输准入在服务端、按模型**：解析时按该模型实际的传输判断，不按“模板能不能加”；非 fetch 传输的模型不解析，报 `transport-unsupported`（带原因）。v1 里已存的 Cursor、Bedrock、Codex 这类配置原样保留、不可发送，发布说明写明（决定 23 一类的取舍）。
- **B1 建 `nbook.network` 插件壳**：只声明服务键 `networkKey`（先提供直连的 `fetchFor`）；`catalogAutoUpdate` 设置项到 B2 再加。**应用的最低 Bun 版本在 B1 提到 1.4.4**（CLI、服务入口与发布产物检查一起；1.4.3 起有按次 `proxy: false`），发布说明写明：设了环境代理的用户，模型请求在段 C 提供代理设置之前走直连（决定 29）。
- B1 的核对（记 `evidences/b1-probes.txt`）：stencil 的公开导出、zstd 解压与自报档位原文、会按环境变量改址的 pi-ai 分支、OpenRouter 的线协议、OpenCode Zen、CommandCode、三个混合协议模板的真实组合；**协议检测用库自己的请求构造的做法**（B2 用，小实验：抓第一个请求后中止、确认恰好一次 HTTP 且不重试）。

### B1.2 配置形状 v2（`nb-models/src/config/shapes.ts`）

```ts
type ProviderConfig = {
    id: string;                      // 由名称生成，同模板可多份；展示与引用用
    uid: string;                     // 创建时生成的随机 128 位，永不复用；会话日志里的部署身份与（B2）缓存的有效性只认它
    template: string;                // 建后不变；空白模板 blank-openai、blank-anthropic、blank-gemini
    region?: string;
    name: string;                    // 创建与复制重名时加“ 2”；改名重名报错，不自动加
    icon?: {kind: "builtin"; key: string} | {kind: "file"; name: string} | {kind: "initial"};
    api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
    baseUrl?: string;
    apiKeyEnv?: string; auth: "default" | "bearer" | "none"; headers?: Record<string, string>;
    followSource: boolean;           // 服务商新出的模型自动加入（B1：打包目录里新增的；B2：来源里新出的）
    excluded: string[];              // 用户移出的来源模型
    models: Array<ModelConfig & {origin: "manual" | "source"; frozen?: true}>;
};   // 不含 proxy：段 C 再加
```

- **v1 的读法**：schema 每个元素同时接受新旧形状；按 v1 的运行时语义归一：目录服务商的旧 `api` 不是覆盖，旧 `baseUrl` 是覆盖，`followSource: false`，条目 `origin: "source"`；**v1 目录条目只认旧运行时认的字段**（`enabled`、`name`、`price` 等，B2 读 `target.ts` 逐项列出）；旧运行时本来忽略的字段（`vision`、`contextWindow` 等写在目录条目上的）**在首次 v2 写入时丢弃**，Spec 与发布说明写明，不再说“原样保留”；自定义服务商映射到对应的空白模板，条目 `origin: "manual"`；v1 行没有 `uid`，首次 v2 写入时补。补丁的 `expect` 用磁盘上的原值算，冲突后重读重新归一再合并。
- **元数据查找按“同模板且同协议”**：v1 目录服务商只覆盖了地址，仍用打包目录的元数据（旧运行时就是这样），不因地址覆盖就切断；地址与协议是否“跟随模板”只决定 `Model.provider` 身份（B1.3），不决定元数据。
- **写前核对**：首写前查设置服务的 `problems`：该键存在但被 schema 拒绝时拒绝写入并提示去设置编辑器修，不当成空数组覆盖；真没有键才创建。预检与锁内写之间用户恰好存了坏值的窗口，要彻底堵需改设置拥有者的 CAS，在 B 之外：**接受取舍、写进已知限制**（第三轮后端第 2 条）。
- **冻结与帧预算**：关掉自动加入时，只给此刻有效、还没有条目的成员补 `{id, origin: "source", enabled, frozen: true}`，已有条目原样不动；重新打开时只删仍带 `frozen` 且无其它覆盖的条目，用户改过的去掉 `frozen`。**所有新增写按“设置全文经 JSON 转义后的帧字节”核对**（不按磁盘字节），超 768 KiB 拒绝并说明。
- **来历决定解析**：手加的不看来源，缺上下文窗口照旧不能启用。来源模型取值：打包目录（B1）；B2 加缓存的成员行与 `pinned` 行。用户移出（`excluded`）照现行输出 15 解除角色绑定。

### B1.3 模型身份与出站核对（`nb-harness/src/models/target.ts`、`kernel/model/omp.ts`）

- 物化：元数据加实例覆盖经 `buildModel`；`Model.provider` 的规则：实例的协议与地址都跟随模板时用模板的 OMP id；改了协议或地址、或空白模板时用中性身份 `nbook-compatible`，只带本次协议需要的字段。**OpenRouter 等有环境变量切换线协议的模板，物化时用显式的 `openai-responses` 或 `openai-completions`**，不依赖打包目录里的 `api: "openrouter"`，也不从回包的 `api` 反推。
- `OmpTarget` 加 `name`（公开引用 `<实例 id>/<模型 id>`）与 `fetch`：发出前核对**规范化后的完整线请求地址**（协议、主机、端口、路径、协议允许的查询参数，不只比源）必须等于该实例有效地址按协议拼出的地址，且实例当前的 `uid` 与有效地址、协议、认证方式仍与本次解析相同，否则不发并报 `endpoint-mismatch`；免认证时剥掉哨兵值的 `Authorization`、`x-api-key`、`x-goog-api-key`；`redirect: "error"`；选路失败记进本次调用的槽，`ompCall` 在适配器报通用错误后优先交出。
- **会话日志的来源字段**：`ModelResponse.origin = {provider, api, model, deployment, credential?}`，作为独立的可选字段贯通事件写入（`modelEnded` 等）、重开后的历史投影、`Message` 与 `toContext`；`deployment` 是 `uid` 加有效地址与协议的哈希；签名型协议（Anthropic 等）另带 `credential`：凭据值经状态根里的随机密钥做的 HMAC，不含原文、不进日志展示。**公开引用、实际作答模型、签发与回放身份是三个独立的值**，`ompModelInfo` 与 `ModelRequest.model` 统一用公开引用。
- **还原签名的判断**：新日志要求 `origin` 整组相同（含 `credential`）；**旧日志没有 `origin` 时，按旧的实例 id 映射判断（同第一段、同协议），不拿中性身份直接比，也不补历史地址**。不匹配时不还原专用字段（降级成无专用元数据的历史），不把隔离全交给 pi-ai。会话日志加字段按 nb-session 的兼容规则（新增可选字段）。
- 验收：模板跟随且环境变量（`MOONSHOT_BASE_URL` 等）设着时实收地址仍是配置的，**包括环境变量只改路径、主机不变的情形（两个端点实收均为零）**；解析后换地址与密钥再发送被拒；Gemini 免认证实收头不含哨兵；**同名同址删建与同址换凭据，旧日志的签名不再被认；经会话关闭重开走真实回放，不手造 `Message`**；v1 同一自定义实例的旧日志重开仍按同服务商还原；OpenRouter 切 `PI_OPENROUTER_RESPONSES` 两种环境下线协议不漂移；v1 的非 fetch 行（Cursor、Bedrock、Codex 样本）不创建出站连接；同一网关、中性身份与 `opencode-zen` 的认证头各自实收（记入 B2 检测验收的前置证据）。

### B1.4 服务核心与合同 v3（`nb-models/src/core/`、`contract/`）

- **远程合同升到版本 3**，补丁一律“省略不改、`null` 清除”：
  - `templates()`（取代 `catalogProviders`）；`addProvider({template, region?, name?, baseUrl?, api?})`：空白模板必须带名称与地址；新建前清掉同 id 的遗留密钥；生成 `uid`。
  - `duplicateProvider(id)`：复制配置、新 `uid`；凭据只复制有效的方式（`apiKeyEnv` 复制引用，库里的密钥复制一行）；第二步失败回 `partially-applied` 带副本 id 与实际密钥状态。
  - `updateProvider` 收 `region`、`api`、`baseUrl`、`followSource`、`name`（不收 `proxy`）；改名重名返回 `invalid-value`。
  - `setModels` 保留，语义改为：`add` = 取消 `excluded`（来源模型）或手加一条；`remove` = 移出（来源模型进 `excluded`，手加的删除）；被角色用着的行内确认照现行输出 7。
  - **读模型**：`providerModels(provider, {offset, limit, revision?})`：按稳定顺序（系列、名称、id）读完整个服务商，页大小 200，响应 `{revision, rows, nextOffset, total}`，后续页带首页的 `revision`，换代返回 `revision-changed`、调用方重读；**不收 `query`**（搜索与分组在客户端）。`enabledModels({providers?, usable?, offset, limit, revision?})` 同样分页，`usable` 过滤出“有凭据的服务商的启用模型”（选择器与 agent 标签用）；`modelsByReference({references})`（一次 ≤ 50 个）按引用取行（含未启用的）并带 `enabled` 与 `usable`，Profile 页、角色页的名字取它；角色的引用核心已知，Profile 的引用由调用方交。行的 `usable` 在服务端算（启用、有凭据、状态 ok），消费者不各写一遍。**`modelsRevision` 按服务商分**，后台变化只使该家重读。
  - `setIcon(provider, {kind: "upload", png: base64 字符串} | builtin | initial | null)`：先限长（≤ 90 KB 的编码串）、解码后校验 PNG 头（≤ 256 × 256、拒绝含 `acTL` 的动图、≤ 64 KB），再用 `Bun.Image` 之类解码一次确认能显示，写文件再改设置，设置写失败删文件；文件按“是否仍被任一服务商引用”回收。
- 快照：服务商带 `template`、`region`、`icon`、来源状态（B1 恒为 `packaged`）、模型数与启用数、各自的 `modelsRevision`；**去掉 `kind`**；角色同段 A；**不带模型行**。
- **会话的失败码**：B1 不加新码；解析不了的引用沿用 `unknown-model`，`transport-unsupported` 对会话映射为 `unknown-model`，原因写在模型服务的状态里（第三轮后端第 23 条）。
- `check` 保持现状（B2 改探测）。

### B1.5 图标（`plugins/models/backend/icons.ts`）

图标文件存 `<状态根>/agent/provider-icons/<sha256>.png`，配置存 `{kind: "file", name}`；读取走 `GET /api/nbook.models/icons/<name>`（照 bots 头像的路由：逐段不跟链接、`nosniff`、跨站拒绝、ETag）。上传只经 `setIcon`。

### B1.6 前端（`plugins/models/web/`、`plugins/agent/web/`、`nb-agent-ui`）

**B6a 选用数据与迁移（外观不变）**
- **选用数据的归属**：`nbook.models/shared` 放一个纯 TS 工厂（输入远程合同客户端，输出 `rows`、`revision`、`ready` 三个响应式量），`nbook.models` 与 `nbook.agent` 各建一份（models 入口保持懒激活，不新增服务键）。读法：先读各家的 `modelsRevision`，只重读变了的那家；每页响应带版本，与快照不同就整家重读、限制重试次数；新版本到齐前继续交出旧版本，**到齐后一次换引用**（只触发一次 `refreshModel`）；选择器与 agent 标签只读 `usable` 的，角色页与 Profile 页按引用取行。
- 现有 22 处 `provider.models` 读取点（models-store 2、AllModelsView 1、ProviderDetail 4、RolesPage 2、ProvidersPage 6、ProviderRail 3、profile-view 2、agent plugin 2；开工时再数一遍）逐处迁移。
- 角色页的绑定下拉用 `SearchSelect` 远程模式（`filter: false`，`search` 事件走选用数据的本地过滤，截 100 项；当前值的名字取 `modelsByReference`）。
- Lab 的 fake-remote 随合同 v3 重写（走真实的 JSON 编码，不用 `structuredClone` 替身）；e2e 辅助函数（`addCustom`、`model`、`detail`）先按新流程与新 id 规则改好，再开大范围；保留的 `data-` 钩子列表写进组件 `.md`。
- 预算改成断言**节点数与计算次数**（不用 happy-dom 毫秒）：8 家 × 600 的最大输入下快照与分页读取、选项数组只算一次，并做变异检查。

**B6b 添加、标题区、图标**
- 添加对话框：分组多列、每行模型数与地区标签；空白模板与有地区的模板进第二步（名称、地址、协议，或地区单选），校验同现状；“已添加”写进可访问名称并加行内小字“再添加一份”，不停用；**登录组不再默认收起**：回到现行 Spec，列在同一张表里停用并写要登录，服务端同样拒绝。键盘：模板按钮按 DOM 顺序 Tab，搜索框里回车选第一个命中，搜索按名称、id、地区名匹配；第二步“返回”后焦点回到被点的模板；新服务商成为当前项后需要密钥的把焦点放到密钥框。
- 服务商标题区：图标弹出（三页签：内置带搜索框、上传图片、首字母；底部“恢复模板的图标”；内置只列模板用到的，由 `templates()` 的 logo 去重）；上传在客户端缩成 128 像素 PNG（缩图函数注入解码与编码，dom 测试用假的，e2e 里用真图验一条），弹出面板内一行 `role="alert"` 写失败原因（不是图片、读取失败、不收 SVG、缩后仍过大、写入被拒），上传中禁用面板；名称就地改（点名称或铅笔、Esc 取消、空名回退、重名行内写“已有同名服务商”、标题保持 heading 语义）；“复制一份”（成功后选中副本、焦点到名称；`partially-applied` 时选中副本并通知密钥没复制成功）；删除仍在列表条目上（决定 19）。
- 左栏图标：每家与“全部模型”前有服务商图标；窄布局下拉**不带图标**（`Select` 暂不画图片类图标）。
- **选择器取图**：`ComposerIcon` 加 `{kind: "url"; src: string; fallback?: string}`，`AgentIcon` 照 image 类渲染；agent 插件的 `providerIconRef` 改为读快照里的 `icon`（builtin 走图标表键，不是实例 id；file 走 `/api/nbook.models/icons/<name>`；initial 走首字母）；Spec `ui/agent-conversation-view.md` 一并改；验收“同模板两实例各自的图标不同、上传图标在选择器里出现”。

**B6c 模型区、管理模型、全部模型、编辑模型**
- 只保留一个概念：来源模型默认全部在列表里，行上的开关就是 `enabled`；“移出”只在“管理模型”里（`excluded`，以“已移出”一组出现、可找回）；模型区不显示 `excluded` 的行。
- 模型区：搜索框（客户端过滤）、系列默认收起且收起的组不渲染、有搜索时展开命中组并限 200 行加“还有 N 条，缩小搜索词”、个数；“检测全部”保持现状（逐个 `check`，B2 改）。
- 管理模型：列“已移出”与全部可加的模型，可找回；**全部模型页**默认按服务商收起且收起不渲染，搜索限 200 行。
- 编辑模型：所有服务商一种，“手动添加”都有；来源（打包目录）给的字段显示来源值，可覆盖，覆盖后标“已改”并可“恢复来源值”；缺的字段直接可填。快照的 `kind` 去掉，`ModelEditDialog`、`ProviderDetail`、`ProvidersPage`、`ProviderRail` 的 `kind` 分支逐处改。
- 窄与英文：每个新组件在 390 宽与英文各一个 Lab 场景，e2e 对“设置页 390 宽无横向溢出”断言；模型区头把次要操作收进“更多”，搜索框窄时独占一行；组件 `.md` 写交互与状态表。

## 段 B2：模型来源与协议检测

2026-11-22 按 B1 合入后的实际形状改写本节（决定 26：不再开计划审查，靠实现审查兜底）。B2 再拆两条分支、各自审查与合入：**B2a 模型来源**（在线列表、来源缓存、在线目录与自动更新、类型不明模型的启用规则、来源状态界面），**B2b 协议检测**（库自己的请求构造、`adoptApi`、界面逐个 `check`、删 `checkAll`）。拆开是因为两块没有共用的代码，B2a 一段的后端改动已经与 B1 相当。

与第四稿原 B2 节不同的地方（理由各一句）：

- **删 `pinned.json`**：它防的是“换了凭据后旧缓存作废，被角色引用、只在列表里有的模型物化不了”（第三轮 omp 第 6 条）。改为缓存按**部署**（`uid`、列表协议、有效地址）判有效，凭据只用来判**过期**：换了密钥或认证头，旧列表照用、标“需要重新拉取”，设了密钥会自动重拉；只有换了地址或协议（另一个端点）旧列表才不用。少一个文件与一套“谁被引用”的计算，那条发现要防的情形照样不坏。
- **不建 `static` 模板表**：每个模板按有效协议都有列表适配器；从没拉成功过（例如回 404）的实例用目录作成员，与“没有快照时用打包目录作离线种子”是同一条规则。
- **“本机”就是空白模板**：模板表里没有本机服务商（OMP 的 ollama、lm-studio、vllm 没有打包模型，B1 的模板表不收），本机端点都经空白模板添加。
- **`catalogAutoUpdate` 归 `nbook.models` 所有**，显示在 `nbook.network` 声明的“网络”分区里（与两个流超时显示在 Agent 的“运行可靠性”分区同一做法）：读它的是模型服务，不用跨插件读设置定义。`nbook.network` 插件壳在 B2a 只声明分区与文字，段 C 再加代理项。
- **删 `discover`**（B1 给空白模板的“管理模型”现取 `/models`）：空白模板也有了来源，管理模型对所有服务商都读 `listed` 与 `available` 两种行。nb-harness 的 `discoverModels` 一起删。
- **模板表的 `modelCount` 仍按打包目录算**：添加对话框只用它示意规模，不随在线目录变。

### B2a.1 目录视图与在线目录（nb-harness `models/catalog.ts`、新 `models/online-catalog.ts`）

- `parseOnlineCatalog(bytes)`：按帧魔数判 zstd，`zstdDecompressSync(bytes, {maxOutputLength: 32 MiB})`（Bun 1.4.4 超限抛 `RangeError`，已核对），`JSON.parse`，复用 pi-catalog 公开的 `mapModelsDevToModels(payload, MODELS_DEV_PROVIDER_DESCRIPTORS)` 与 `buildModel`，按 provider 归组成 `Model`。**价目是否存在看原文**（`cost` 字段在不在），不靠四个 0 倒推；自报档位随 `buildModel` 的策略。坏数据整份拒收。
- `fetchOnlineCatalog({etag, signal, url?})`：`GET`、`redirect: "manual"`、`proxy: false`；传输字节流式计数、超 8 MiB 中止；`304` 只在调用方给了 `etag` 时成立；交回 `{status: 200, bytes, etag} | {status: 304} | {failed, reason}`，不落盘、不解析（调用方先 `parseOnlineCatalog` 成功才一起提交正文与 ETag）。截止由调用方的 `signal` 定。
- `createCatalogView(online?)`：`chatModels(provider)`、`row(provider, id)`、`unsendable(provider, id)`；打包为底，在线目录只补打包里没有的模型（同 id 的用打包的：打包时做过修正，开工核对见 `evidences/b2a-probes.txt` 第 2 条）。只有实例跟随模板（B1 的 `follows`）时用在线行；协议不同时仍按 B1 只借能力字段。
- `ModelTarget.row?: Model`：调用方给的目录行盖过打包行（`materialize` 里 `config.row ?? bundledRow(...)`，`unsendable` 也按这一行判）。

### B2a.2 列表适配器（nb-harness `models/listing.ts`）

- `listModels({api, baseUrl, flavor, headers, signal})`，`flavor` 是 `openai`、`openrouter`（模板为 OpenRouter 时）、`anthropic`、`gemini`：`GET`，`redirect: "manual"`，`proxy: false`。认证头由调用方给（`requestAuth` 的结果加协议缺省头：OpenAI 系 `Authorization: Bearer`；Anthropic 跟随模板时 `x-api-key`、否则 `Authorization: Bearer`（与对话请求一致，B1 探针第 5 条），另带 `anthropic-version`；Gemini `x-goog-api-key`）。免认证（`auth: "none"`）不带。
- 每行 `{id, name?, kind: "chat" | "other" | "unknown", contextWindow?, maxOutput?, vision?}`：Gemini 按 `supportedGenerationMethods` 有无 `generateContent` 判 `chat`/`other`，`inputTokenLimit`、`outputTokenLimit` 进窗口与上限；OpenRouter 按输出模态判、`context_length` 与 `top_provider.max_completion_tokens`；OpenAI 兼容只有 id（个别带 `context_length` 的照收）→ `unknown`，由调用方查目录。
- 失败分类：`auth`（401、403）、`not-found`（404、405）、`unreachable`（连不上、超时）、`bad-response`（其余状态、3xx、不是列表、超限）、`cancelled`。**完整性**：分页（Anthropic `has_more`/`after_id`，Gemini `nextPageToken`）读到末页才成功；重复游标、超 20 页、单页超 8 MiB、超 5000 行都算 `bad-response`，不截断。

### B2a.3 来源与协调器（nb-models 新 `core/sources.ts`；应用 `plugins/models/backend/source-store.ts`）

- **存储接口** `SourceStore`（同 `IconStore`，应用给）：`read(uid)`、`write(uid, value)`（同目录暂存再改名）、`remove(uid)`、`list()`；另 `readCatalog()`、`writeCatalog(value)`。文件 `<状态根>/agent/model-sources/<uid>.json` 与 `<状态根>/agent/model-catalog.json`（`{version, etag, fetchedAt, bytes(base64)}`）；路径安全照 B1 的图标目录（从状态根逐段 `lstat`、有界读）。
- **缓存形状 v1**：`{version: 1, uid, deployment, credential, checkedAt, rows}`，TypeBox 校验、`uid` 必须与文件名一致；不合格按“没有缓存”并写诊断，不当成功空表。只存列表原生字段，目录补值与物化在读时按当前部署现算。成功的完整空表是权威的空成员。
- **身份**：`deployment` = SHA-256（`uid`、列表协议与 flavor、有效地址）；`credential` = 安装密钥对认证输入（B1 的 `authInput`）的 HMAC。`deployment` 不同 → 缓存不用（成员退回目录种子）；`credential` 不同 → 照用、状态 `stale`。
- **每家的来源行**（`sourcesOf(provider)`，按配置与缓存代次缓存）：有可用缓存 → 列表行逐行分类：列表自带 `kind` 优先；`unknown` 时实例跟随模板就查目录视图的同 id 行（有 → 按它的 `chat`；`other` 丢弃）；仍不明为 `unknown`。没有可用缓存 → 目录视图里模板的对话行（空白模板没有）。来源行形状沿用 B1 的 `CatalogModel` 加 `kind: "chat" | "unknown"`、`auto`（自动加入）、`row?`（物化用的目录 `Model`）。
- **类型不明的启用规则（决定 27）**：空白模板里 `unknown` 有窗口、且 id 不含 `embed`、`rerank`、`whisper`、`tts`、`moderation` 的自动加入；没有窗口的照样列出、状态 `incomplete`（“需补字段”，不默填猜测值）；含那几个词的与云模板里的 `unknown` 都不自动加入，只出现在“管理模型”的可加列表里（加入即启用，没有窗口的要先填）。
- **成员**：B1 的 `members.ts` 改为收 `sources` 参数（不再自己读打包目录），规则不变：开着自动加入时取 `auto` 的来源行去掉 `excluded`，加上条目；关着时只取有条目的。空白模板新建时 `followSource: true`（B1 是 false），界面对空白模板也显示这个开关；已存的值不改。`storedEntry`、`withRemoved`、`incomplete`、`withFollow` 一并改用 `sources`。来源里没了的来源条目照 B1 标 `missing`（界面写“服务商已不再提供”、可移除）。
- **协调器**：每个 `uid` 一个代次与在途任务。`refresh(uid)`：同部署同凭据的在途任务合并；否则取消旧任务、代次加一再发。截止 30 秒从受理起算，覆盖请求、读体、解析、写盘。提交前核对代次仍是当前、部署与凭据仍与发出时相同，否则丢弃；同一 `uid` 的写串行。失败不动旧缓存，只记 `lastError` 与时间（内存里，进快照）。
- **触发**：启动（自动更新开着时，对有密钥、缓存没有或超过 24 小时、且身份与当前相同的实例；身份不同的不自动拉，界面写“配置改了，重新拉取后更新”）；添加服务商、`setKey` 成功后（用户动作，不看自动更新开关）；`refreshSource`（手动）。改地址、协议、认证头后不自动拉。自动更新开着时另有每小时一次的过期检查（`unref` 的定时器）。
- **在线目录**：启动读 `model-catalog.json`（坏的按没有）；自动更新开着且超过 24 小时就带 ETag 重取：`200` 解析成功才写盘、换视图、作废快照；`304` 且本地文件可读才刷新 `fetchedAt`；失败沿用、写诊断。
- **回收**：只在服务商设置可读（`editable()` 为 `ok`）时删不在配置里的 `uid` 的缓存文件：启动时与删服务商后。设置不可读时不回收、不出站。
- **停止**：`close()` 先让全部代次不可提交、取消在途请求，限时 2 秒等收尾，再等写队列。夹具覆盖“响应体不结束时停止”。

### B2a.4 合同与设置（nb-models `contract/`、应用 `plugins/models/shared/settings.ts`、新 `plugins/network/`）

- 快照的 `source`：`{kind: "catalog"}`（没有列表缓存，用目录）或 `{kind: "listing", state: "ok" | "stale" | "refreshing" | "failed", checkedAt: number | null, error: ListingFailure | null}`；`stale` 含“凭据变了”“超过 24 小时”。模型行加 `kind: "chat" | "unknown"`。`providerModels` 的 `available` 包含不自动加入的 `unknown`。
- 新方法 `refreshSource({provider})`：受理即交回 `null`，结果经 `changed` 的快照交（`refreshing` → `ok` 或 `failed`）；失败码 `unknown-provider`、`no-credentials`。删 `discover`；`checkAll` 留给 B2b。
- 设置项 `nbook.models.catalogAutoUpdate`（布尔、缺省开、只用户层、分区 `nbook.network`）；`ModelsConfigStore` 加 `autoUpdate()`，订阅变化（关 → 开时补一次过期检查）。
- `nbook.network` 插件壳：描述、分区声明（分类 app，排“外观”之后，表单分区）、两种语言的文字、`architecture.test.ts` 的登记。

### B2a.5 前端（`plugins/models/web/`）

- 模型区头：来源状态一行（“服务商的列表，N 小时前更新”“正在拉取”“拉取失败：<原因>，沿用 N 小时前的列表”“配置改了，重新拉取后更新”“用内置目录”）、“重新拉取”按钮（进行中停用、拉取中服务商被删时静默）；空白模板也显示“服务商新出的模型自动加入”。失败原因五类各一句文案（`auth`、`not-found`、`unreachable`、`bad-response`、`cancelled`）加 `no-credentials`。
- 管理模型：所有服务商都读 `listed` 与 `available`；`unknown` 单独一组，写明规则（“服务商没说明类型，确认是对话模型再加入”）；没有窗口的加入时要求先填。删 `ProvidersPage` 里的 `discover` 分支。
- Lab：fake-remote 的快照与 `refreshSource`、来源状态的几个场景（含英文）；组件 `.md` 加状态表。

### B2b 协议检测（`nb-harness/src/models/probe.ts`）

B2a 合入后开工；内容照第四稿原 B2.2 与 B2.3 的检测部分：

走**库自己的请求构造**（B1 的小实验定做法）：每种协议走与对话同一路径与认证（含 OpenCode Zen 这类特判），不带推理参数，每种协议恰好一次 HTTP、不重试、不写文件，四种并行，整次 15 秒、可取消。**“可用”的判定是逐协议的首个生成证据**：握手、角色帧、created/start、空候选不算；证据之前的错误优先；证据到达即取消读取、中止 fetch。参数被拒的 4xx 原文显示，不判“协议不支持”。模型 id 依次取：调用方给的、第一个启用的、来源列表里的第一个对话模型；都没有时界面要求填一个。结果带规范化地址、所用模型、配置版本、`{ok, status, ms, message}`。**采纳用单独的 `adoptApi` 方法**，带检测时的端点、协议、模型与认证版本，在写队列里核对库版本、在设置 CAS 里核对原值，冲突不重基成无条件写。界面里改了地址要先保存再检测。**不做服务端 `checkAll`**：界面逐个 `check`（并发 4，取消只停领新项），删掉合同里的 `checkAll`。

- 协议检测块：点击时先提交草稿再检测（按钮不因“未保存”停用，只因“正在检测”或“没有密钥且需要密钥（写先填密钥）”停用）；结果带版本，变了就整块置灰写“配置已改，请重新检测”；失败行带“复制”、当前协议标“正在用”、成功的非当前协议显示“用这个”；390 宽换成上下两行。状态表进组件 `.md`。
- 检测全部：`CheckState` 加 `unknown`，进度“已检 N / 共 M”、只标当前批为 running，超过 20 个用 `AlertDialog` 确认个数与“会产生真实调用”；取消后停发后面的批。

## 段 C 的前提

B1 已把最低 Bun 版本提到 1.4.4，B2a 建了 `nbook.network` 壳（只有分区）；C 在此之上加代理项、`fetchFor`、系统代理读取与网络页，模型、列表、在线目录、探测的请求点从直连换成 `fetchFor`。B 的合同不含 `proxy`，C 再加。

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
- Bun 门槛已在 B1 提到 1.4.4（`packages/neuro-book/package.json`、`src/shared/product.ts` 的 `BUN_ENGINE`、`scripts/pack-app.ts`、桌面随包的 Bun 版本）；C1 只核对各入口（CLI 启动检查、托管入口、桌面）仍拒绝旧版。

### C.2 `nbook.network` 插件（`packages/neuro-book/src/plugins/network/`）

- 设置项（都只允许用户层）：`proxyMode`（缺省 `system`）、`proxyUrl`；`catalogAutoUpdate` 已在 B1 声明。设置分区 `nbook.network`（分类 app，排“外观”之后，page 分区）。
- 服务键 `networkKey`：`fetchFor(override?)`、`describe(target?)`；远程合同 `nbook.network/settings`：`describe()`、`test()`。
- 入口依赖：`nbook.models` 后端 → `networkKey`；`nbook.web-tools` 后端 → `networkKey`（决定 22，`plugin.ts` 把全局 `fetch` 换成 `fetchFor()`，3xx 仍按原合同 `failed`）；网络页 → `nbook.models` 的远程合同。入口级不成环，`architecture.test.ts` 守住。`proxy-unsupported` 经各入口映射：模型（选路失败槽）、列表（失败类别）、探测、网页工具（`unreachable` 之外加原因）。
- 网络页：“代理方式”“代理地址”用 `SettingsRow`（新增具名插槽 `below` 放行下信息，写进 `SettingsRow.md`）；“测试代理”“现在更新”用新的 `src/ui/settings/SettingsActionRow`（标题、说明、右端动作、行下状态 `aria-live="polite"`，保留与 `SettingsRow` 一致的右侧 24px 一格）。状态集：设置读不到、`describe()` 失败或超时、测试进行中可取消、离开页面取消。代理地址的说明去掉“可以带用户名和密码”。
- 模型服务：各请求点用 `fetchFor(provider.proxy)`（`OmpTarget.fetch`、列表请求、检测、探测）；在线目录用 `fetchFor()`。服务商详情的“高级”里加代理。

## Spec 与文档改动

段 A 的行已合入（Spec 与 ADR 0057 在 2026-11-20 提交）。下表只列 B1、B2、C 还要改的；Spec 与 Task 记录在主工作区、随各段合入的同一窗口更新，只写已合入的行为。

| 文件 | 段 | 改什么 |
|---|---|---|
| `docs/adr/0057-…md` | B1 | 取舍 3 改成完整线地址、`uid`、凭据身份；取舍 4 的 Bun 门槛写 1.4.4（ADR 正文在 B1 合入窗口按 ADR 规则另写追加，不改已接受的决定文字） |
| `harness/models.md`、`harness/runtime.md` | B1 | `OmpTarget.name`、`fetch` 与发送前核对；`ModelResponse.origin`（含 `credential`）与同源判断；`transport-unsupported` 与会话映射 |
| `models/service.md` | B1、B2、C | B1：术语（模板、实例、`uid`、来历）；输入形状 v2 与 v1 读法（目录条目只认旧运行时认的字段、首写丢弃被忽略的字段）、降级后果（决定 23）；输出 5、7、8、9、11、12、13、15 改；新增模板与添加、复制、图标、合同 v3 的读模型；B2：模型来源与在线目录、协议检测、`unknown` 的启用规则、`pinned`；C：非目标去掉“代理设置” |
| `models/settings-pages.md` | B1、B2、C | B1：输出 1、2、3、4、6、7、8、9、10、11、13 改（添加对话框、标题区、模型区、管理模型、全部模型、编辑模型）；B2：来源状态、检测协议、检测全部；C：代理字段 |
| `network/egress.md`（新，planned，C 验收后写实现入口与证据） | C | 设置项、选路规则、系统代理读法与来源、测试与外联清单、已知行为（`NO_PROXY`、不做 DNS、SOCKS 拒收、不跟随 3xx）；网络页 |
| `web/tools.md` | C | 请求经网络出口 |
| `ui/agent-conversation-view.md` | B1 | `ComposerIcon` 的 `url` 类、选择器取实例图标 |
| nb-ui `SettingsRow.md` | C | `below` 插槽 |
| `models/web` 组件的同名 `.md` | B1、B2 | B1：已有的七个（`ProviderDetail`、`ProvidersPage`、`ProviderRail`、`AllModelsView`、`ModelEditDialog`、`RolesPage` 的绑定下拉、`AddProviderDialog`）改写，新增五个（标题区、图标弹出、管理模型、模型区、模板选择行）各有 Lab 场景；B2：来源状态、检测块的状态表 |
| 应用 `CHANGELOG.md`「数据与升级」 | B1、B2 | 服务商设置的降级后果与 v1 里被忽略字段的丢弃；非 fetch 传输的旧配置保留但不可发送；最低 Bun 1.4.4 与环境代理在段 C 前走直连（决定 29） |

## 切片

每片一个或几个提交，片内自跑所列验证；每段结束开实现审查、处理、合入，Task README 记进度。开工前把“验证”里列的每个 e2e 文件在起点上各跑一遍记基线。

**段 A**：已合入（84b810ad1）。

**段 B1**（分支 `feat/w00032-t43-b1`）
- B1.0 基线与核对：“验证”里 B1 的 e2e 文件在起点各跑一遍记基线；先按新流程改好 e2e 辅助函数（`addCustom`、`model`、`detail`）；核对结论记 `evidences/b1-probes.txt`（stencil 公开导出与 zstd、按环境变量改址的 pi-ai 分支、OpenRouter 线协议、OpenCode Zen、CommandCode、三个混合协议模板的组合、库自己的请求构造做检测的小实验）。
- B1.1 模板表（`routes`、`addable`、`modelCount`、地区）；`nbook.network` 插件壳与直连 `fetchFor`；最低 Bun 1.4.4（`package.json`、`BUN_ENGINE`、`pack-app.ts`、桌面随包版本）。验证：nb-models 模板测试、各入口拒绝旧版。
- B1.2 配置 v2 与 v1 读法、写前核对、冻结与解冻、帧字节核对（用真实设置场地喂 v1 文件做对照：首写前的外部编辑、坏条目、v1 里被旧运行时忽略的字段、只含 `enabled: false` 的条目往返）。
- B1.3 解析、模型身份、`OmpTarget.fetch` 的完整线地址核对、日志 `origin`、`transport-unsupported`。验证见 B1.3 的验收（含经会话关闭重开的真实回放）。
- B1.4 核心与合同 v3（添加、复制、更新、`setModels`、分页读模型、`modelsByReference`、`setIcon`）与图标路由。验证：nb-models core、`models.test.ts`（复制的部分成功、分页换代、图标各失败）。
- B1.6a 选用数据工厂与 22 处读取点迁移（外观不变）、Lab fake-remote 重写、节点数与计算次数的预算测试。
- B1.6b 添加对话框、标题区、图标、选择器取图。
- B1.6c 模型区、管理模型、全部模型、编辑模型、窄与英文的 Lab 场景。
- B1.7 段 B1 收口：8 家 × 600 个的最大输入下快照、分页与设置全文的 UTF-8 线字节；e2e、实现审查（后端 omp、前端 Sonnet）、处理、合入；Spec、ADR、`CHANGELOG`；真实模型 smoke 经授权才跑。

**段 B2a**（分支 `feat/w00032-t43-b2a`）
- B2a.0 基线：`e2e/models.e2e.ts`、`e2e/settings.e2e.ts` 在起点各跑一遍；真实取一次 stencil 在线目录，核对解压后的大小、各 provider 的行数与价目、档位原文（记 `evidences/b2a-probes.txt`）。
- B2a.1 目录视图、在线目录的取与解析、`ModelTarget.row`；列表适配器，删 `discoverModels`。验证：nb-harness 测试用本机假端点（四种 flavor、分页中途 503 与重复游标、401、404、3xx、空表、超页超字节、响应体不结束时取消、zstd 解压超限、`304`），断言实收的地址与认证头。
- B2a.2 nb-models 的来源、协调器、成员改收 `sources`、合同（快照 `source`、行 `kind`、`refreshSource`，删 `discover`）。验证：nb-models 测试（部署与凭据变化、成功空表、代次丢弃、提交前身份变了、同名重建、坏缓存、回收要设置可读、停止时在途请求）。
- B2a.3 应用的 `SourceStore`、`catalogAutoUpdate`、`nbook.network` 壳。验证：`models.test.ts`（真实状态根与设置：添加后自动拉、改地址后不自动拉、设密钥后拉、重启读缓存、自动更新关时不出站）。
- B2a.4 前端与 Lab。验证：组件 dom 测试、e2e 验收（假端点列表进模型区、重新拉取、失败沿用）。
- B2a.5 收口：e2e、实现审查（后端 omp、前端 Sonnet）、处理、合入；Spec、`CHANGELOG`。

**段 B2b**（B2a 合入后，新分支 `feat/w00032-t43-b2b`）
- B2b.1 协议检测（库自己的请求构造、首个生成证据、`adoptApi`）；客户端逐个 `check`，删 `checkAll`。验证：`models.test.ts`（每种协议实收恰好一次且是首事件、取消、采纳的 `expect`、批量去重与总预算）。
- B2b.2 检测块、检测全部的界面与 Lab 场景。
- B2b.3 收口：e2e、实现审查、合入、Spec 与 `CHANGELOG`。

**段 C**
- C1 `nb-host/network`：选路、系统代理的各平台解析（喂样本输出）。验证：本机真实 HTTP 代理与两个目标端点，断言实收线路与头、直连盖过 `HTTPS_PROXY`、`PI_PROXY` 设着时仍直连、`NO_PROXY` 命中时 `describe` 返回旁路、SOCKS 与 PAC 样本经模型、列表、探测、网页工具都得到带原因的失败且没有连接。
- C2 `nbook.network` 的代理项与服务、网页工具与模型服务接入、服务商代理字段。验证：插件测试、`models.test.ts` 一轮对话走本机代理、web-tools 测试。
- C3 网络页与 `SettingsActionRow`、`SettingsRow` 的 `below` 插槽。验证：dom 测试（含状态集）、Lab。
- C4 段 C 收口：Windows 的系统代理在 pc-notype 上实测（macOS 标未验证），e2e、实现审查、合入；`network/egress.md` 写实现入口与证据。

## 验收映射

改完 Spec 后按编号补全；下面是要新增的覆盖（段 A 的行已由合入的测试覆盖）。

| 行为 | 段 | 覆盖 |
|---|---|---|
| v1 设置读进来行为不变；目录条目被旧运行时忽略的字段首写丢弃；首写前外部编辑；坏条目拒写；冻结往返；帧字节超限拒写 | B1 | `settings-store.test.ts`、`models.test.ts` |
| 模板的 `routes`、`addable`、`modelCount`、地区；同模板多份 | B1 | nb-models 模板测试、`models.test.ts` |
| 来源（打包目录）模型默认全部在列；移出与找回；被引用的行来源消失后仍可调用 | B1、B2 | `models.test.ts` |
| 同模板两家的多轮签名；环境变量改主机与改路径都不改写地址；解析后换地址或换密钥被拒；免认证哨兵头被剥；OpenRouter 切环境变量线协议不漂移；同名同址删建、同址换凭据后旧日志签名不被认；v1 旧日志重开仍还原 | B1 | nb-harness `omp` 测试（经会话关闭重开） |
| 非 fetch 传输（Cursor、Bedrock、Codex 样本）不创建出站连接，会话映射为 `unknown-model` | B1 | nb-harness、`models.test.ts` |
| 合同 v3：分页换代 `revision-changed`、`modelsByReference` 上限、`setIcon` 各失败、复制的 `partially-applied` | B1 | nb-models core、`models.test.ts` |
| 选用数据：只重读变了的服务商、到齐后一次换引用、节点数与计算次数 | B1 | `models-store.test.ts` 与各组件 dom 测试（变异检查） |
| 设置页各交互、空白模板第二步、同名、图标、窄与英文、390 宽无横向溢出 | B1 | 组件 dom 测试、`e2e/models.e2e.ts` |
| 同模板两实例的图标各自不同、上传图标在选择器里出现 | B1 | `AgentConversationComposer.dom.test.ts`、`e2e/agent-conversation.e2e.ts` |
| `data-model-picker*` 钩子仍在 | B1 | `e2e/agent-conversation.e2e.ts` |
| 列表请求的地址与认证、分类、分页完整性、字节与解压上限；在线目录的 `304` 与坏数据 | B2a | nb-harness `listing`、`online-catalog` 测试 |
| 部署与凭据变化、代次、停止、成功空表、回收、触发规则 | B2a | nb-models `sources` 测试、`models.test.ts` |
| `unknown` 与“需补字段”的启用规则；来源消失的 `missing` | B2a | `models.test.ts` |
| 探测每种协议实收一次且是首事件、取消、采纳；批量检测去重与总预算 | B2b | `models.test.ts` |
| 来源状态、重新拉取、失败沿用 | B2a | 组件 dom 测试、`e2e/models.e2e.ts` |
| 检测结果失效、检测全部的确认与取消 | B2b | 组件 dom 测试、`e2e/models.e2e.ts` |
| 选路、系统代理解析、SOCKS 与 PAC 拒绝、`NO_PROXY` 旁路、脱敏 | C | nb-host `network` 测试 |
| 网络页 | C | dom 测试、`e2e/settings.e2e.ts` |

## 验证

- 每段合入前的 e2e：B1 `models`、`settings`、`agent-conversation`、`lab-agent-ui`；B2a `models`、`settings`；B2b `models`；C `settings`、`models`。已知的原有失败（`lab-scenes` 的 ThemeEditor 404 四条、`workbench-views:754` 等，见 Agent 记忆）先对照，不算本段。实施中只重跑改到的文件。
- 每段收口跑 `docs:check` 与受影响包的 `--typecheck`；本机合同测试必跑，真实模型 smoke 经开发者授权才跑，写明包与文件，没有授权或凭据记“未验证”。
- 未验证边界：macOS 的系统代理读法；需要登录的服务商（不在范围）。

## 不做与风险

- 不做：OAuth 登录；Magpie 的粘贴 curl、余额探测、导入别的应用；抓站点图标；SOCKS5 与 PAC（决定 21）；装回旧版的保护（决定 23）；出口里的重定向；B1 里在线列表与在线目录（在 B2）。
- 风险：
  - 我方三个列表适配器要跟上各家接口的变化（B2）：只用各协议公开的列表接口，失败按类别报告、沿用上一次；新增服务商的特殊列表另加适配器。
  - 中性身份会丢掉模板的专用处理：只在用户改了协议或地址时才用，界面在协议与地址旁写明“改了以后按通用协议发送”。
  - 服务商对模型请求返回 3xx 时报错：用户要把地址改成最终地址（Spec 与错误文案写明）。
  - “测试代理”会向 Cloudflare 暴露出口 IP：只在用户点击时发生，写进外联清单。
  - 品牌图标的商标归各厂商：只用于标识服务商，不改形、不作装饰，开发者知悉。
  - 几百个模型的界面：B1 有节点数与计算次数的预算断言，超了上虚拟列表。
  - 设置层 CAS 的预检窗口：预检与锁内写之间用户恰好存了坏值时无法堵住（要改设置拥有者），接受取舍、写进已知限制。
  - 最低 Bun 提到 1.4.4：旧版用户升级时会被拒绝启动，发布说明写明；设了环境代理的用户在段 C 前模型请求走直连。
