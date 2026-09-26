---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.component-lab
owners:
  - ui
---
## 背景

NeuroBook 主应用有大量 Vue 组件，验证它们的行为目前依赖散落的 preview 页面。这些页面混杂两类内容：一类可以用固定输入完整表达，另一类必须调用真实后端、真实模型或真实项目才能成立。Component Lab 将可由固定输入表达的部分集中到源码开发环境，用确定性场景观察组件行为与响应式边界。

Lab 是只存在于源码开发环境的组件检视入口。它提供组件导航、场景、画布、检查器和文档/事件/数据面板，但不取得产品数据所有权，也不替代正式界面验收。

组件自身的行为合同、能力标签与耦合约束由[`组件规范`](../../standards/code/components.md)定义，本规范不重复。

# NeuroBook Component Lab

## 目标与非目标

目标：

- 提供只存在于源码开发环境的组件检视入口，用固定输入观察组件行为与响应式边界。
- 把需要真实产品能力的场景挡在 Lab 之外，使 Lab 中的观察结果不受外部状态影响。
- 保证可分发产物不包含 Lab 代码、fixture 或开发路径信息。

非目标：

- Lab 不是产品功能，不面向最终用户，不是任何业务的正式入口。
- Lab 不替代正式界面验收、桌面冒烟测试、主题首帧验证或真实业务流程的窄屏验收。
- Lab 的导航、检视面板、组件索引、场景交互、检查器和界面偏好属于本能力的当前合同；组件自身的行为合同与能力标签仍由组件规范拥有。
- 本规范不定义产品主题 `theme.system` 的 clean cutover，也不定义 t09 的 `LabShell.vue` 拆分；Lab 使用 nb-ui 主题不代表主应用产品主题已迁移。

## 术语与参与者

- **源码开发环境**：从仓库源码启动的开发服务，可包含仅供开发验证的能力。
- **可分发产物**：构建输出的客户端、服务端或桌面安装包。
- **Lab**：源码开发环境专属的组件检视入口。
- **组件索引**：从产品组件和 Lab 零件的同名 Markdown 文档扫描得到的派生导航数据，不是人工维护的第二份清单。
- **fixture**：固定输入与交互场景。重复运行结果相同，不含真实用户数据，不产生真实产品副作用。
- **分层输入**：fixture 在登记入口显式声明的 `{props?, model?, slots?}` 调试输入。`model` 是 fixture 声明的 v-model 受控值，`props` 是 fixture 声明的非受控 prop，`slots` 是 fixture 自己提供的插槽预设开关；Lab 不从组件实现推导这些层。
- **调试声明**：`defineLabFixture<typeof C>` 对场景输入的编译期约束，加上 fixture 通过 `useLabSubject` 显式声明要记录的事件。声明描述 Lab 应展示什么，不替 fixture 负责把值接到组件。
- **登记门禁**：`fixtures/index.test.ts` 对每个场景检查非空 `input` 或有理由的 `noInput`，对分层 schema、JSON 无损往返和插槽预设关系做运行时检查；TypeScript 检查组件字段名、值类型、必填 prop 和 model 分层。
- **JSON 输入边界**：`LabJsonInput<T>` 在编译期递归保留可 JSON 化的 props/model/slots 字段，函数、Date、Set、Ref 等运行期能力不进入登记值；fixture 使用已有纯内存能力补齐最终组件必填 props，最终绑定由 Vue 类型检查。`noInput` 仅在投影后没有任何可登记 JSON prop 时成立，即使原组件有运行期必填能力也必须由 fixture 绑定；可选 JSON prop 不能借此豁免。

- **检查器**：对 Lab 页面 DOM 元素进行 hover 探针、点击选中、尺寸/组件/源文件/选择器展示和定位报告复制的开发工具。
- **确定性场景**：可以由 fixture 完整表达的场景，位置在 Lab。
- **真实行为场景**：必须在正式界面并使用真实产品边界验证的场景，不能用 fixture 替代。
- **产物门禁**：在构建流程中运行的检查，验证产物、路由与清单不含 Lab、fixture、开发路径或识别标记。
- **失败即拒绝**：失败时拒绝操作并报错，不静默降级为看似成功的结果。

