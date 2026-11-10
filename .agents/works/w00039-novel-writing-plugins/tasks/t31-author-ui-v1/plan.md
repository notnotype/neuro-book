# t31 实施计划：作者界面第一批（设定侧）

状态：第二版（2026-11-10 开发者答了末尾五项，第 4 项改成人物、面板各写专门的界面）。**设计审查后待出第三版**：审查 35 条都成立（`evidences/design-review-resolution.txt`），其中“内核合同是现成的”这个前提不成立（要补八项）、“关键设计 一”的页面标签要改成每个标签自己的实例与状态容器、“关键设计 二、三”的内存客户端与读取层要改。等开发者定了补内核还是收窄再改，下面的正文不照着实施。

## Context

内核（`nb-canon`）与剧情侧都已合进 master，13 份 Spec 是 `implemented`，但作者在应用里还看不到、用不上：canon 插件的浏览器入口只提供世界客户端，没有任何界面。开发者 2026-11-10 定：作者界面分两批，第一批照 t31 原范围做设定侧，第二批做剧情侧（先在 t16 出静态稿）。本计划只管第一批。

期望结果：打开星瑕样本项目，能在应用里看条目树、打开条目页、切换位置、点值看来历、就地改、记一笔、看回执、处理待处理、看改动记录并还原。

依据：

- 设计：[t16](../t16-plot-workbench-ui/README.md) 第 1 到 3 轮评审板与 Work README 决定表 2026-11-02 各行（版式、注意力顺序、回执不分种类、马甲挂本体下、初值与“第 1 章开头”分开、数不直接改而是改某一笔或补一笔）。
- 合同：`docs/specs/canon/project.md`（方法表、事件、失败码、“时序与寿命”）、`model.md`（输出 5、14 到 16、21）、`revisions.md`（输出 5、8、9、14、16）、`rendering.md`（输出 7）、`docs/specs/workbench/editor.md` 输出 33、`docs/specs/workbench/views.md`、`docs/specs/ui/workbench-shell.md`（状态栏条目）、`docs/specs/ui/workbench-layout.md` 输出 1、4。
- 提案：`docs/proposals/world-engine-kernel.md`“四、方案”第 8 节与“五、影响”。
- 原型：草稿 worktree `.worktree/w00039-t16-drafts` 的 `packages/neuro-book/src/plugins/drafts/web/components/world-engine/`（17 个组件、自带同步引擎，13 个 Lab 场景）。

已核实的现状：

- 编辑器的页面标签（`editor.pages`）一个页面在窗口里只开一个：地址是 `page://<页面 id>`，`nbook.editor.open-page` 只收 `{id}`，标题取声明，刷新后不恢复（`editor.tabs` 只记 `{page: true}`），不能拆分、不能固定（`plugins/editor/web/area.ts` 的 `openPage`、`groups/groups.ts` 的 `PageTab`）。现有使用者只有欢迎页、Agent 对话页、主题编辑器页。别的 Work 没有计划扩展它。
- 工作台没有“容器”贡献点：`workbench.views` 里 `location: "sidebar"` 的视图各自在活动栏有一项。`location: "panel"` 类型上支持，但还没有产品插件用过，只有 Lab 夹具。
- 第一次生成布局时，有视图的具名面板默认显示（`workbench-layout.md` 输出 1）：往底部面板加视图，会让新窗口默认多出一条底部面板。
- 状态栏条目（`workbench.statusbar-items`）的文字与状态由实现响应式给出，可带命令（Agent 的活动条目、编辑器的“未保存 N 个”是现成例子）。
- 世界客户端 `CanonClient`（`call`、`publish`、`subscribe`、`hold`）按调用方提供；`changed` 事件只带版本、修订、写入者与标题，不说动了哪些条目。条目页要拼 `entry`（带来历）、`render`、`changes`、`pending` 几次读取（t29 API 审查留给界面的第 12 条）。
- 星瑕样本只在 `packages/nb-canon/tests/sample/`（原型导出的 JSON 加转换与重放），应用里没有办法得到一部带世界的作品。

