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
- 本规范不定义产品主题 `theme.system` 的 clean cutover；Lab 使用 nb-ui 主题不代表主应用产品主题已迁移。

## 术语与参与者

- **源码开发环境**：从仓库源码启动的开发服务，可包含仅供开发验证的能力。
- **可分发产物**：构建输出的客户端、服务端或桌面安装包。
- **Lab**：源码开发环境专属的组件检视入口。
- **组件索引**：从产品组件、Lab 零件与 nb-ui 组件的同名 Markdown 文档扫描得到的派生导航数据，不是人工维护的第二份清单。
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

Lab 是开发清单里的内置插件 `nbook.lab`，只有开发入口装配它：后端的开发入口（`bun run dev` 启动的后端）把它列进引导集合，前端只在开发构建里加载它的浏览器入口；它向工作台的页面贡献点交出 `/lab` 页面（[`runtime.browser-host`](../runtime/browser-host.md)）。生产构建的两个入口都不引用它。构建、预览与运行时都不得通过环境变量或路由守卫隐藏一个实际已打包的 Lab；排除发生在构建图阶段。

组件索引扫描共享前端组件（`src/ui/`）与各插件界面组件目录（`src/plugins/<插件>/web/components/`，含 Lab 自己的零件）中的同名 Markdown 文档，并要求对应的 `.vue` 实现存在。缺少文档或缺少同名 `.vue` 的条目不会进入索引，当前 Lab 不显示缺失占位；导航不得另维护一份手写组件清单。

nb-ui 的组件经它的公开入口 `@notnotype/nb-ui/lab-sources` 进入同一索引，归在 `nb-ui` 组下，按同样的规则收录与推导挂载结论。组件名在全部来源中唯一：重名时只收按逻辑路径排序在后的一个，另一个不进索引并给开发诊断。`lab-sources` 只供 Lab 引用，产品代码不引用它。

fixture 不得要求凭据、网络、真实 Project/Session、Provider/Model 或浏览器持久化状态。表达错误分支与时间相关分支时使用固定输入，不伪造业务逻辑的成功结果。

组件能否在 Lab 中验证，由[`组件规范`](../../standards/code/components.md)的能力标签推导：含 `io:` 或 `state:shared-write` 的组件只能在正式界面验证；含 `persist:` 的组件因 fixture 不得依赖浏览器持久化而不能挂载；含 `state:shared-read` 且无阻断标签的组件只会被标记为“需预置状态快照”。当前 Lab 尚未提供状态快照注入或隔离机制，因此这类组件即使存在 fixture 也不构成可采信的确定性验证，迁移批次必须先把读取上移到宿主或另行实现并验证快照边界。文档声明 `验证入口` 的零件同样不可独立挂载：它们的 props 全部来自宿主链（`state:inject` / `env:portal` 描述的正是这件事），脱离宿主没有可验证状态——中栏给出不能独立验证的原因，以及一条直达宿主场景的入口，Lab 不为它们另造宿主。

组件树使用公开 string-id 合同：调用方传入和接收组件节点 id，不持有 Reka 内部节点对象。分组节点只负责展开/收起，不切换组件；搜索按组件名、文档显示名与 frontmatter 别名匹配（不搜正文），搜索时展开匹配分组，空结果文案说明可以按组件名、中文部件名或别名搜。