## 输入与前置条件

Lab 入口只在源码开发环境下注册。构建、预览、安装包与运行时都不得通过环境变量或路由守卫隐藏一个实际已打包的 Lab；排除必须发生在构建图与路由生成阶段。

组件索引扫描产品组件与 Lab 零件目录中的同名 Markdown 文档，并要求对应的 `.vue` 实现存在。缺少文档或缺少同名 `.vue` 的条目不会进入索引，当前 Lab 不显示缺失占位；导航不得另维护一份手写组件清单。

fixture 不得要求凭据、网络、真实 Project/Session、Provider/Model 或浏览器持久化状态。表达错误分支与时间相关分支时使用固定输入，不伪造业务逻辑的成功结果。

组件能否在 Lab 中验证，由[`组件规范`](../../standards/code/components.md)的能力标签推导：含 `io:` 或 `state:shared-write` 的组件只能在正式界面验证；含 `persist:` 的组件因 fixture 不得依赖浏览器持久化而不能挂载；含 `state:shared-read` 且无阻断标签的组件只会被标记为“需预置状态快照”。当前 Lab 尚未提供状态快照注入或隔离机制，因此这类组件即使存在 fixture 也不构成可采信的确定性验证，迁移批次必须先把读取上移到宿主或另行实现并验证快照边界。文档声明 `验证入口` 的零件同样不可独立挂载：它们的 props 全部来自宿主链（`state:inject` / `env:portal` 描述的正是这件事），脱离宿主没有可验证状态——中栏给出不能独立验证的原因，以及一条直达宿主场景的入口，Lab 不为它们另造宿主。

组件树使用公开 string-id 合同：调用方传入和接收组件节点 id，不持有 Reka 内部节点对象。分组节点只负责展开/收起，不切换组件；搜索按组件名、文档显示名与 frontmatter 别名匹配（不搜正文），搜索时展开匹配分组，空结果文案说明可以按组件名、中文部件名或别名搜。

## 输出与可观察行为
- 进入 Lab 后，左侧显示按目录分组的组件树；组件索引包含可挂载和不可挂载条目。不可挂载条目可查询，但中栏显示不能在 Lab 验证的原因，不创建替代 fixture；声明了 `验证入口` 的零件，中栏的原因下方另给一条直达宿主场景的入口。行首图形按组件分类给，被别处声明为验证入口的集成入口另有独立图形，不与普通分类混同。
- 数据 tab 只展示 fixture 当前场景登记的层：已登记的 `model` 与 `props` 可编辑，已登记的 `slots` 预设可开关，另有 fixture 上报的只读「内部状态」。编辑结果须整份通过分层 schema 才生效，不合法时保持原值并说明原因。Lab 不显示组件实现签名、不生成签名问题清单、不为未声明层凭空增加编辑器；仅确实没有可编辑 JSON 输入的组件显示 `noInput` 理由。fixture 通过 `useLabSubject` 显式接入事件和 model 回写。
- 场景选择位于画布工具条。组件有多个 fixture 场景时切换场景直接替换组件，不插入空白退场阶段；场景切换和「还原输入」恢复登记初值并清空内部状态与事件日志。还原输入不承诺重置 fixture 私有 ref；只有场景切换的舞台 key 会重新挂载 fixture。
- 检查模式下 hover 显示不接收鼠标事件的虚线探针框和标签；点击后固定元素描述，切换到元素 tab，保留贴边标签但不绘制常驻整块边框。描述包含可用时的 Vue 组件名、包内相对源文件、选择器、尺寸和类名；可复制完整定位报告，按 Escape 退出探针。
- Lab 提供随窗口、手机和 tablet 三种画布容器；手机固定为 `390 × 844`，平板固定为 `768 × 1024`，并允许自由宽高。切换容器不改变 fixture 语义。
- Fixture 容器在声明最大宽度约束时必须携带 `mx-auto` 水平居中，陈列区使用 flex 居中，严禁靠左贴死导致视口失衡；Fixture 必须消费面板级语义材质变量（`var(--panel-surface)`、`var(--bg-panel)` 等），严禁在 Fixture 容器上硬编码页面顶层底色 `var(--bg-main)`，确保与舞台材质层级以及明暗主题对齐。典型夹具示范见 `packages/neuro-book/app/component-lab/fixtures/FixtureExampleFixture.vue` 与 `fixtures/README.md`。
- 运行中的视口从宽屏进入 `<=700px` 时，左右侧栏自动收起，把空间让给画布；从窄屏恢复宽屏不自动展开，保留使用者最后一次侧栏状态。侧栏宽度切换提供短时转场，`prefers-reduced-motion: reduce` 时关闭新增转场；场景切换不得制造空白退场阶段。
- 左侧组件树的选中行使用整行淡强调底、强调文字与中等字重，不绘制常驻左边框；Tree 的 `data-selected` / `aria-selected` 承载选择语义。
- 可分发产物中访问 Lab 路径得到正常的不存在结果，且构建图、文本与清单中不含 Lab 模块、fixture、绝对源码路径或识别标记。