工作方式：代码在 Work 的 worktree `.worktree/w00039-novel-writing-plugins`（分支 `feat/w00039-t31-author-ui`）；记录在主工作区；主会话写代码；审查按前端派 Claude Sonnet；每片验证过后单独提交，做完合入 master，不 push。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 条目树 | nb-ui 的 `Tree` | 原型已用；文件资源管理器的 `ExplorerTree` 绑着文件语义，不复用 |
| 页面里的 Tab、位置选择、开关、数值输入 | nb-ui 的 `Tabs`、`Select`、`Switch`、`NumberInput`、`Button`、`Badge`、`Banner` | 原型已用，全部现成 |
| 读取的缓存与失效 | 自己写一层薄的（见“读取层”） | 需要的只是“按世界版本失效、同参数合并请求”，引入查询库（TanStack Query 一类）要多一套概念与依赖，不值 |
| 组件测试里的世界 | 真实的 `WorldService` 跑在内存文件上，包成 `CanonClient` | 测试规范要求依赖用真的；不手写假客户端 |

## 关键设计

### 一、编辑器：带参数的页面标签（`packages/neuro-book/src/plugins/editor/`）

条目页、回执页、变更详情页都是“同一种页面、每个对象一个标签”。提案里的“带参数的虚拟文档”（多开、拆分、草稿与保存、墓碑）是为作者编辑主 MDX 准备的，那件事在 t28；第一批的页面都是读加小写入，不需要文档语义，所以只做页面标签的最小扩展：

- 声明加 `instances?: true`：这种页面按参数开多个。不写的页面行为不变。
- `nbook.editor.open-page` 的参数加可选的 `arg`（字符串，上限 200 个字符）。`instances` 页面必须带 `arg`，别的页面带了就拒绝（`invalid`）。
- 地址是 `page://<页面 id>?<arg 的 URI 编码>`，标签的身份仍是地址：同一个 `arg` 已经开着就切过去，这条现有逻辑不用改。
- 页面组件的 `context` 多一个 `arg`。
- 标题：实现可以给 `title(arg)`（响应式读取），返回文字值或 null；null 时用声明的标题。条目页用它显示条目的名字。
- 恢复（见待确认 2）：声明加 `restore?: true` 的页面，`editor.tabs` 记 `{page: <地址>}`，刷新后照文件标签恢复；页面的贡献还没交付时显示现有的“正在加载页面”，贡献不在了显示现有的“这个页面已经不在了”。
- 不做：拆分、固定、预览标签（见待确认 3）。

要守住的：`page://<id>` 的旧地址、`pageIdOf`、`openOnFirstVisit`、欢迎页与对话页的行为都不变；`pageIdOf` 改成取 `?` 之前的部分，另加 `pageArgOf`。

### 二、样本与测试底座

- `packages/neuro-book/scripts/canon-sample.ts`：把星瑕样本经真实的 `WorldService`（`@notnotype/nb-canon/node`）发布到一个目录，生成一部完整的作品（活页夹三章正文加 `.nbook/world/log/`）。开发时用它建样本项目，e2e 的夹具也用它。样本 JSON 与转换从 `packages/nb-canon/tests/sample/` 挪到 nb-canon 的一个不进主入口的子路径 `@notnotype/nb-canon/sample`（测试与脚本共用，不让应用包深导入测试目录）。
- `plugins/canon/testing/memory-client.ts`：内存文件上的真实 `WorldService` 包成 `CanonClient`，给组件的 `*.dom.test.ts` 与 Lab 场景用。它与远程那条路的差别只有编码与断线，用现有 `canon.test.ts` 里的读写用例对一遍两边结果相同。

### 三、读取层（`plugins/canon/web/world.ts`）

界面不直接散着调 `client.call`。窗口里一份 `WorldReads`：