## 输出与可观察行为
- 进入 Lab 后，左侧显示按目录分组的组件树；组件索引包含可挂载和不可挂载条目。不可挂载条目可查询，但中栏显示不能在 Lab 验证的原因，不创建替代 fixture；声明了 `验证入口` 的零件，中栏的原因下方另给一条直达宿主场景的入口。行首图形按组件分类给，被别处声明为验证入口的集成入口另有独立图形，不与普通分类混同。
- 右侧检视面板固定提供四个 tab：`文档`、`元素`、`事件`、`数据`。文档 tab 展示能力标签、挂载结论和同名组件文档；事件 tab 展示当前会话事件并可清空。
- 检视面板另有第五个 tab `变量`：覆盖当前主题的设计变量，覆盖只作用于 Lab 页面，可导出与导入覆盖集，可一键清除；覆盖不写进偏好，刷新后消失。元素 tab 对选中元素另给结构检查：ARIA 角色、名称与状态，以及尺寸、字号、颜色等计算样式读数。（planned）
- 数据 tab 只展示 fixture 当前场景登记的层：已登记的 `model` 与 `props` 可编辑，已登记的 `slots` 预设可开关，另有 fixture 上报的只读「内部状态」。编辑结果须整份通过分层 schema 才生效，不合法时保持原值并说明原因。Lab 不显示组件实现签名、不生成签名问题清单、不为未声明层凭空增加编辑器；仅确实没有可编辑 JSON 输入的组件显示 `noInput` 理由。fixture 通过 `useLabSubject` 显式接入事件和 model 回写。
- Lab 外壳不持有命令注册表、键位监听、命令面板或确认框。需要命令的场景（现在是 `WorkbenchCommandPalette`，以后的编辑器场景同理）自己创建局部命令宿主（本地命令表、面板、键位与确认框），宿主与场景同寿：切换组件或场景即释放注册、键位监听与未决确认（未决确认按拒绝结算），其它场景按 `Ctrl/Cmd+Shift+P` 不打开任何面板。命令场景的只读检视（上下文键、命令可用性与 expose、最近一次执行失败）放在场景控制抽屉，执行记录作为 `command` 事件进入事件 tab。
- `/lab` 与产品页走同一条窗口启动序列（[`runtime.browser-host`](../runtime/browser-host.md)）：先取引导集合、建立窗口运行实例，再挂载页面，所以加载时的 `/api/` 请求只有浏览器引导接口一个；Lab 页面与 fixture 不读写产品数据、不发其它接口请求。加载鉴权插件时 Lab 页同样受鉴权约束（壳子阶段不加载鉴权）。Lab 页面声明“离开时整页加载”：从 Lab 经应用内导航去别的页面时整页加载，Lab 写在文档上的主题与全局监听随文档一起消失，产品页面在新文档里完整启动；从产品页进入 Lab 是应用内导航。
- 场景选择位于画布工具条。组件有多个 fixture 场景时切换场景直接替换组件，不插入空白退场阶段；场景切换和「还原输入」恢复登记初值并清空内部状态与事件日志。还原输入不承诺重置 fixture 私有 ref；只有场景切换的舞台 key 会重新挂载 fixture。
- 检查模式下 hover 显示不接收鼠标事件的虚线探针框和标签；点击后固定元素描述，切换到元素 tab，保留贴边标签但不绘制常驻整块边框。描述包含可用时的 Vue 组件名、包内相对源文件、选择器、尺寸和类名；可复制完整定位报告，按 Escape 退出探针。
- Lab 提供随窗口、手机和 tablet 三种画布容器；手机固定为 `390 × 844`，平板固定为 `768 × 1024`，并允许自由宽高。切换容器不改变 fixture 语义。
- 地址栏参数可直接指定打开状态：`c` 组件、`s` 场景、`vp` 画布（`phone`、`tablet`、`free` 或 `宽x高`，单边不超过 16384）、`cw` 配色（配色 id，或 `light`、`dark` 取第一套外观相符的配色）、`theme` 主题。合法的参数优先于已保存的偏好，效果等同于在界面上选中它们，因此会随之写入偏好；不认识或越界的参数被忽略，其余参数照常生效。
- 地址栏就是标签页的会话状态：除上面的参数外另有 `zoom` 缩放与 `tab` 检视页签（`doc`、`element`、`events`、`data`、`variables`）。`c`、`s`、`vp`、`zoom`、`tab` 只在地址栏，不写入偏好；`cw` 与 `theme` 仍随之写入偏好。在界面上切组件新增一条历史记录，浏览器后退回到上一个组件；切场景、画布、缩放与页签替换当前记录。地址栏、宿主路由的当前路由与 Lab 的状态始终一致，离开 Lab 时按当前地址整页加载。不认识的查询参数原样保留，旧参数名 `component`、`scene` 读到后改写为 `c`、`s`。工具条的“复制场景链接”复制只含有效参数的规范地址；地址里的场景不存在而回落到首个场景时，给一条可见提示。（planned）
- 舞台（当前场景 fixture 的挂载容器）带稳定标记 `data-lab-stage`。页面暴露只读调试接口 `window.__nbLab`：`state()` 返回当前组件、场景、fixture 是否已挂载就绪、加载错误、画布尺寸、主题与配色；`scenes(component?)` 返回登记的场景；`components()` 返回登记了场景且可以挂载的组件名，按组件树的顺序；`measure()` 返回舞台位置、舞台内容的横向溢出像素，以及越出舞台左右边缘且没有被任何横向裁剪或滚动容器挡住的元素（最多 20 个，带检查器同款选择器与所属组件名）。接口不提供写操作，改状态只走地址栏参数。
- 开发命令 `lab:shot` 按组件、场景（缺省为全部）、画布尺寸与配色的组合逐一打开 Lab 并截取舞台，输出每张截图的溢出测量与期间的页面错误、控制台错误和警告，并写一份 JSON 报告；任一组合有溢出、越界元素或页面问题时以非零退出，`--no-fail` 可改为只报告。它只依赖地址栏参数、`data-lab-stage` 与 `window.__nbLab`，不点击 Lab 外壳的控件。
- Fixture 容器在声明最大宽度约束时必须携带 `mx-auto` 水平居中，陈列区使用 flex 居中，严禁靠左贴死导致视口失衡；Fixture 必须消费面板级语义材质变量（`var(--panel-surface)`、`var(--bg-panel)` 等），严禁在 Fixture 容器上硬编码页面顶层底色 `var(--bg-main)`，确保与舞台材质层级以及明暗主题对齐。典型夹具示范见 `packages/neuro-book/src/plugins/lab/web/fixtures/FixtureExampleFixture.vue` 与同目录的 `README.md`。
- 运行中的视口从宽屏进入 `<=700px` 时，左右侧栏自动收起，把空间让给画布；从窄屏恢复宽屏不自动展开，保留使用者最后一次侧栏状态。侧栏宽度切换提供短时转场，`prefers-reduced-motion: reduce` 时关闭新增转场；场景切换不得制造空白退场阶段。
- 画布是场景浮层的定位容器：传送到页面根上的浮层（对话框、抽屉、快速输入等）落在画布里，按画布居中与裁剪，手机画布上看到的就是手机宽度下的浮层。（planned）
- 左侧组件树的选中行使用整行淡强调底、强调文字与中等字重，不绘制常驻左边框；Tree 的 `data-selected` / `aria-selected` 承载选择语义。
- 可分发产物中访问 Lab 路径得到前端的“页面不存在”页（服务端按页面路径回退给外壳，不知道前端有哪些页面），且构建产物的文本中不含 Lab 模块、fixture、本机源码路径或识别标记。