## 状态与转换

本能力不引入产品侧持久状态。场景加载、动作执行、搜索、选中元素与事件日志都只存在于当前页面，不写入任何产品数据；Lab 自己的界面偏好是唯一例外，按本节的字段白名单保存在浏览器里。

组件切换时选择首个登记场景并加载对应 fixture；场景切换和数据还原将输入恢复为登记初值并清空内部状态与事件日志。fixture 输入、内部状态、搜索词、选中元素与事件日志不写入浏览器存储；当前组件、场景与检视 tab 属于界面偏好，按下一节的字段白名单持久化。

Lab 自身的界面偏好保存在本机浏览器：主题、配色、桌面背景、画布背景、缩放、画布宽高、桌面侧栏开合与当前检视 tab 写入版本化 localStorage 文档；自定义桌面壁纸 Blob 继续写入 Lab 专属 IndexedDB。窄屏自动收起只改变当前布局，不覆盖桌面侧栏偏好。界面提供“恢复 Lab 默认配置”清除小型偏好；壁纸由自定义图片旁的“清除”操作单独删除。

恢复偏好不改变 fixture 的初始输入、场景数据或事件。未知 schema、损坏 JSON、未知枚举与越界数值按字段拒绝并回退当前默认值，不阻止 Lab 打开。

## 副作用与数据

Lab 只读取版本控制内的组件声明与 fixture，并维护本地开发环境的界面状态。它不写产品用户配置、项目工作区、会话历史或业务数据库，也不访问真实网络服务。浏览器持久化只允许使用 Lab 专属 localStorage 键与 IndexedDB 库保存界面偏好，不得用于场景、fixture 或任何产品数据。

localStorage 文档键为 `nb-lab:preferences:v1`，schema 为 `1`；字段白名单为 `themeId`、`colorwayId`、`pageBackdropId`、`canvasBackdropId`、`canvasZoom`、`canvasWidth`、`canvasHeight`、`leftCollapsed`、`rightCollapsed`、`leftPanelWidth`、`rightPanelWidth`、`selectedComponentName`、`selectedSceneId`、`activeInspectTab`（检视 tab 取值 `doc`、`element`、`events`、`data`、`commands`）。画布尺寸只接受 `0..16384` 的整数，枚举值必须仍在当前登记表中。壁纸使用 IndexedDB `nb-lab` 数据库的 `prefs` store 与 `wallpaper` key。