- `version`：当前世界版本的 ref。启动时读一次 `status`，之后跟 `changed` 事件走；收到 `resync` 重读 `status`；`ended` 之后标成断开，界面给一条“世界已断开”的横幅与“重试”。
- `read(method, input)`：返回 `{data, error, loading}` 的响应式结果。同一个 `(method, input)` 在同一个版本里只发一次请求；版本变了，还有组件在用的读取自动重读，没人用的丢掉。重读期间保留旧数据（不闪）。
- `reduced`、`textChanged` 事件让语义档的值与核对点相关的读取重读；`exclusive` 事件更新“谁在独占写入”，写入入口据此禁用并说明原因。
- 写入（`publish`、`editInPlace`、`recordDelta`、`revert`）是薄包装：带请求 id；失败码转成给作者的一句话；`unknown-outcome` 时按请求 id 调 `outcome` 查结局再报结果。

条目页拼几次读取先并行发（`entry` 带来历、`render`、这个条目的 `changes`），不加合并的服务方法；S4 收口时量样本与三百万字夹具上打开条目页的耗时，超过 200 毫秒再回来加。

客户端按调用方提供，界面在 canon 插件自己的浏览器入口里，直接用 `context.remote.use(canonWorldContract)` 建自己的那份客户端，不经 `canonClientKey` 绕回自己。

### 四、界面（`plugins/canon/web/components/`）

从原型搬组件，把对原型 store 与引擎的同步调用改成读取层的异步读取；每个组件配同名 `.md`、能力标签、Lab 场景与 `*.dom.test.ts`。

| 界面 | 位置 | 来自原型 | 数据 |
|---|---|---|---|
| 设定（条目树） | 侧栏视图 `nbook.canon.entries`，活动栏一项，排在文件之后 | `SettingsTree` | `tree`（分页，一层一层展开）；马甲挂本体下；未出场与已删除的置灰标注 |
| 条目页 | 页面 `nbook.canon.entry`，参数是条目 id | `EntryPage` | `entry`（带来历）、`render`（给作者）、`changes` |
| 回执页 | 页面 `nbook.canon.receipt`，参数是修订 id | `ReceiptPage` | `revisions` 里那一条（改了什么、带来的变化） |
| 变更详情页 | 页面 `nbook.canon.change`，参数是剧情变更 id | `ChangeDetail` | `object`、`preview` |
| 待处理 | 底部面板视图 `nbook.canon.pending` | `PendingView` | `pending`（分页、三组） |
| 改动记录 | 底部面板视图 `nbook.canon.revisions` | `RevisionsView` | `revisions`（分页）、还原前的 `preview` |
| 状态栏 | 条目 `nbook.canon.pending-count`：“待处理 N”，有待处理时为警告色，点了打开待处理视图；N 为 0 时不显示 | 外壳里写死的那一项 | `pending` 的总数 |
| 保存后的提示 | 条目页与变更详情页顶部的一行 | `NoticeBar` | 刚发布的修订：回执、撤销、关闭 |

条目页的结构（t16 已定的注意力顺序）：名字、一句话简介与位置在最上；主体是主 MDX 渲染出的文字；“第 N 章改过”用淡色小字；来历默认收起，点值展开；各 Component 一个 Tab。位置选择列出“初值”“第 1 章开头”与各章的开头、末尾，缺省是写到的位置；旁边是“按计划”开关。位置与 Tab 是标签自己的状态，不进地址。

Component 的分页（开发者 2026-11-10 定：人物、面板第一批就各写专门的界面）：

- 新贡献点 `canon.component-views`（只接受浏览器入口）：贡献 id 是 Component 类型 id，声明 `{title?, order?}`，实现 `{load(): Promise<Component>}`，组件收到 `{entry, namespace, position, mode}` 与读取层。条目页给每个启用的命名空间一个分页：这个类型有登记的界面就用它，没有就用通用的字段表（标签、值、单位、改过的标记、点值看来历）。
- canon 插件自己给内置的两种类型各贡献一个界面，照原型搬：**人物**（字段一行一个，值可点看来历，语义档的“现在的态度”带归纳与事件）、**面板**（左边一列值卡，右边是选中那个值的流水与“记一笔”，精确档与语义档两种写法）。
- 第二批里剧情插件用同一个贡献点给它的类型交界面（知道什么、目标与态度），不用再动条目页。
- 字段清单（t10）变了以后这两个界面要跟着改，开发者接受这个代价。

