# t09 模型服务：实施计划

## 1. Context

**为什么做。** Agent 插件（t10）、编辑器行内 AI（w00025 t12）、应用里的 nb-story 都要一个统一的“用哪个模型、凭什么密钥”的地方。新内核（t20）只定了模型端口 `ModelPort` 与 OMP 适配器，模型目录、凭据与角色交给宿主实现（[`harness/models.md`](../../../../../docs/specs/harness/models.md)）。本 Task 做内置插件 `nbook.models`：服务商与模型、凭据、模型角色、给内核的模型端口，以及设置窗口里的两页。

**依据。**

- t09 决定 1 到 8（2026-10-28），实施阶段的决定 9 到 30（2026-11-01，见 [README](README.md)），定稿的界面见评审板 `review` v9（`artifacts/review/index.html`）。
- [模型角色合同](../../../../../docs/proposals/model-roles-contract.md)（accepted，2026-09-10）：梯度四档加专精、不回落、未绑定即报错。
- [调研：OMP、新应用与旧应用的现状](../../research/2026-11-01-model-service-survey.md)。
- [`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、ADR 0032（密钥只认启动时的环境）。

**开发者已定（不再议）。** 摘要；原文见 README。

- 插件 `nbook.models` 只在服务端有实现（浏览器入口只有设置页）；密钥存 OMP 凭据库 `<状态根>/agent/credentials.db`，明文、文件 0600；值可写 `env:<变量名>`，只认启动时的环境。第一版不做 OAuth 登录（决定 2、10）。
- 角色：梯度 tiny、fast、main、deep 固定；专精先只有“压缩”，可自建；不回落，未绑定即报错；会话取模型的顺序：会话里选的 → Profile 设置 → main（决定 3、4）。
- 服务商列表只列添加过的；添加从 OMP 目录选或“自定义 OpenAI 兼容”；目录服务商也能改地址（走中转站），能力与单价仍按目录；自定义服务商地址能改、id 建后不变（决定 11、12、23、28）。
- 高级：认证方式（按接口格式、Authorization: Bearer、不要认证）、服务商级与模型级请求头，请求头的值也支持 `env:`（决定 23、28）。发现方式、兼容选项、扩展窗口、`!命令` 不做。
- 模型：启用开关、按系列分组（缺省按 id 推，可改）、能力图标、上下文窗口、检测；编辑对话框改显示名、系列、自定义模型的能力与限制、压缩触发点、四项单价、模型级请求头；“管理模型”对话框（目录或 `/models` 的结果，加入、移出，缺字段的标“要补字段”）；“全部模型”视图（决定 18、19）。
- 版式：服务商页左列表右详情（`settings-window.md` 输出 19 的例外），角色页一张表；改了就写，没有保存栏；页面不到 600px 时左栏收成下拉（决定 13 到 15、17、29、30）。
- 设置窗口分区栏 212 → 176px，所有分区一起（决定 21）。
- nb-ui：浮层面分档，小浮层 72%、一级对话框 90%、二级对话框 90%；叠在别的对话框上的对话框圆角不大于底下的窗口；在 nb-ui 的 `Dialog` 里实现，不各调用方覆盖（决定 20、27）。

**工作方式。** 开发者在场，按 implementation-planning：本计划先给开发者看，确认后交设计审查（后端与计划给 omp 默认模型；前端部分另派 Claude Sonnet），处理完再实施。代码在 Work 分支 `feat/w00032-agent-integration`（先合入最新 master），Task 记录与 Spec 在主工作区的 master。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 模型目录、自定义模型、`/models` 发现、推理档夹取 | OMP `pi-catalog`（`getBundledProviders`、`getBundledModels`、`buildModel`、`fetchOpenAICompatibleModels`、`clampThinkingLevelForModel`） | 仓库已依赖、nb-harness 已在用；目录随 OMP 升级 | 自己维护目录（旧应用的 Model Library 就是 Pi 目录的投影） |
| 凭据存储 | OMP `AuthStorage.create(<状态根>/agent/credentials.db)` | 决定 2；以后 OAuth 的表与刷新现成 | w00027 t08 的加密密钥库（搁置）；设置里的 `secret` 项（登记即拒） |
| 取密钥 | 自己读库里这家的 API Key，不用 `AuthStorage.keys.get` | `keys.get` 让环境变量盖过库里存的（调研第 1 节） | `keys.get` 的级联 |
| `env:` 引用 | 自己解析，查启动时的环境快照 | OMP 没有这个写法；它的兜底会把没设置的变量名当密钥发出去 | OMP 的 `$envExact` 兜底 |
| 服务商、模型、角色的配置 | `nbook.settings` 的设置项（用户层） | 已有的设置机制：可手改的 JSON、跨实例分发、外部改动即时生效；“指定网络地址或凭据只允许用户层”正好 | 插件私有的 Storage 记录（不能手改、不进设置文件视图） |
| 一次性检测请求 | 新内核的 OMP 适配器 `ompCall` | 失败归类、密钥遮盖都现成，结果与运行时一致 | 旧应用那样另写一条 `streamSimple` 调用 |

## 3. 关键设计

### 3.1 `packages/nb-ui`：浮层面分档与嵌套对话框

- 主题变量：`--overlay-surface` 保留给小浮层（菜单、下拉、弹出框、提示）；新增 `--dialog-surface`（一级对话框与浮动窗口）与 `--dialog-surface-nested`（叠在别的对话框上的）。`tokens.css` 的缺省值都取 `var(--overlay-surface)`，旧主题行为不变；nbook 主题取面板色的 72%、90%、90%；macOS 主题照它现在的取值不动（另由主题作者调）。在 `theme/tokens.ts` 登记。
- `Dialog`：现有的 `NB_DIALOG_WINDOW_DEPTH` 只数浮动窗口。另提供一个“对话框层数”（模态与窗口都算），面板据此加 `nb-ui-dialog-surface--nested`（层数 ≥ 2）：背景取 `--dialog-surface-nested`，圆角取 `--radius-window`（不大于底下的窗口）。一级取 `--dialog-surface`。`AlertDialog` 同一套。
- 文档：`design-language.md` 的“玻璃叠玻璃”一条改写为分档（二级仍是玻璃，不透明度由主题定），同时改 `ui-development-spec.md` 的相应条目；`authoring-themes.md` 加两个变量。
- 要守住：菜单与提示的外观不变（仍用 `--overlay-surface`）；“嵌套”在建立时取定（注入只在 setup 里）。

### 3.2 `packages/neuro-book/src/plugins/settings`：分区栏变窄

- `SettingsWindow.vue` 的 `--settings-side-width` 212 → 176px；核对搜索框、层标签与分区条目的对齐与长标题截断；Spec 输出 1 改数字。

### 3.3 `packages/nb-harness`：新子路径 `./models`

新目录 `src/models/`，导出到 `@notnotype/nb-harness/models`；只依赖 `pi-ai`、`pi-catalog`、`pi-utils`（同内核的架构约束，加进 `architecture.test.ts` 的检查范围）。旧根导出的 `catalog.ts`、`model.ts` 里可复用的函数挪进来，根导出改为从这里转出（nb-story 不受影响，旧 harness 退役时它们留下）。

```ts
// 目录
listCatalogProviders(): readonly CatalogProvider[];                 // id、名字、接口、地址、接入方式 keyless | key | login | unsupported
listCatalogModels(provider: string): readonly CatalogModelInfo[];   // 能力、窗口、最大输出、推理档、单价
// 一份配置解析成 OMP 的 Model（目录模型叠加地址覆盖与请求头；自定义模型用 buildModel）
buildTarget(provider: ProviderConfig, model: ModelConfig): {model: Model; priceKnown: boolean};
// 发现
discoverModels(input: {api, baseUrl, key: string | null, headers}): Promise<DiscoveryResult>; // 现有实现挪来
// 凭据
openCredentials(path: string, env: Readonly<Record<string, string | undefined>>): Promise<CredentialStore>;
interface CredentialStore {
    status(provider: string): KeyStatus;                 // none | stored | env（变量名、有没有值）
    set(provider: string, value: string): Promise<void>; // 原文或 env:变量名
    clear(provider: string): Promise<void>;
    resolve(provider: string): Promise<string | null>;   // 发请求时取；env 没值时 null
    close(): Promise<void>;
}
resolveHeaderValues(headers: Record<string, string>, env): Record<string, string>; // 请求头里的 env:
```

- `KeyStatus` 只给“有没有、读哪个变量”，不给值；值只在 `resolve` 里出现。
- 内核改动一处：`ompCall` 的 `apiKey` 改为 `() => string | Promise<string>`（OMP 的 `ApiKey` 本来就收解析函数）；遮盖仍用取到的那个值。改 `harness/models.md` 的签名与输出 3。

### 3.4 `packages/neuro-book/src/plugins/models`（新插件 `nbook.models`）

目录照现有插件：`plugin.ts`、`shared/`（合同、设置项定义、纯函数）、`backend/`（服务端入口）、`web/`（浏览器入口：设置页）、`testing/`。登记进 `src/manifest.ts` 的 `productPlugins` 与服务端、浏览器的常量表。

**设置项**（`shared/settings.ts`，全部 `layers: ["user"]`，`section` 指向本插件的两个 page 分区，在设置窗口里不出现在通用列表）：

- `nbook.models/providers`：数组，每项 `{id, kind: "catalog" | "custom", name, baseUrl?（目录服务商的覆盖）, api?（自定义）, auth: "default" | "bearer" | "none", headers: Record<string,string>, models: ModelConfig[]}`；`ModelConfig` = `{id, name?, group?, enabled, contextWindow?, maxOutput?, vision?, reasoning?, efforts?, compactAt?, price?: [in, out, cacheRead, cacheWrite] | null, headers}`。目录模型只存用户改过的字段（显示名、系列、启用、单价、压缩触发点、请求头），其余每次从目录读。
- `nbook.models/roles`：`{items: [{id, axis, name, description, model: "<服务商>/<模型>" | null}]}`，形状照角色合同；缺省值是四档加“压缩”、都未绑定。
- 密钥不进设置。

**服务端入口**（`backend/plugin.ts`，`location: "server"`，依赖 `settingsKey`、`stateRootKey`、启动环境快照；`onStartup` 不需要，按服务或远程调用激活）：

- 打开凭据库 `<状态根>/agent/credentials.db`（目录 0700）；入口停止时关闭。
- 在内存里维护“目录 + 设置”的快照，设置变化时重算，所以下面的 `resolve` 是同步的（内核的 `ModelPort.resolve` 要同步）。
- 进程内服务 `modelsKey`（`shared/contracts.ts`）：

  ```ts
  interface ModelsService {
      /** 给内核：按核心设置（会话选的模型）与角色解析；取不到给 no-model、no-credentials、unknown-model、role-unbound。 */
      port(): ModelPort;
      /** 解析“会话里选的 → Profile 设置的角色或模型 → main”（决定 4）。 */
      pick(input: {model: string | null; role: string | null}): ModelResolution;
      catalog(): ModelsSnapshot;          // 可用的模型（启用的）与角色，给 Composer、t10 用
      onChange(listener): () => void;
  }
  ```

  调用的 `call` 内部用 `ompCall`，密钥由 `CredentialStore.resolve` 异步取；密钥不出这个插件（平台提案“密钥不外交”）。
- 远程合同 `nbook.models/settings`（`provider: "server"`，`callers: ["browser"]`），给设置页：`catalogProviders()`、`catalogModels(provider)`、`keyStatus(provider)`、`setKey(provider, value)`（`write`）、`clearKey(provider)`、`discover(provider)`、`check(provider, model)`（发一条很短的请求：最大输出取 min(32, 模型上限)、不带推理，超时 30 秒；结果是通过，或失败的类别、一句话与服务商原文，原文已遮盖）。检测结果只在内存里，按会话失效（同旧应用）。
- 角色解析：显式要角色而未绑定 → `role-unbound`（不回落）；绑定的模型不存在或没启用 → `unknown-model`；没密钥 → `no-credentials`。`ModelResolution` 的失败码随之加 `role-unbound`（改 `harness/models.md` 与内核类型）。
- 压缩角色的初值：用户第一次绑 fast、而压缩还没绑时，页面同时把压缩设成同一个模型（决定 t11-3“首次设置时复制 fast”）；服务端不做隐式回落。

**浏览器入口**（`web/plugin.ts`）：两个 `settings.pages` 贡献（`category: "ai"`）：“服务商与模型”（`layout: "fill"`）与“模型角色”（`layout: "column"`）。页面经插件自己的设置服务读写设置项、经 `context.remote.use(nbook.models/settings)` 调密钥、发现与检测。

### 3.5 设置页的组件（`plugins/models/web/components/`）

照定稿的草稿重写成产品组件，每个先写同名 `.md`：`ProvidersPage`（宿主：左栏、窄窗口下拉、全部模型、空状态、对话框的开合）、`ProviderDetail`（连接、高级、模型分组列表）、`ModelRow`、`CapabilityIcons`、`HeadersEditor`、`ModelEditDialog`、`ManageModelsDialog`、`AddProviderDialog`、`AllModelsView`、`RolesPage`。

- 只有两个页面组件是宿主（读写设置、调远程服务）；其余是受控零件，数据经 props、操作经 emits。
- 玻璃面上的选中与悬停用半透明叠色（同设置窗口左栏），不用层级轴的不透明色（草稿里踩过）。
- “改了就写”：开关、下拉立即写；输入框失焦或回车写；写失败照设置窗口的写入失败处理（通知、回到实际值）。密钥框提交后清空、只显示状态。
- 删除服务商：删设置里的这一项并清掉凭据；确认框列出会变成未绑定的角色（由页面按角色设置算）。
- Lab：每个零件按“需要理由的声明”与配方登记场景；两个宿主页面的场景沿用草稿的局部设置宿主（设置窗口 + 内存层 + 假的远程服务）。

### 3.6 启动环境快照

`env:` 只认进程启动时的环境（决定 2，口径同 ADR 0032）。服务端入口文件（`server/start.ts` 的上游、在任何导入 OMP 的模块之前）拷一份 `process.env`，作为宿主能力 `startupEnvKey`（只在服务端）交给 `nbook.models`。

## 4. Spec 与文档改动

- 新 Spec `docs/specs/models/service.md`（`models.service`，planned）：服务商与模型的配置形状、凭据（存放、`env:`、状态不外露）、角色与解析顺序、失败码（`no-model`、`no-credentials`、`unknown-model`、`role-unbound`、远程方法的码）、发现、检测、`modelsKey` 与远程合同。
- 新 Spec `docs/specs/models/settings-pages.md`（`models.settings-pages`，planned）：两页的交互合同（定稿的决定），含“左列表右详情”的版式。
- `docs/specs/README.md` 注册表加两行。
- `harness/models.md`：`ompCall` 的 `apiKey` 可异步；失败码加 `role-unbound`；“不承诺”里“模型目录与凭据的管理”改为链接 `models/service.md`。
- `settings/configuration.md` 输出 20（密钥，planned）：写明第一个使用者 `nbook.models` 把凭据存在自己的凭据库，设置项的 `secret` 仍登记即拒。
- `settings/settings-window.md`：输出 1 的 212px 改 176px；输出 19 加一句“页面也可以用 fill 自己分栏（例：服务商与模型）”。
- `docs/proposals/model-roles-contract.md` 末尾追加决策记录：角色进 `nbook.models` 的设置项（不再是全局配置的 `roles` 段），专精种子只有“压缩”，`role-unbound` 码。
- nb-ui 文档：见 3.1。
- `docs/specs/theme/system.md` 第 2 层“角色变量”：加 `--dialog-surface`、`--dialog-surface-nested`，写明缺省回落到 `--overlay-surface`。

## 5. 切片

| # | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| 0 | Work 分支合入最新 master；建 `plugins/models` 目录骨架与登记（空入口） | — | `bun run typecheck`（neuro-book）、`architecture.test.ts` |
| 1 | nb-ui 浮层分档与嵌套对话框；设置窗口分区栏 176px；文档 | 3.1、3.2 | nb-ui 测试与 `typecheck`；Lab 场景截图（明暗、窄）；`lab-scenes.e2e.ts` 里设置窗口与对话框的场景；前端审查（Sonnet） |
| 2 | nb-harness `./models`：目录、`buildTarget`、发现、凭据库与 `env:`、请求头的 `env:`；`ompCall` 异步取密钥 | 3.3 | 本机起的 OpenAI 兼容端点（真实 HTTP）：发现、检测、请求头、认证方式三种、地址覆盖；凭据库真文件（0600、重开、清除）；`env:` 有值、没值、启动后才设；旧根导出的测试照过 |
| 3 | `nbook.models` 服务端：设置项、凭据、快照与解析、`modelsKey`、远程合同、启动环境快照 | 3.4、3.6 | 插件测试（设置场地 + 真 SQLite + 本机端点）：角色解析各失败码、改设置后解析即变、两个窗口订阅、密钥不出现在任何远程响应与诊断里 |
| 4 | 设置页的组件与两页；Lab 场景 | 3.5 | 组件 `*.dom.test.ts`；Lab 截图（明暗、窄）；e2e：添加自定义服务商（本机端点）、设密钥、拉取模型、检测、绑角色、删除服务商；前端审查（Sonnet） |
| 5 | 内核接上：`modelsKey.port()` 跑一轮真实请求（DeepSeek，`test:llm`）；收口 | — | `test:llm` 一条；`test:affected`；全量 e2e |

切片 1 与切片 2、3 互不依赖，可以由编码子代理并行做切片 1（独立 worktree），主会话做 2、3。

## 6. 验收映射

Spec 条目号在写 Spec 时定，这里先按 Spec 的节对应：

| Spec | 覆盖 |
|---|---|
| `models/service.md` 凭据与 `env:` | 切片 2 的凭据库测试；切片 3 的“密钥不外露”测试 |
| `models/service.md` 解析与角色 | 切片 3 的解析测试 |
| `models/service.md` 发现与检测 | 切片 2 的本机端点测试；切片 4 的 e2e |
| `models/settings-pages.md` | 切片 4 的组件测试与 e2e |
| `harness/models.md` 异步取密钥、`role-unbound` | 切片 2 的 `omp.test.ts` 补用例 |
| `settings/settings-window.md` 输出 1、19 | 切片 1 的 Lab 与 e2e |
| nb-ui 分档与嵌套 | 切片 1 的组件测试（嵌套时带 `--nested` 类、一级不带）与截图 |

## 7. 验证

- 端到端：`nbdev dev start` 起应用，设置窗口里添加本机的 OpenAI 兼容端点（测试用的假端点脚本）、拉取模型、检测、绑定 main；再用 DeepSeek（只经白名单从 `.env` 取 `DEEPSEEK_*`）检测一次真实模型。
- 未验证的边界：OAuth（不做）；Windows 上凭据库的文件权限（0600 在 Windows 无意义，照 OMP）；macOS 主题的分档取值（只改 nbook 主题）。

## 8. 不做与风险

- 不做：OAuth 登录、发现方式（ollama、lm-studio 等专用协议）、兼容选项、扩展窗口、`!命令` 取值、阶梯价、代理、超时与重试设置、服务商启用开关、旧应用的专精种子与“快捷选择器显示专精”开关、Composer 的模型选择（t17）、nb-story 改用本插件（迁 nb-story 时做）。
- 风险：
  - `AuthStorage` 的库里还有用量、封禁等表，与 omp 自己的库同形；我们只用凭据表，升级 OMP 时库的版本迁移由 OMP 做。
  - 目录模型的单价与能力随 OMP 升级变；用户改过的字段按“只存差异”保留。
  - “改了就写”下，输入地址打到一半失焦会写进半截地址；地址字段只在格式合法时写，不合法时行内提示、不写。