fixture 使用脱敏的静态或内存数据，不调用真实 Provider/Model、真实接口，也不依赖跨场景共享的状态。fixture 通过 `useLabSubject` 接入分层输入与事件记录，通过 `useLabDataSink` 上报只读内部状态；Lab 在内存中最多保留最近 200 条事件。

产物排除是构建阶段的边界：源码开发环境注册 Lab，可分发产物既不注册也不打包。验收产生的截图与日志写入系统临时根，不进入仓库或产物。

## 失败与恢复

- fixture 尝试访问真实接口、持久化状态、Provider/Model 或产品凭据时失败即拒绝，该场景视为不合格，不替换为看似成功的结果。
- 缺少 Markdown 或缺少同名 `.vue` 的组件不会进入索引，当前没有缺失占位；已进入索引但被能力标签阻断、或声明了 `验证入口` 时，中栏显示不能独立验证的原因（后者另给一条直达宿主场景的入口），不伪造可交互场景；可挂载组件必须登记至少一个非空场景，缺档由 `fixtures/index.test.ts` 的覆盖门禁拦截，中栏的「没有场景」只作开发中间态回落，不是长期状态。
- localStorage 或 IndexedDB 不可用、超额、损坏或包含旧版本数据时，Lab 使用当前默认偏好继续运行；一项无效字段不使其它有效字段失效。恢复自定义桌面但壁纸 Blob 不存在时回退默认桌面，不自动弹出文件选择器。
- 构建图、路由、文本或清单中出现 Lab、fixture、开发绝对路径或识别标记时，产物门禁失败。不得用运行时不存在或路由守卫隐藏来判定通过。
- 响应式容器下出现页面级横向滚动、操作被遮挡或焦点无法恢复时，该场景保持未验收，不降低视口要求。
- Lab 失败不改变产品数据。恢复方式是修正 fixture、组件声明或组件实现后重新加载，不创建第二个 Lab 入口。
## 边界与兼容

确定性场景与真实行为场景的边界是强约束。执行真实 Provider、Model、Session、Project 或业务写入的行为必须留在正式界面；Lab 只承载 fixture。一个场景不能因为在 Lab 中更容易演示，就被改写成 fixture。

组件的行为合同、能力标签与耦合约束由[`组件规范`](../../standards/code/components.md)拥有，Lab 不建立第二套组件分类。各产品领域拥有正式界面及其接口、项目、会话、共享状态与持久化语义，Lab 不取得任何产品数据的所有权。

Lab 消费的组件索引是派生产物，由扫描同名 Markdown 与 Vue 实现生成；缺少任一侧的条目被跳过。组件名、文档第一条 H1 派生出的显示名、frontmatter 别名、分组、能力标签、挂载结论和阻断原因来自文档与标签推导；场景由 fixture 按组件名关联，仓库不保留第二份组件或场景索引。`needsSnapshot` 当前只是索引标记，不代表 Lab 已提供或验证状态快照。

Lab 的主题/配色仅是开发工具自身的界面状态，写入 Lab 专属浏览器存储，不改变产品 `theme.system`、Global Config 或产品主题 authority。产品主题 clean cutover 属于 w00003 的后续 C 切片；t09 `LabShell.vue` 拆分已延期且不由本规范宣称完成。

Lab 落地本身不授权删除任何既有的 preview 页面。既有 preview 的清退条件、组件迁移进度与场景归属属于对应的重构工作，不属于本规范。
## 验收与 Smoke