写入的三个入口：

- **就地改**：点值旁的“改”，原地出输入框与确认条。确认条让作者选意图：“改设定”（创作修改，缺省）或“剧情里变了”（在这个位置记一条变更；位置是初值时没有这一项），先调 `preview` 给出“写回哪条记录、带来的变化”，再保存（`editInPlace`，路由规则在 `revisions.md` 输出 8）。几笔累出来的数“改设定”会被内核拒收（`accumulated-value`），界面不等它拒：这种值的“改”直接展开流水，让作者改其中某一笔或记一笔（开发者 2026-11-02）。`value-conflict`（读到的值已经变了）时重读后让作者重来。
- **记一笔**：数值字段旁，填变化量或一句话（语义档）与安放的章，调 `recordDelta`。
- **还原**：改动记录里每条一个“还原”，先 `preview` 列出依赖它的后续修订，作者选“连同依赖”或取消。

失败的统一呈现：`busy`（别人在独占写入，写谁在写、给“强行解除”）、版本冲突（提示已变、重读后重试）、`world-read-only`（顶部横幅写原因，所有写入入口禁用）、`no-project`（视图里一句“打开作品后可用”）。

条目的增删（见待确认 1）：条目树标题动作“新建条目”（名字、类型、父条目、启用哪些 Component），条目页“⋯”里“删除条目”；都走 `publish`，都有回执，可还原。

### 五、底部面板默认隐藏（依赖 w00026 t24）

开发者 2026-11-10 定底部面板默认隐藏。写 Spec 时发现工作台正在换模型：[视图容器提案](../../../../../docs/proposals/workbench-view-containers.md)已接受（w00026 t24，进行中），`workbench-layout.md` 输出 1 的 planned 合同是“第一次生成文档时，有容器的区域显示，没有容器的隐藏”，视图不写 `container` 时各自是一个隐式容器。所以：