## 状态与转换

本能力不引入产品侧持久状态。场景加载、动作执行、搜索、选中元素与事件日志都只存在于当前页面，不写入任何产品数据；Lab 自己的界面偏好是唯一例外，按本节的字段白名单保存在 `nbook.storage` 的一条记录里（planned）。

组件切换时选择首个登记场景并加载对应 fixture；场景切换和数据还原将输入恢复为登记初值并清空内部状态与事件日志。fixture 输入、内部状态、搜索词、选中元素与事件日志不持久化；当前组件、场景、检视 tab、缩放与画布尺寸属于本标签页的会话状态，只在地址栏（planned）。

Lab 自身的界面偏好是 `nbook.storage` 的记录 `lab.preferences`（user 分区、`shared`、版本 1，[`storage.persistence`](../storage/persistence.md)），经 Lab 的 store 读写（[`state.store`](../state/store.md)）。用 `shared` 是因为客户端身份按浏览器来源分开，换端口的开发服务读到的仍是同一份偏好。主题、配色、背景这类离散选择立即保存；拖动侧栏宽度或画布尺寸时只改显示，松手才保存。保存暂停（确定失败或结果未知）期间的修改只改显示，恢复后只提交最后一份。窄屏自动收起只改变当前布局，不覆盖桌面侧栏偏好。自定义桌面壁纸 Blob 仍写入 Lab 专属 IndexedDB，按浏览器来源各存一份。界面提供“恢复 Lab 默认配置”，把记录写成空对象（记录里没有的字段就是默认值）；壁纸由自定义图片旁的“清除”操作单独删除。（planned）