1. Given Source Dev 服务，When 打开 `/lab`，Then 显示按组的组件树、当前组件画布和 `文档`、`元素`、`事件`、`数据`、`命令` 五个可切换 tab。
2. Given 组件索引中的可挂载项，When 选择组件并切换已登记场景，Then fixture 被挂载，场景直接替换，数据 tab 分层展示可编辑输入并可还原，重复打开或还原后初始输入与可观察状态一致。
3. Given 缺少组件文档或同名 `.vue` 的条目，When 生成组件索引，Then 该条目不出现在导航；Given 已入索引但带阻断标签的组件，When 选择它，Then 中栏显示不能挂载的原因，不挂载替代 fixture；Given 声明了 `验证入口` 的零件，When 选择它，Then 中栏给出原因与一条直达宿主场景的入口，且不加载独立场景；Given 仓库中的可挂载组件，When 运行 `fixtures/index.test.ts`，Then 缺少非空场景或 loader 即失败。
4. Given 含 `state:shared-read` 且没有其它阻断标签的组件，When Lab 将其标记为需状态快照，Then 在快照注入机制实现并验证前，不得把它在 Lab 中挂载成功写成确定性验证通过。
5. Given 检查模式，When hover 或点击 Lab 元素，Then hover 有虚线探针，点击后元素 tab 显示可复制定位报告，选中元素不绘制常驻整块边框，Escape 可退出检查。
6. Given 手机与平板容器，When 分别切换到 `390 × 844` 与 `768 × 1024`，Then 场景语义不变，核心操作可完成，无页面级横向滚动或控件相互遮挡。
7. Given 运行中的 Lab 从宽屏调整到 `<=700px`，When 进入窄屏再恢复宽屏，Then 两侧栏自动收起且不会自动重新展开；reduced-motion 下新增转场时长为零。
8. Given 已修改主题、配色、画布与侧栏偏好，When 刷新或重新进入 Lab，Then 合法偏好恢复；窄屏自动收起不覆盖桌面侧栏偏好；执行“恢复 Lab 默认配置”后 localStorage 偏好键消失且界面回到当前默认值。
9. Given localStorage 中存在损坏 JSON、未知 schema、未知枚举或越界尺寸，When Lab 加载，Then 无效值被拒绝、有效字段仍恢复、fixture 初始输入不变且页面可继续使用。
10. Given Product 构建，When 检查路由、模块图、文本与清单，Then 不存在 Lab 模块、fixture、开发绝对路径或识别标记，访问 Lab 路径为不存在。
11. Given 带 frontmatter 别名的部件文档，When 在导航检索里输入组件名、文档显示名或中文/英文别名，Then 都能命中同一个 canonical 条目；没有别名的组件只按组件名与显示名匹配，别名写坏时给开发诊断且不影响其余条目。
12. Given fixture 通过类型化登记声明分层输入，When 打开数据 tab，Then 只显示声明过的层；When fixture 声明的 model 对应 update 事件发生，Then 事件 tab 记录它且数据 tab 的 model 值通过输入 sink 更新。Given 场景缺 input 且无合法 noInput，Then `fixtures/index.test.ts` 报出组件与场景；Given 登记键名、值类型、必填 prop 或层级错误，Then `nuxt typecheck` 报错。Lab 不读取组件运行时签名。

## 实现合同

- **owner**：`packages/neuro-book/app/component-lab/` 持有 Lab 页面状态、fixture 关联、检查器与界面偏好；`packages/nb-ui` 持有被消费的通用 Tree、Tabs、表单等公共组件合同；产品组件自身继续由各领域 owner 持有。
- **索引边界**：`component-index.ts` 扫描同名 Markdown 与 Vue 模块，只收录两者同时存在的条目，解析能力标签、可选别名与可选 `验证入口`、从文档第一条 H1 派生显示名，并推导 `mountable`、`blockedReason`、`verifyEntry`、`integrationEntry`、`needsSnapshot`。检索按组件名、显示名与别名匹配（不搜正文）；`fixtures/` 登记场景、显式分层输入、插槽预设名、类型化 fixture loader；不从组件实现生成 props/emits/slots 数据。
- **输入边界**：`lab-subject.ts` 持有分层 schema、`LabJsonInput<T>` 投影、`LabInputOf<C>` 类型约束和 `useLabSubject` 接入 API；`fixtures/index.ts` 的 `defineLabFixture<typeof C>` 是唯一类型化登记入口。LabShell 只做编辑值的 JSON 形状校验，不读取运行时组件签名。函数/服务/Date/Set 等运行期 props 由 fixture 固定接线；它们不是第四种调试输入，也不削弱组件实际必填 props 的 Vue 模板类型检查。
- **状态与持久化边界**：LabShell 持有页面编排和当前状态；`useLabPreferences` 与 `lab-preferences-store` 只负责 Lab 界面偏好的校验、恢复、保存、重置和 fail-open；`lab-wallpaper-store` 只负责 Lab 壁纸 Blob。产品主题、Global Config 和业务数据不由 Lab 持有。
- **关键不变量**：Product 构建通过 `pages:extend` 在路由生成阶段移除 `/lab`，使仅由 Lab 引用的模块不可达；Tree 对外维持 string-id，Reka 节点对象不泄漏；场景切换/还原不改变 fixture 初始合同；存储异常不阻断 Lab 打开。
- **验证入口**：Lab 偏好 store/composable 与 HighlightBox 合同测试、NeuroBook Component Lab 测试、nb-ui Tree 回归测试，以及真实 NeuroBook `/lab` smoke。当前 t09 文件拆分、产品 `theme.system` clean cutover 和渐进组件迁移不属于本实现合同。