- 待处理、改动记录两个视图不声明容器，各自是底部面板里的一个入口（等于两个标签）；侧栏的“设定”同理，是条目树视图的隐式容器，活动栏一项。t24 合入前后，本 Task 的声明都不用改。
- “默认隐藏”要在容器合同里加一个声明（视图或容器写明“不让所在区域默认显示”）。这两份 Spec 正由 t24 的会话在改，本 Task 不动它们：`author-ui.md` 输出 25 把这一句标成 planned 并写明依赖；由开发者定是 t24 顺手加，还是 t24 合入后由本 Task 加。加之前底部面板按现行规则默认显示，S7 的外壳 e2e 基线按“默认显示”写，声明到位后再改。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/canon/author-ui.md`（新，`planned`，capability `canon.author-ui`） | 第一批的全部界面行为：条目树、三种页面、两种面板视图、状态栏条目、三种写入入口、失败的呈现、断开与重连、键盘可达；验收场景；不承诺里写剧情侧、主 MDX 的编辑、可视化 |
| `docs/specs/workbench/editor.md` | 输出 33 加带参数的页面（条目级“（planned）”）、命令表 `open-page` 的参数、`editor.tabs` 的记法；验收补场景 |
| `docs/specs/workbench/views.md`、`docs/specs/ui/workbench-layout.md` 输出 1 | “不让所在区域默认显示”的声明：不在本 Task 改，见“关键设计 五” |
| `docs/specs/README.md` | 注册表加 `canon/author-ui.md` |
| `packages/neuro-book/AGENTS.md` | “命令”一节加生成样本项目的脚本 |

`author-ui.md` 的假设（写 Spec 前先列，随本计划一起确认）：

1. 条目页是读的界面：位置、Tab、展开的来历都是标签自己的状态，关掉标签就没了，不存盘。
2. 界面总是按当前世界线读；选线的入口在第二批。
3. 回执页不能改东西，只读加“还原这次修订”。
4. 一次只显示一条保存后的提示，新的顶掉旧的。
5. 界面文字第一批只有中文键，走现有的界面文字机制（`ui.i18n`），不写死在组件里。

## 切片

| 片 | 内容 | 对应设计 | 自跑验证 |
|---|---|---|---|
| S0 | Spec（上表）；与本计划一起做设计审查（Sonnet），处理后开发者批准 | 全部 | `bun run docs:check` |
| S1 | 带参数的页面标签（参数、标题、恢复） | 一 | `bun test src/plugins/editor`、编辑器的 `*.dom.test.ts`、`e2e/editor-area.e2e.ts`、`e2e/welcome.e2e.ts` |
| S2 | 样本子路径与生成脚本、内存客户端、读取层 | 二、三 | nb-canon `tests/sample.test.ts`；`bun test src/plugins/canon`；读取层的 `world.test.ts`（真实服务：版本失效、合并请求、resync、ended） |
| S3 | 侧栏“设定”视图与条目树，新建条目 | 四 | `SettingsTree.dom.test.ts`；Lab 场景 |
| S4 | 条目页（文字、位置与按计划、来历、情节分页）；贡献点 `canon.component-views`、通用字段表、人物与面板两个界面；量打开耗时 | 四 | `EntryPage.dom.test.ts`、两个界面各自的 `*.dom.test.ts`；Lab 场景；耗时记进 `evidences/` |
| S5 | 就地改、记一笔、保存后的提示、失败的呈现、删除条目 | 四 | 各组件的 `*.dom.test.ts`（真实服务上写入后界面跟着变） |
| S6 | 回执页、变更详情页 | 四 | 同上 |
| S7 | 底部面板两个视图、状态栏条目 | 四、五 | 同上；外壳 e2e |
| S8 | e2e、截图取证、组件文档补齐、实现审查（Sonnet）、逐条核对后晋升 Spec | — | 见“验证” |

S1 与 S2 互不依赖；S3 到 S7 都依赖 S1、S2。每片先写用例再写实现，验证过后单独提交。

## 验收映射

Spec 还没写，S0 写完后把下表换成条目编号：

| 行为 | 覆盖 |
|---|---|
| 带参数的页面：同参数切过去、不同参数各开一个、标题跟着条目名变、刷新后恢复、贡献方停了显示占位 | `editor/area.test.ts`、`groups.test.ts`、`e2e/editor-area.e2e.ts` |
| 条目树：分页展开、马甲挂本体、发布后自己更新 | `SettingsTree.dom.test.ts` |
| 条目页：切位置与按计划后各值随之变、来历与内核一致、别处发布后不闪地更新 | `EntryPage.dom.test.ts` |
| 就地改：确认条的预览与保存结果一致；累出来的数没有“改” | `EntryPage.dom.test.ts`、e2e |
| 记一笔：精确档与语义档各一条 | `EntryPage.dom.test.ts` |
| 回执与还原：还原前列出依赖、还原后界面回到原样 | `RevisionsView.dom.test.ts`、e2e |
| 待处理与状态栏计数：核对点不符出现、处理后消失 | `PendingView.dom.test.ts`、e2e |
| 失败的呈现：`busy`、只读、断开 | `world.test.ts`、各组件测试 |
| 星瑕一周走一遍（场景） | `e2e/canon-author.e2e.ts` |

## 验证

- 每片：受影响的 `bun test` 与 `*.dom.test.ts`，类型表面变了跑 `bun run typecheck`（应用包）。
- 收口：`bun run test:affected --typecheck --since <分支起点>`；e2e 跑 `canon-author`、`editor-area`、`welcome`、`lab-scenes`，以及假定初始布局的外壳文件 `workbench-*` 与 `plugins`（新增了默认显示的侧栏视图与状态栏条目）。
- 真实浏览器：`nbdev dev start` 起服务，打开脚本生成的星瑕项目，桌面与 390 像素宽各走一遍主路径（开条目、切位置、就地改、看回执、还原），明暗两套主题截图，发一份 `report` 产物给开发者。
- 不验证：三百万字规模下的界面（只量条目页的读取耗时）；多窗口同时写（内核已有两进程测试，界面只验证“别处发布后本窗口更新”）。

## 不做与风险

不做：

- 剧情侧的全部界面（剧情容器、剧情表、时间线、知情、伏笔、目标、决策、检查、简报预览）与正文建议、决策两个面板视图：第二批。
- 作者编辑主 MDX（t28）；文字 Tab 第一批只读。
- 内置 Component 的完整字段清单（t10）；人物、面板以外的类型的专门界面。
- 可视化（关系图、时间线图、地图），原型里的“数据”栏与步骤条。
- 页面标签的拆分、固定、预览标签。
- 记账与 Agent 工具（t19、t20）：第一批的数据只来自样本、手动新建与手动记一笔。

风险：

- **底部面板第一次有产品视图。** `location: "panel"` 只在 Lab 夹具里跑过。S7 开头先放一个空视图跑通布局与外壳 e2e，再做内容；由 `e2e/lab-workbench-surface.e2e.ts` 与新的 `canon-author.e2e.ts` 用真实工作台兜底。
- **新增默认显示的视图会动到别的 Work 的外壳 e2e 基线。** 侧栏多一个活动栏图标、状态栏可能多一项。收口时跑 `workbench-*` 与 `plugins`，要改的基线逐个说明。
- **原型组件是同步引擎上的。** 搬过来时每个组件的读取都变成异步，加载中与失败两种状态原型里没有，要逐个补，不照抄模板。
- **读取层的版本失效是粗粒度的**（任何发布都让在用的读取重读）。样本规模没有问题；大书上由 S4 的测量决定要不要按条目细分。

## 待确认

**开发者 2026-11-10 已答**：第 1、2、3、5 项按推荐，第 4 项选了“专门的界面”（见该项）。原文留作历程。这五项已放到 t16 评审板第 7 版的“一、第一批（设定侧）的计划”，题号依次是 `b1-entry-crud`、`b1-restore`、`b1-preview`、`b1-component-tabs`、`b1-panel-quiet`（开发者 2026-11-10 要求要定的事都放评审板、一次回复）。

1. **第一批做不做条目的新建与删除。** 推荐做最小的（新建：名字、类型、父条目、启用的 Component；删除）。不做的话，界面只在样本项目上有内容，开发者自己的作品是空的；代价是多两个表单与对应的 Spec 条目。
2. **带参数的页面标签刷新后恢不恢复。** 推荐恢复。不恢复的话，作者开着的条目页一刷新全没了；代价是 `editor.tabs` 的记法多一种，S1 多一段恢复逻辑与测试。
3. **点条目树是不是预览标签**（像文件那样单击开预览、再点别的就替换）。推荐第一批不做：单击就开一个正式标签，同一个条目再点是切过去。代价是连着点很多条目会开很多标签；预览标签要让页面标签支持 preview 与“保留”，放到用过以后再定。
4. **Component 的 Tab 第一批用通用的字段表。** 推荐。开发者 2026-11-01 定的“各 Component 自己的界面用 Vue 写”留到 t10 定字段清单时一起做，届时加一个贡献点。**开发者 2026-11-10 没按推荐：第一批就给人物、面板各写专门的界面**；“关键设计 四”已照改，贡献点提前到第一批。
5. **底部面板默认不显示。** 推荐给视图声明加 `quiet`，面板默认隐藏，靠状态栏“待处理 N”打开。不加的话，所有新窗口默认多一条底部面板，写作区变矮，别的 Work 的外壳 e2e 基线也要跟着改；代价是工作台的 Spec 与实现各加一小条。