偏好由记录的状态推出唯一一种呈现（planned）：

| 记录状态 | 呈现 | 可做的操作 |
|---|---|---|
| 尚未读到结果 | 外壳只显示占位，不先用默认主题画一帧 | 无 |
| 打开或读取失败 | 用默认值运行，工具条提示偏好没能读取与失败码 | 重试读取 |
| 记录损坏或版本不认识 | 用默认值运行，提示记录损坏或版本不认识、不会覆盖 | 恢复默认（覆盖原记录，原件由 Storage 保留） |
| 保存失败或结果未知 | 显示修改后的值，提示没保存上与失败码 | 重试、放弃修改 |
| 其余 | 不提示，保存成功也不弹通知 | 无 |

恢复偏好不改变 fixture 的初始输入、场景数据或事件。记录的结构由 schema 检查；主题、配色、背景是否在当前已安装的目录里，读取后逐字段核对，不认识或越界的字段回到默认值，其它字段照常生效，不阻止 Lab 打开。

## 副作用与数据

Lab 只读取版本控制内的组件声明与 fixture，并维护本地开发环境的界面状态。它不写产品用户配置、项目工作区、会话历史或业务数据库，也不访问真实网络服务。Lab 的界面偏好只写 `nbook.storage` 的 `lab.preferences` 一条记录；浏览器存储只剩 Lab 专属 IndexedDB 里的壁纸，不得用于场景、fixture 或任何产品数据。（planned）

偏好的字段白名单为 `themeId`、`colorwayId`、`pageBackdropId`、`canvasBackdropId`、`leftCollapsed`、`rightCollapsed`、`leftPanelWidth`、`rightPanelWidth`；会话状态（组件、场景、画布、缩放、检视 tab）不进偏好。恢复顺序是“地址参数 > 偏好 > 默认”。画布尺寸只接受 `0..16384` 的整数，枚举值必须仍在当前登记表中。壁纸使用 IndexedDB `nb-lab` 数据库的 `prefs` store 与 `wallpaper` key。（planned）

fixture 使用脱敏的静态或内存数据，不调用真实 Provider/Model、真实接口，也不依赖跨场景共享的状态。fixture 通过 `useLabSubject` 接入分层输入与事件记录，通过 `useLabDataSink` 上报只读内部状态；Lab 在内存中最多保留最近 200 条事件。

产物排除是构建阶段的边界：开发入口装配 Lab，产品入口不引用，可分发产物既不装配也不打包；`bun run build` 的最后一步 `check:dist` 检查产物。验收产生的截图与日志写入系统临时根，不进入仓库或产物。

## 失败与恢复

- fixture 尝试访问真实接口、持久化状态、Provider/Model 或产品凭据时失败即拒绝，该场景视为不合格，不替换为看似成功的结果。
- 缺少 Markdown 或缺少同名 `.vue` 的组件不会进入索引，当前没有缺失占位；已进入索引但被能力标签阻断、或声明了 `验证入口` 时，中栏显示不能独立验证的原因（后者另给一条直达宿主场景的入口），不伪造可交互场景；可挂载组件必须登记至少一个非空场景，缺档由 `fixtures/index.dom.test.ts` 的覆盖门禁拦截，中栏的「没有场景」只作开发中间态回落，不是长期状态。
- 偏好记录读取失败、损坏或版本不认识时，Lab 用默认值继续运行并按“状态与转换”的表给出提示与操作；保存失败或结果未知时保留修改后的显示，由使用者重试或放弃；一项无效字段不使其它有效字段失效。IndexedDB 不可用或恢复自定义桌面但壁纸 Blob 不存在时回退默认桌面，不自动弹出文件选择器。（planned）
- 构建产物的文本中出现 Lab、fixture、本机绝对路径或识别标记时，产物门禁（`check:dist`）失败，构建失败。门禁同时要求产物里有产品自己的标记，扫描读错目录不会误判通过。不得用运行时不存在或路由守卫隐藏来判定通过。
- 响应式容器下出现页面级横向滚动、操作被遮挡或焦点无法恢复时，该场景保持未验收，不降低视口要求。
- Lab 失败不改变产品数据。恢复方式是修正 fixture、组件声明或组件实现后重新加载，不创建第二个 Lab 入口。
## 边界与兼容