## 证据

- 实现入口：[`component-index.ts`](../../../packages/neuro-book/app/component-lab/component-index.ts)
- 合同测试：[`component-index.test.ts`](../../../packages/neuro-book/app/component-lab/component-index.test.ts)
- Smoke：[`component-lab.ts`](../../../packages/neuro-book/scripts/smoke/component-lab.ts)（`bun run smoke:component-lab:core`）
- 批准与范围依据：[`w00003 NeuroBook UI Foundation Migration`](../../../.agents/works/w00003-neurobook-ui-foundation-migration/README.md)、t05 Component Lab 任务与 t07/t10/t11 交付记录。t09 的 `LabShell.vue` 拆分已延期；产品主题 `theme.system` clean cutover 和渐进组件迁移仍是后续 Work 切片。
- 分层 smoke 入口：`smoke:component-lab:core` 只验证 Lab 壳、通用场景、偏好与响应式；`smoke:component-lab:agent-profile` 只验证 Agent Profile 导航和 DialogWindow；`smoke:component-lab` 保留完整组合验证。分层入口共享同一 Node + Playwright runner 和失败截图机制，避免无关场景失败阻断目标组件证据。
- 真实 NeuroBook smoke：`bun run smoke:component-lab:core -- --url http://127.0.0.1:3000 --browser-executable <chromium>` 与 `bun run smoke:component-lab:agent-profile -- --url http://127.0.0.1:3000 --browser-executable <chromium>`；完整组合入口仍为 `bun run smoke:component-lab -- --url http://127.0.0.1:3000 --browser-executable <chromium>`。
- Product 排除证据：t05/t06 walkthrough 记录真实 `NODE_ENV=production bun x nuxt build` 后的产物全文与路由表检查，Lab 模块、fixture、开发路径和 `/lab` 均无命中；同一产物的正式路由命中证明扫描方法有效。该机制后续未被 t07–t11 改动，当前 Spec 不把未在 `17f8197eb73851645d0ffb04dcd51057bb098b66` 重跑的完整 Product build 写成最新验证。
- 当前未完成范围：t09 `LabShell.vue <800` 仍延期；产品主题 `theme.system` clean cutover 尚未开始；nb-ui 全量 E2E 仍有 17 项既有失败；本次合并的隔离运行验收与人工视觉验收未执行。
- 本轮分层输入迁移覆盖全部 132 个可挂载组件、468 个场景；登记统一使用 `{props?, model?, slots?}`，无可编辑 JSON 输入的三个组件声明 `noInput` 理由。运行时能力留在 fixture 内存中，不写入 JSON 场景；治理分支的静态检查与行为证据记录在治理 Work 的 t06 Task 快照，未执行的当前 `master` 浏览器验收不计入证据。
