# t09 模型服务：实施计划

## 1. Context

**为什么做。** Agent 插件（t10）、编辑器行内 AI（w00025 t12）、应用里的 nb-story 都要一个统一的“用哪个模型、凭什么密钥”的地方。新内核（t20）只定了模型端口 `ModelPort` 与 OMP 适配器，模型目录、凭据与角色交给宿主实现（[`harness/models.md`](../../../../../docs/specs/harness/models.md)）。本 Task 做内置插件 `nbook.models`：服务商与模型、凭据、模型角色、给内核的模型端口，以及设置窗口里的两页。

**依据。**

- t09 决定 1 到 8（2026-10-28），实施阶段的决定 9 到 30（2026-11-01，见 [README](README.md)），定稿的界面见评审板 `review` v9（`artifacts/review/index.html`）。
- [模型角色合同](../../../../../docs/proposals/model-roles-contract.md)（accepted，2026-09-10）：梯度四档加专精、不回落、未绑定即报错。
- [调研：OMP、新应用与旧应用的现状](../../research/2026-11-01-model-service-survey.md)。
- [`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、ADR 0032（密钥只认启动时的环境）。

**开发者已定（不再议）。** 摘要；原文见 README。

- 插件 `nbook.models` 只在服务端有实现（浏览器入口只有设置页）；密钥存 OMP 凭据库 `<状态根>/agent/credentials.db`，明文、文件尽量 0600；密钥框里写 `env:<变量名>` 时，变量名存进服务商的设置（`apiKeyEnv`），凭据库只存真密钥（决定 32）；只认启动时的环境。第一版不做 OAuth 登录（决定 2、10）。
- 角色：梯度 tiny、fast、main、deep 固定；专精先只有“压缩”，可自建；不回落，未绑定即报错；会话取模型的顺序：会话里选的 → Profile 设置 → main（决定 3、4）。
- 服务商列表只列添加过的；添加从 OMP 目录选或“自定义 OpenAI 兼容”；目录服务商也能改地址（走中转站），能力与单价仍按目录；自定义服务商地址能改、id 建后不变（决定 11、12、23、28）。
- 高级：认证方式（按接口格式、Authorization: Bearer、不要认证）、服务商级与模型级请求头，请求头的值也支持 `env:`（决定 23、28）。发现方式、兼容选项、扩展窗口、`!命令` 不做。
- 模型：启用开关、按系列分组（缺省按 id 推，可改）、能力图标、上下文窗口、检测；编辑对话框改显示名、系列、自定义模型的能力与限制、压缩触发点、四项单价、模型级请求头；“管理模型”对话框（目录或 `/models` 的结果，加入、移出，缺字段的标“要补字段”）；“全部模型”视图（决定 18、19）。
- 版式：服务商页左列表右详情（`settings-window.md` 输出 19 的例外），角色页一张表；改了就写，没有保存栏；页面不到 600px 时左栏收成下拉（决定 13 到 15、17、29、30）。
- 设置窗口分区栏 212 → 176px，所有分区一起（决定 21）。
- nb-ui：浮层面分档，小浮层亮色 72%、暗色保持 75%，一级对话框 90%、二级对话框 90%（亮暗都是）；叠在别的对话框上的对话框圆角不大于底下的窗口；在 nb-ui 的 `Dialog` 里实现，不各调用方覆盖（决定 20、27、31）。

**工作方式。** 开发者在场，按 implementation-planning。第一稿开发者看过同意，设计审查（omp 17 条、Claude Sonnet 24 条）处理后成为本稿，处置见 [`evidences/design-review-disposition.md`](evidences/design-review-disposition.md)。代码在 Work 分支 `feat/w00032-agent-integration`（先合入最新 master），Task 记录与 Spec 在主工作区的 master。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 模型目录、自定义模型、`/models` 发现、推理档夹取 | OMP `pi-catalog`（`getBundledProviders`、`getBundledModels`、`buildModel`、`fetchOpenAICompatibleModels`、`clampThinkingLevelForModel`） | 仓库已依赖、nb-harness 已在用；目录随 OMP 升级 | 自己维护目录（旧应用的 Model Library 就是 Pi 目录的投影） |
| 凭据存储 | OMP `AuthStorage.create(<状态根>/agent/credentials.db)`，只经公开的 `credentials.list/set/remove` | 决定 2；以后 OAuth 的表与刷新现成；不碰 OMP 的私有表（软删除、多行、迁移由 OMP 管） | 直接读 SQL；w00027 t08 的加密密钥库（搁置）；设置里的 `secret` 项（登记即拒） |
| 取密钥 | 读库里这家的活动 API Key 行，不用 `AuthStorage.keys.get` | `keys.get` 让环境变量盖过库里存的（调研第 1 节） | `keys.get` 的级联 |
| `env:` 引用 | 变量名存设置的 `apiKeyEnv`，发请求时查启动时的环境快照 | 变量名不是密钥；存进凭据库会被任何按 OMP 读库的代码当成字面密钥（审查 O5，决定 32）；与 nb-story 的 `apiKeyEnv` 一致 | 存进凭据库；OMP 的 `$envExact` 兜底 |
| 服务商、模型、角色的配置 | `nbook.settings` 的设置项（用户层） | 已有的设置机制：可手改的 JSON、跨实例分发、外部改动即时生效；“指定网络地址或凭据只允许用户层”正好 | 插件私有的 Storage 记录（不能手改、不进设置文件视图） |
| 一次性检测请求 | 新内核的 OMP 适配器 `ompCall` | 失败归类、密钥遮盖都现成，结果与运行时一致 | 旧应用那样另写一条 `streamSimple` 调用 |

## 3. 关键设计

### 3.1 `packages/nb-ui`：浮层面分档与嵌套对话框

- **变量**：`--overlay-surface` 留给小浮层（菜单、下拉、弹出框、提示）；新增 `--dialog-surface`（一级：模态对话框、浮动窗口）与 `--dialog-surface-nested`（叠在别的对话框上的）。`tokens.css` 缺省：`--dialog-surface: var(--overlay-surface)`、`--dialog-surface-nested: var(--dialog-surface)`（只覆盖一级的主题，二级跟着一级，不会比一级更透）。在 `theme/tokens.ts` 登记。
- **nbook 取值**：亮色 `--overlay-surface` 65% → 72%，暗色保持 75%；两个对话框变量亮暗都是面板色 90%。写进基线块与暗色块；`prefers-reduced-transparency`、`prefers-contrast: more` 两个块（含暗色选择器）把两个新变量也设成 `var(--bg-panel)`。macOS、aurora、editorial 不写，缺省回落，外观不变。
- **消费者**：`.nb-ui-dialog-surface` 加 `background-color: var(--dialog-surface)`；新类 `.nb-ui-dialog-surface--nested`：背景取 `--dialog-surface-nested`，圆角取 `min(var(--radius-window), 原圆角)`，写在 `--compact`、`--window` 两个类之后（嵌套的 `AlertDialog` 不会被放大）。`Dialog`、`AlertDialog` 两个用；`Drawer` 也用 `.nb-ui-dialog-surface`，这次改成显式保持 `--overlay-surface`（抽屉算小浮层这一档，不在本 Task 评审范围），在 `Drawer.md` 写一句。
- **嵌套判定**：新注入键“对话框层数”（模态与窗口都 +1），`Dialog`、`AlertDialog` 都读与提供；层数 ≥ 2 加 `--nested`。按组件树判定、在建立时取定：从应用根上的服务打开的对话框即使视觉上压在设置窗口上，也算一级（`Dialog.md` 写明这条限制）。二级仍是玻璃，前提是对话框传送到 `body`（`teleportTarget: false` 时是窗口的 DOM 子孙，模糊采不到背景），写进 `Dialog.md`。
- **文档**：`design-language.md` 第二节边界 4（玻璃叠玻璃）、第一节的材质轴表（“整页只有一层模糊”）、第九节检查表“嵌套浮层不做玻璃”、几何清单的圆角行；`ui-development-spec.md` 第 9 节的 65%/75% 基准；`authoring-themes.md` 的浮层透明度一节与两个新变量；`Dialog.md`、`AlertDialog.md`、`Drawer.md`。
- **验收**：真实浏览器里测计算样式，不测类名：设置窗口再开编辑对话框，两层背景 alpha 约 0.9、`backdrop-filter` 不是 none、二级圆角不大于窗口；“减少透明度”仿真下两层 alpha 为 1、`backdrop-filter` 为 none；菜单亮 0.72、暗 0.75。

### 3.2 `packages/neuro-book/src/plugins/settings`：分区栏变窄与页面的写入失败

- `--settings-side-width` 212 → 176px：改 `SettingsWindow.vue`、`SettingsWindow.md`、Spec 输出 1、`settings.e2e.ts:524`（另加一条整窗几何断言）。分区条目被截断时悬停显示全名（`title` 或 Tooltip），Lab 加中英长标题各一个条目。
- `nbook.models` 的两页上线后左栏出现“写作助手”组：改 `settings.e2e.ts:518` 的组标题断言（在切片 4）。
- `SettingsPageContext` 加 `reportWriteFailure(subject, failure)`：页面写失败时交给窗口统一通知（同通用列表的文案与 `unknown-outcome` 的标题），页面不各发各的；Spec 输出 14 加一句。

### 3.3 `packages/nb-harness`：新子路径 `./models`

新目录 `src/models/`，在 `package.json` 的 `exports` 登记 `./models`；只依赖 `pi-ai`、`pi-catalog`、`pi-utils`（加进 `architecture.test.ts`）；`nbook.models` 只经这个公开入口。旧根导出 `catalog.ts`、`model.ts` 里可复用的函数挪进来，根导出改为转出（nb-story 不受影响）。

```ts
listCatalogProviders(): readonly CatalogProvider[];                 // id、名字、接口、地址、接入方式 keyless | key | login | unsupported
listCatalogModels(provider: string): readonly CatalogModelInfo[];   // 能力、窗口、最大输出、推理档、单价
buildTarget(provider: ProviderConfig, model: ModelConfig, secrets: {apiKey: () => Promise<string | null>; headers: Record<string, string>}): Target;
//   目录模型叠加地址覆盖与请求头；自定义模型用 buildModel，contextWindow 缺失时抛（调用方先校验）
discoverModels(input): Promise<DiscoveryResult>;                     // 现有实现挪来，按状态码分类
openCredentials(path: string): Promise<CredentialStore>;
interface CredentialStore {                                          // 只经 AuthStorage.credentials 的公开 API
    has(provider: string): boolean;                                  // 有没有活动的 API Key 行（内存，见下）
    set(provider: string, key: string): Promise<void>;               // credentials.set(provider, {type: "api_key"})
    clear(provider: string): Promise<void>;                          // credentials.remove(provider)
    get(provider: string): Promise<string | null>;                   // 发请求时取
    onChange(listener: () => void): () => void;
    close(): Promise<void>;
}
resolveEnvRef(name: string, env: StartupEnv): string | null;          // apiKeyEnv 与请求头值里的 env:
```

- `set` 用 OMP 的替换语义：同服务商的其它凭据（包括以后的 OAuth 行）被软删除。第一版库里只有本插件写的 API Key，Spec 写明；做 OAuth 时重议（O6）。
- 凭据库在 `<状态根>` 下，只有本服务端写（ADR 0033：一个状态根一个服务端）；内存里的“哪些服务商有密钥”以本进程的写为准，库被外部工具改了要重启才生效，Spec 写明（O7 部分接受）。
- `ompCall`：`apiKey` 改为 `() => string | Promise<string>`；新增 `secrets: () => readonly string[]`（本请求解析出的密钥与请求头值），全部进遮盖；服务商原文截到 8 KB、去控制字符、遮掉 URL 里的用户信息与查询串（O11）。改 `harness/models.md`。
- 内核：`modelCaller` 把 `options.role` 交给 `host.resolve`（现在丢了，O1）；失败码 `unknown-model`、`role-unbound` 按 3.4 的传播表进 `api/codes.ts`、`commands.ts`、`preview.ts`、`complete()`，不再压成 `no-model`（O9）。

### 3.4 `packages/neuro-book/src/plugins/models`（新插件 `nbook.models`）

目录照现有插件：`plugin.ts`、`shared/`（合同、设置项、纯函数）、`backend/`、`web/`、`testing/`、`locales/`（中英文字目录，照 `nbook.settings`）。登记进 `src/manifest.ts` 与服务端、浏览器的常量表。

**设置项**（`shared/settings.ts`，`layers: ["user"]`；只由服务端写，见下）：

- `nbook.models/providers`：数组。每项 `{id, kind: "catalog" | "custom", name, baseUrl?, api?, apiKeyEnv?, auth: "default" | "bearer" | "none", headers, models: ModelConfig[]}`。
  - 自定义服务商的 id 由名字生成：转成 `[a-z0-9._-]`（中文名转成 `custom`），与已添加的和目录里的 id 冲突时加 `-2`、`-3`；schema 用 pattern 拦含 `/` 的 id；建后不变（O15、S18）。
  - `ModelConfig` = `{id, name?, group?, enabled, contextWindow?, maxOutput?, vision?, reasoning?, efforts?, compactAt?, price?, headers}`。目录模型只存改过的字段。自定义模型 `enabled: true` 时 `contextWindow` 必须是正整数（schema 的条件约束）；缺字段的候选可以加入但只能是停用的（O13、S20）。
  - 模型 id 按第一个 `/` 之后整体算（OpenRouter 的 id 自带 `/`）。
- `nbook.models/roles`：`{items: [{id, axis, name, description, model: "<服务商>/<模型>" | null}]}`，缺省四档加“压缩”、都未绑定。
- 请求头的值写进设置文件；名称像凭据（`authorization`、`x-api-key`、`api-key`，或含 `token`、`secret`、`key`）时，界面把值框变成密码框并提示改用 `env:变量名` 或“认证方式”（S17）。

**写入只经服务端（O12、S9、S12）**：浏览器不直接写这两个设置项，所有改动调远程方法，按 id 打补丁；服务端用一个串行队列“读最新值 → 合并这一处 → 写回”。同一窗口里连着改、两个窗口同时改不同的项都不会互相覆盖；两个窗口改同一项的同一字段，后到的生效（Spec 写明）。外部直接改设置文件照常生效。

**服务端入口**（`backend/plugin.ts`，`location: "server"`，依赖 `settingsKey`、`stateRootKey`、`startupEnvKey`）：

- 打开凭据库（目录 0700、文件尽量 0600，权限做不到的平台按 OMP 尽力而为并写诊断，O17）；入口停止时关闭。
- **快照**：目录 + 两个设置项 + 凭据库的“哪些服务商有密钥” + 启动环境里 `apiKeyEnv` 有没有值；任何一个变化就重算，所以 `resolve` 同步（O2）。`resolve` 以快照报 `no-credentials`；解析后、请求前密钥被清掉的竞态由适配器报 `auth`／`missing-key`，Spec 写成已知竞态（模型请求已开始，按普通模型失败收口）。
- **目录漂移**（O14）：引用的目录模型不在了，快照里保留这条引用并标 `missing`（原服务商与模型 id），`resolve` 给 `unknown-model`；角色页显示“原绑定 X 已不在目录”；写一条诊断。不做别名表。
- **进程内服务 `modelsKey`**：

  ```ts
  interface ModelsService {
      /** 给一个会话的模型端口；defaults 是 Profile 设置里的角色或模型（t05、t10 交来）。 */
      port(defaults?: {readonly model?: string; readonly role?: string}): ModelPort;
      snapshot(): ModelsSnapshot;          // 启用的模型、角色及其有效性，给 Composer、t10
      onChange(listener: () => void): () => void;
  }
  ```

  `port` 的解析表（O1）：

  | 用途 | 取模型 |
  |---|---|
  | `turn`（含预览、`complete()`） | 会话里选的 `settings.model` → `defaults.model` → 角色 `defaults.role ?? "main"` |
  | `compaction` | 调用方给的 `role` → `compaction` |
  | `approval` | 调用方给的 `role` → `fast` |
  | `background` | 调用方给的 `role` → `main` |

  走到角色时未绑定 → `role-unbound`；绑定的模型不在或没启用、自定义模型缺上下文窗口 → `unknown-model`；没密钥 → `no-credentials`。`call` 内部用 `ompCall`，密钥异步取；密钥不出插件。
- **失败码传播**（O9）：端口 → `send`／`start` 的受理结果、`complete()`、预览的 `PreviewUnavailable` 都原样保留 `unknown-model`、`role-unbound`；`modelCaller`（压缩、审批）把它写进 `modelFailed.error.code`。
- **远程合同 `nbook.models/settings`**（`version: 1`，`provider: "server"`，`callers: ["browser"]`；每个方法的 TypeBox 输入输出与业务码写进 Spec，O10）：

  | 方法 | 读写 | 业务码 |
  |---|---|---|
  | `catalogProviders()`、`catalogModels(provider)`、`snapshot()` | read | `unknown-provider` |
  | `addProvider(input)`、`updateProvider(id, patch)`、`removeProvider(id)` | write | `unknown-provider`、`invalid-value`、`write-failed` |
  | `upsertModel(provider, model)`、`removeModel(provider, id)`、`setModels(provider, changes)`（管理模型“完成”一次写） | write | 同上，加 `model-incomplete` |
  | `setRole(id, model)`、`addRole(input)`、`removeRole(id)` | write | `unknown-role`、`builtin-role`、`invalid-value`、`write-failed` |
  | `keyStatus(provider)` | read | `unknown-provider` |
  | `setKey(provider, value)`、`clearKey(provider)` | write | `unknown-provider`、`credentials-unavailable` |
  | `discover(provider)` | read | `no-credentials`、`not-supported`、`auth`、`unreachable`、`failed` |
  | `check(provider, model)`、`checkAll(provider)` | read | `unknown-model`、`no-credentials`；结果里是通过或失败的类别、一句话与截断遮盖过的原文 |

  写方法遇到运行时的 `unknown-outcome`（帧已发出后断线）：页面先重取 `snapshot()`、`keyStatus()` 再决定显示什么。`setKey(value)` 里 `value` 以 `env:` 开头时改写 `apiKeyEnv` 并清掉库里的密钥，否则写库并清掉 `apiKeyEnv`。`checkAll` 并发上限 4（O15）；检测最大输出 min(32, 模型上限)、不带推理、超时 30 秒。
- 压缩角色的初值：第一次绑 fast 而压缩未绑时，`setRole` 在同一次写里把压缩设成同一个模型（t11 决定 3）。
- 被角色用着的模型停用、移出，或它的服务商被删：服务端照写（不拦）；页面先确认（见 3.5）。

**浏览器入口**（`web/plugin.ts`）：两个 `settings.pages` 贡献，`category: "ai"`，`layers: ["user"]`（“本作品”标签下停用并带原因，S7），带 `keywords`（API Key、密钥、请求头、Base URL、模型、角色等，S22）。“服务商与模型”`layout: "fill"`，“模型角色”`layout: "column"`。

### 3.5 设置页（`plugins/models/web/`）

- **数据模块**（S12）：`web/models-store.ts`，非组件。持有快照（订阅远程 `snapshot` 的变化）、各服务商的密钥状态、检测与发现结果（按服务商与模型 id 记，组件卸载不丢，按会话失效），所有写都经它调远程方法。“角色是否有效”“模型被哪些角色用”用 `shared/` 里的纯函数，服务端解析与页面共用，同一组用例测。两个页面组件只是它的消费者，不是两个宿主。
- **组件**（每个先写同名 `.md`）：`ProvidersPage`、`RolesPage`（页面，读写都经数据模块）；受控零件 `ProviderRail`、`ProviderDetail`、`ModelRow`、`CapabilityIcons`、`HeadersEditor`、`ModelEditDialog`、`ManageModelsDialog`、`AddProviderDialog`、`AllModelsView`。
- **复用**（S21）：`SettingsPageActions`（删除放标题区）、`Collapsible`（高级）、`InfoTip`（标题旁的“?”）、`SearchSelect`（角色页选模型）、`Select`（窄窗口的服务商下拉）、`EmptyState`、`Badge`、`Switch`、`AlertDialog`；文字与数字字段用 nb-form 的 `SchemaField`，得到输出 14 的那套行为（编辑中只改草稿、失焦或回车写、解析不了不写并标“未保存：原因”、与已保存相同不写）。不用 `SettingsRow`（它写的是叶子设置项，这里写经远程方法）；不用 `SettingsPageList`（版式是左列表右详情）。Lab 的 `SampleModelsPage` 示例页改名“示例服务商”以免同名，内容不动。
- **局部草稿**（S10）：请求头编辑器自己持有行数组（含没填完的行），名称非空且不重复（不分大小写）、值非空时才写出；不合法的行标原因，不写。
- **被角色用着的模型**（S11）：模型行标“主力”这类小标；停用或移出这样的模型时行内确认，列出会变成未绑定的角色；与删除服务商的确认用同一个纯函数。
- **焦点**（S16）：删除服务商后焦点到下一个服务商（没有则“添加服务商”），用 `AlertDialog` 的 `closed` 事件；左栏照窗口左栏：`aria-current`、上下键、Home/End；对话框关闭后焦点回到打开它的按钮，行的 `key` 用 id。
- **窄窗口**（S15）：`ProvidersPage` 根声明 `container-type: inline-size`，`@container (max-width: 600px)` 时左栏收成下拉；窗口最小 600×400 时详情可滚动。
- **状态**（S19）：密钥状态第一次响应前显示“读取中”（不显示“未设置”）；服务端入口不可用时页面只读、写操作停用并说明；发现与检测进行中可取消，对话框关闭后迟到的结果丢弃。写进各组件 `.md` 的“状态”一节。
- **可访问名称**（S24）：请求头的名称、值有 `aria-label`；“检测”“检测失败，查看原因”带模型名；能力图标可聚焦或改成文字说明。
- **Lab**：受控零件按配方登记场景；两个页面用“设置窗口 + 内存层 + 假的远程服务”的局部宿主（同草稿），在两个 `.md` 写明这是页面而非宿主、为什么能进 Lab。

### 3.6 启动环境快照（O3）

新模块 `src/server/startup-env.ts`：只拷 `process.env`、不导入任何东西。它是每个服务端入口的第一条导入：`server/main.ts`、`server/development-main.ts`（每个 worker）、`server/testing/fixture-entry.ts`（ESM 按导入顺序先执行它的模块体，早于后面导入的 OMP）。`start.ts` 经宿主能力 `startupEnvKey`（只在服务端）交给插件。项目子进程不需要（模型只在服务端），Spec 写明。测试：真实子进程里家目录 `.env` 与当前目录 `.env` 各放一个键，快照只含后者与 shell 导出的。

## 4. Spec 与文档改动

- 新 Spec `docs/specs/models/service.md`（`models.service`，planned）：配置形状与校验（id 规则、自定义模型的完整性）、凭据（存放、`apiKeyEnv`、替换语义、单写者、权限尽力而为）、快照与解析表、失败码与传播、目录漂移、写入只经服务端与并发、远程合同逐方法、检测与发现、遮盖与截断、启动环境。
- 新 Spec `docs/specs/models/settings-pages.md`（`models.settings-pages`，planned）：两页的交互合同，编号条目逐条映射到测试。
- `docs/specs/README.md` 注册表加两行。
- `harness/models.md`：`apiKey` 可异步、`secrets` 全遮盖与原文截断；`role-unbound`；“不承诺”里改为链接 `models/service.md`。`harness/runtime.md`：`send`、`start`、预览的失败码加 `unknown-model`、`role-unbound`。
- `settings/configuration.md` 输出 20：第一个使用者 `nbook.models` 用自己的凭据库，设置项的 `secret` 仍登记即拒。
- `settings/settings-window.md`：输出 1 改 176px；输出 3 写“fill 页面可以自己左右分栏（例：服务商与模型）”，输出 19 改成“本组件不做左右分栏”（S22）；输出 14 加页面的 `reportWriteFailure`。
- `docs/specs/theme/system.md` 第 2 层：加两个新变量与缺省回落。
- `docs/proposals/model-roles-contract.md` 末尾追加决策记录：角色进 `nbook.models` 的设置项、专精种子只有“压缩”、`role-unbound`、Profile 默认经 `port(defaults)`。
- nb-ui 文档：见 3.1。

## 5. 切片

| # | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| 0 | Work 分支合入最新 master；`plugins/models` 骨架与登记（入口为空、两页声明在） | — | `typecheck`、`architecture.test.ts`；`settings.e2e.ts` 的组标题断言随之改 |
| 1 | nb-ui 分档与嵌套；分区栏 176px；`reportWriteFailure`；文档 | 3.1、3.2 | nb-ui 测试与 `typecheck`；e2e 计算样式（3.1 验收，亮、暗、减少透明度）；`settings.e2e.ts`；前端审查（Sonnet） |
| 2 | nb-harness `./models` 与 exports；凭据库；`ompCall` 的异步密钥、全遮盖与截断；内核 `modelCaller` 转交角色与失败码传播 | 3.3 | 本机 OpenAI 兼容端点（真 HTTP）：发现、检测、三种认证、地址覆盖、回显密钥与请求头值的错误被遮、超大原文截断；凭据库真文件：设置、替换、清除、两个连接；内核：带角色的 `ctx.model`、`role-unbound` 到 `send`／预览／`complete()` |
| 3 | 启动环境快照；`nbook.models` 服务端：设置项与校验、写入队列、快照、端口与解析表、远程合同 | 3.4、3.6 | 真实子进程测启动环境；插件测试（设置场地 + 真凭据库 + 本机端点）：解析表各分支与失败码、目录漂移、两个窗口经真实 RPC 并发写不同项都保留、写方法帧发出后断线得 `unknown-outcome` 再重取、密钥与请求头值不出现在任何远程响应与诊断 |
| 4 | 数据模块与页面组件；Lab | 3.5 | 组件 `*.dom.test.ts`；e2e：添加自定义服务商（本机端点）、设密钥与 `env:`、拉取并加入模型、补字段后启用、检测失败看原因、绑角色、停用被角色用的模型的确认、删除服务商与焦点、本作品标签下停用、窄窗口下拉、写失败通知；前端审查（Sonnet） |
| 5 | 接真实模型：`modelsKey.port()` 跑一轮（DeepSeek，`test:llm`）；收口 | — | `test:llm`；`test:affected`；全量 e2e |

切片 1 与切片 2、3 互不依赖，可以派编码子代理在独立 worktree 并行做切片 1。

## 6. 验收映射

| Spec | 覆盖 |
|---|---|
| `models/service.md` 配置与校验（id、完整性、目录漂移） | 切片 3 插件测试 |
| `models/service.md` 凭据（`apiKeyEnv`、替换、两个连接、权限诊断） | 切片 2 凭据库测试、切片 3 |
| `models/service.md` 解析表与失败码传播 | 切片 2 内核测试、切片 3 插件测试 |
| `models/service.md` 写入队列与并发 | 切片 3 两窗口真实 RPC |
| `models/service.md` 远程合同与 `unknown-outcome` | 切片 3 真实 RPC 断线 |
| `models/service.md` 遮盖与截断、检测与发现 | 切片 2 本机端点、切片 4 e2e |
| `models/service.md` 启动环境 | 切片 3 真实子进程 |
| `models/settings-pages.md` 各编号条目 | 切片 4 组件测试与 e2e（写 Spec 时逐条列测试名） |
| `harness/models.md`、`harness/runtime.md` 改动 | 切片 2 `omp.test.ts`、内核测试 |
| `settings/settings-window.md` 输出 1、3、14、19 | 切片 1、4 的 e2e |
| nb-ui 分档、嵌套、降级 | 切片 1 e2e 计算样式 |

## 7. 验证

- 端到端：`nbdev dev start` 起应用，设置窗口里添加本机的 OpenAI 兼容端点（测试用的假端点脚本）、拉取模型、检测、绑定 main；再用 DeepSeek（只经白名单从 `.env` 取 `DEEPSEEK_*`）检测一次真实模型；亮暗两态与窄窗口各看一遍。
- 未验证的边界：OAuth（不做）；Windows 上凭据库的文件权限（按 OMP 尽力而为）；macOS 等主题的分档取值（只改 nbook）。

## 8. 不做与风险

- 不做：OAuth 登录、发现方式（ollama、lm-studio 等专用协议）、兼容选项、扩展窗口、`!命令` 取值、阶梯价、代理、超时与重试设置、服务商启用开关、旧应用的专精种子与“快捷选择器显示专精”开关、Composer 的模型选择（t17）、nb-story 改用本插件（迁 nb-story 时做）、目录模型 id 改名的别名表、凭据库被外部工具修改时的热更新（要重启）。
- 风险：
  - 设 API Key 用 OMP 的替换语义，以后加 OAuth 时要改成按行更新。
  - 目录模型的单价与能力随 OMP 升级变；用户改过的字段按“只存差异”保留，引用消失的按目录漂移处理。
  - 写入只经服务端：服务端入口不可用时设置页只读。