确定性场景与真实行为场景的边界是强约束。执行真实 Provider、Model、Session、Project 或业务写入的行为必须留在正式界面；Lab 只承载 fixture。一个场景不能因为在 Lab 中更容易演示，就被改写成 fixture。

组件的行为合同、能力标签与耦合约束由[`组件规范`](../../standards/code/components.md)拥有，Lab 不建立第二套组件分类。各产品领域拥有正式界面及其接口、项目、会话、共享状态与持久化语义，Lab 不取得任何产品数据的所有权。

Lab 消费的组件索引是派生产物，由扫描同名 Markdown 与 Vue 实现生成；缺少任一侧的条目被跳过。组件名、文档第一条 H1 派生出的显示名、frontmatter 别名、分组、能力标签、挂载结论和阻断原因来自文档与标签推导；场景由 fixture 按组件名关联，仓库不保留第二份组件或场景索引。`needsSnapshot` 当前只是索引标记，不代表 Lab 已提供或验证状态快照。

Lab 的主题/配色仅是开发工具自身的界面状态，写入 Lab 专属浏览器存储，不改变产品 `theme.system`、Global Config 或产品主题 authority。新应用的产品主题由工作台页面按配置（`nbook.workbench/theme`、`nbook.workbench/appearance`）写在文档根（[`theme.system`](../theme/system.md)），Lab 不读这两项，离开 Lab 整页加载后由产品页重新应用。

Lab 落地本身不授权删除任何既有的 preview 页面。既有 preview 的清退条件、组件迁移进度与场景归属属于对应的重构工作，不属于本规范。
## 验收与 Smoke

1. Given 开发模式（`bun run dev`），When 打开 `/lab`，Then 显示按组的组件树、当前组件画布和 `文档`、`元素`、`事件`、`数据` 四个可切换 tab；加载时的 `/api/` 请求只有浏览器引导接口一个；localStorage 只有窗口的客户端身份，sessionStorage 为空（planned）。
2. Given 组件索引中的可挂载项，When 选择组件并切换已登记场景，Then fixture 被挂载，场景直接替换，数据 tab 分层展示可编辑输入并可还原，重复打开或还原后初始输入与可观察状态一致。
3. Given 缺少组件文档或同名 `.vue` 的条目，When 生成组件索引，Then 该条目不出现在导航；Given 已入索引但带阻断标签的组件，When 选择它，Then 中栏显示不能挂载的原因，不挂载替代 fixture；Given 声明了 `验证入口` 的零件，When 选择它，Then 中栏给出原因与一条直达宿主场景的入口，且不加载独立场景；Given 仓库中的可挂载组件，When 运行 `fixtures/index.dom.test.ts`，Then 缺少非空场景或 loader 即失败。
4. Given 含 `state:shared-read` 且没有其它阻断标签的组件，When Lab 将其标记为需状态快照，Then 在快照注入机制实现并验证前，不得把它在 Lab 中挂载成功写成确定性验证通过。
5. Given 检查模式，When hover 或点击 Lab 元素，Then hover 有虚线探针，点击后元素 tab 显示可复制定位报告，选中元素不绘制常驻整块边框，Escape 可退出检查。
6. Given 手机与平板容器，When 分别切换到 `390 × 844` 与 `768 × 1024`，Then 场景语义不变，核心操作可完成，无页面级横向滚动或控件相互遮挡。
7. Given 运行中的 Lab 从宽屏调整到 `<=700px`，When 进入窄屏再恢复宽屏，Then 两侧栏自动收起且不会自动重新展开；reduced-motion 下新增转场时长为零。
8. Given 已修改主题、配色、背景与侧栏偏好，When 刷新或重新进入 Lab，Then 合法偏好恢复；When 打开第二个 Lab 窗口，Then 读到同一份偏好；窄屏自动收起不覆盖桌面侧栏偏好；执行“恢复 Lab 默认配置”后记录是空对象且界面回到当前默认值。（planned）
9. Given 偏好记录里有不认识的主题 id 或越界宽度，When Lab 加载，Then 只有这些字段回到默认值，其它字段恢复；Given 记录损坏或版本不认识、读取失败、保存失败或结果未知，Then 呈现与操作符合“状态与转换”的表，保存暂停期间的多次修改恢复后只提交最后一份；fixture 初始输入不变且页面可继续使用。（planned）
10. Given 生产构建，When 运行 `check:dist`，Then 产物文本中不存在 Lab 模块、fixture、本机绝对路径或识别标记；When 访问 Lab 路径，Then 窗口照常就绪并显示“页面不存在”。
11. Given 带 frontmatter 别名的部件文档，When 在导航检索里输入组件名、文档显示名或中文/英文别名，Then 都能命中同一个 canonical 条目；没有别名的组件只按组件名与显示名匹配，别名写坏时给开发诊断且不影响其余条目。
12. Given fixture 通过类型化登记声明分层输入，When 打开数据 tab，Then 只显示声明过的层；When fixture 声明的 model 对应 update 事件发生，Then 事件 tab 记录它且数据 tab 的 model 值通过输入 sink 更新。Given 场景缺 input 且无合法 noInput，Then `fixtures/index.dom.test.ts` 报出组件与场景；Given 登记键名、值类型、必填 prop 或层级错误，Then `bun run typecheck` 报错。Lab 不读取组件运行时签名。
13. Given 地址 `/lab?c=<组件>&s=<场景>&vp=phone&cw=light`，When 打开，Then 直接显示该场景、画布为 `390 × 844`、配色为浅色，且 `window.__nbLab.state().ready` 在 fixture 挂载后为 true；Given `vp=wide` 或不存在的配色，Then 该参数被忽略，其余参数照常生效；Given 地址另带 `zoom` 与 `tab=data`，Then 缩放与检视页签按参数打开，切场景后刷新仍停在原处（planned）。
14. Given 舞台内有一个比舞台宽的元素和一个放在横向滚动容器里的长行，When 调用 `window.__nbLab.measure()`，Then 只报前者及其越界像素；When 对该组件运行 `lab:shot`，Then 每个组合产出一张舞台截图与报告条目，存在越界时命令以非零退出。
15. Given 只需绑定场景输入、记录事件、回写受控输入和补运行期 props 的零件，When 用 `defineSubjectFixture` 登记，Then 不需要单独的 fixture `.vue`，场景输入的类型检查与 `defineLabFixture<typeof C>` 相同，数据面板与事件面板行为与手写 fixture 一致。
16. Given `WorkbenchCommandPalette` 场景与真实的编辑器样板（Monaco 随第 5 步的编辑器插件迁入前，是 textarea 实现的最小编辑器，提供聚焦、撤销、重做与行号跳转），When 按 `Ctrl/Cmd+Shift+P` 打开再按 Escape 关闭，Then 打开中的面板是受检零件、执行记录进入事件 tab；When 切到其它组件再按同一快捷键，Then 不打开任何面板，也不残留命令检视。
17. Given 已加载的 Lab 文档，When 经应用内路由进入产品页，Then 发生整页加载，不在 Lab 文档中渲染产品页。
18. Given nb-ui 的组件文档，When 打开 Lab，Then 它们出现在 `nb-ui` 组下，可挂载的组件能选中并挂载登记的场景；Given 两个来源有同名组件，Then 只收一个并给开发诊断。
19. Given 全部登记场景，When 在手机画布上逐个打开，Then 每个都挂载就绪，没有加载失败、页面错误与控制台警告。
20. Given 两个 `/lab` 窗口，When 一个改主题、另一个同时改侧栏宽度，Then 两项都保存下来，刷新后两个窗口一致。（planned）
21. Given 在 Lab 里先后选中组件 A、B，When 按浏览器后退再从 Lab 进入产品页，Then 后退回到 A，地址栏、宿主路由的当前路由与整页加载的目标三者一致。（planned）
22. Given 同一状态根先后用两个端口启动开发服务，When 各自打开 Lab，Then 偏好相同。（planned）
23. Given 变量 tab 覆盖了一个设计变量，When 导出再清除、导入，Then 覆盖依次生效、消失、再生效；When 刷新，Then 覆盖消失。Given 元素 tab 选中一个按钮，Then 显示它的 ARIA 角色、名称与计算样式读数。（planned）
24. Given 对话框类组件的场景，When 在手机画布上打开，Then 浮层落在画布里并按画布居中，不越出画布。（planned）

## 实现合同

- **owner**：`packages/neuro-book/src/plugins/lab/`（开发插件 `nbook.lab`）持有 Lab 页面状态、fixture 关联、检查器与界面偏好；`packages/nb-ui` 持有被消费的通用 Tree、Tabs、表单等公共组件合同；共享前端组件在 `src/ui/`，各插件的界面组件在插件的 `web/components/`，产品组件自身继续由各领域 owner 持有。
- **装配边界**：开发清单 `src/development-manifest.ts` 只由后端开发入口 `src/server/development-main.ts` 与前端的 `src/web/development-plugins.ts`（`main.ts` 只在 `import.meta.env.DEV` 分支里动态加载）引用；`web/plugin.ts` 向 `workbench.pages` 贡献 `/lab`（`reloadOnLeave`），页面组件 `LabPage.vue` 按需加载。依赖方向由 `src/architecture.test.ts` 守住，产物由 `scripts/check-dist.ts`（`check:dist`）检查。插件之间只以 `import type` 互相引用，唯一的例外是 Lab 的场景（`web/fixtures/`）：它们可以在运行时引用其它插件的 `web/` 与 `shared/`，用来挂载那些插件的组件、建场景自己的局部宿主；Lab 只在开发模式加载，例外不进产品。
- **索引边界**：`component-index-model.ts` 的 `buildLabIndex` 是纯函数：按逻辑路径排序收录同名 Markdown 与 Vue 模块同时存在的条目，解析能力标签、可选别名与可选 `验证入口`、从文档第一条 H1 派生显示名，并推导 `mountable`、`blockedReason`、`verifyEntry`、`integrationEntry`、`needsSnapshot`，写坏的文档经注入的提示函数报告；`component-index.ts` 用 `import.meta.glob` 扫描 `src/ui/` 与 `src/plugins/*/web/components/`，并合并 nb-ui 的 `lab-sources`（逻辑路径加前缀 `nb-ui/`）；重名由 `buildLabIndex` 处理。检索按组件名、显示名与别名匹配（不搜正文）；`fixtures/` 登记场景、显式分层输入、插槽预设名、类型化 fixture loader；不从组件实现生成 props/emits/slots 数据。
- **输入边界**：`lab-subject.ts` 持有分层 schema、`LabJsonInput<T>` 投影、`LabInputOf<C>` 类型约束和 `useLabSubject` 接入 API；`fixtures/index.ts` 的 `defineLabFixture<typeof C>` 是唯一类型化登记入口。LabShell 只做编辑值的 JSON 形状校验，不读取运行时组件签名。函数/服务/Date/Set 等运行期 props 由 fixture 固定接线；它们不是第四种调试输入，也不削弱组件实际必填 props 的 Vue 模板类型检查。
- **透传夹具**：`fixtures/subject-fixture.ts` 的 `defineSubjectFixture<typeof C>` 为只需绑定输入、记录事件、按声明回写受控输入并补运行期 props 的零件生成夹具组件；运行期 props 在加载时异步准备，与被测组件一样按需加载。需要插槽预设、`LabFixtureControls` 或挂载后才准备的服务时仍手写 fixture 并用 `defineLabFixture` 登记。
- **调试入口**：`lab-url.ts` 解析地址栏参数并持有画布预设；`useLabPreferences` 按“URL > session > 偏好 > 默认”恢复并校验它们（改为“地址参数 > 偏好 > 默认”，planned）；`lab-debug.ts` 持有 `window.__nbLab` 与舞台测量，接口类型在 `shared/debug-api.ts`；`scripts/lab-shot.ts`（`bun run lab:shot`，Node 运行）是命令行截图入口，截图与报告默认写入系统临时根。
- **状态与持久化边界**：LabShell 持有页面编排和当前状态，不持有命令宿主；命令场景的局部宿主在 `web/fixtures/command-scene/`（`lab-command-scene.ts`、样板编辑器 `SampleTextEditor.vue`、命令检视 `LabCommandInspector.vue`）。`useLabPreferences` 与 `lab-preferences-store` 只负责 Lab 界面偏好的校验、恢复、保存、重置和 fail-open（存储经最小的 `KeyValueStorage` 接口）；`lab-wallpaper-store` 只负责 Lab 壁纸 Blob。产品主题、Global Config 和业务数据不由 Lab 持有。
- **关键不变量**：生产构建的入口不引用开发清单，Lab 模块不进构建图（`check:dist` 检查）；Lab 页面声明 `reloadOnLeave`，宿主路由在离开它时整页加载；Tree 对外维持 string-id，Reka 节点对象不泄漏；场景切换/还原不改变 fixture 初始合同；存储异常不阻断 Lab 打开。
- **验证入口**：`bun test` 跑组件索引模型、`lab-url`、偏好存储与 `useLabPreferences`；Vitest（`*.dom.test.ts`）跑场景登记门禁、分层输入、透传夹具、检查器、HighlightBox 与命令场景的局部宿主；`e2e/lab.e2e.ts`、`e2e/lab-shot.e2e.ts`、`e2e/lab-commands.e2e.ts`、`e2e/lab-scenes.e2e.ts` 在真实开发会话上验收；`check:dist` 与 `e2e/browser-host.e2e.ts` 验收生产排除，`check:dist` 另以组件文档的 frontmatter 特征拦住误引 `lab-sources`。产品 `theme.system` 和渐进组件迁移不属于本实现合同。

## 证据

- 新应用（w00017 [t48](../../../.agents/works/w00017-application-runtime-architecture/tasks/t48-web-ui-foundation-lab/README.md)）：Lab 外壳、零件、JsonViewer 与 SkillChip 迁入；场景 1–15、17 由上述测试与 e2e 验收；场景 16 由 w00017 [t49](../../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md) 迁入命令场景后由 `lab-commands.e2e.ts` 验收。迁入的组件只有 Lab 零件与两个共享组件，工作台与各业务域的组件和 fixture 随各自迁移进入索引；场景 3 中“阻断原因与入口跳转的界面”在真实索引出现这类条目（t50）之前，只由索引模型测试覆盖。
- 实现入口：[`component-index-model.ts`](../../../packages/neuro-book/src/plugins/lab/web/component-index-model.ts)、[`LabShell.vue`](../../../packages/neuro-book/src/plugins/lab/web/LabShell.vue)
- 合同测试：[`component-index-model.test.ts`](../../../packages/neuro-book/src/plugins/lab/web/component-index-model.test.ts)、[`fixtures/index.dom.test.ts`](../../../packages/neuro-book/src/plugins/lab/web/fixtures/index.dom.test.ts)、[`lab-preferences-store.test.ts`](../../../packages/neuro-book/src/plugins/lab/web/lab-preferences-store.test.ts)、[`check-dist.test.ts`](../../../packages/neuro-book/scripts/check-dist.test.ts)
- Smoke：[`lab.e2e.ts`](../../../packages/neuro-book/e2e/lab.e2e.ts)、[`lab-scenes.e2e.ts`](../../../packages/neuro-book/e2e/lab-scenes.e2e.ts)、[`lab-shot.e2e.ts`](../../../packages/neuro-book/e2e/lab-shot.e2e.ts)、[`lab-commands.e2e.ts`](../../../packages/neuro-book/e2e/lab-commands.e2e.ts)（`bun run test:e2e`，真实 `bun run dev` 与本机 Chrome）
- 批准与范围依据：[`w00003 NeuroBook UI Foundation Migration`](../../../.agents/works/w00003-neurobook-ui-foundation-migration/README.md)、t05 Component Lab 任务与 t07/t10/t11 交付记录；旧应用时期的 smoke 与产物排除证据记在这些 Task 与 [w00017 t14](../../../.agents/works/w00017-application-runtime-architecture/tasks/t14-lab-host-boundary/README.md)，只作历史参照。
