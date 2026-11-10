# t31 实施计划：作者界面第一批（设定侧）

状态：第三版（2026-11-10）。第二版经设计审查 35 条都成立（[处理记录](evidences/design-review-resolution.txt)），开发者定“内核缺的八项补上”，本版照此重写。下一步是 S0：写内核补口与界面的 Spec，分两路再审一轮，开发者批准后开工。第一、二版见 git 历史。

## Context

内核（`nb-canon`）与剧情侧都已合进 master，但作者在应用里还看不到、用不上：canon 插件的浏览器入口只提供世界客户端，没有界面。开发者 2026-11-10 定作者界面分两批，本计划只管第一批（设定侧）。

期望结果：打开星瑕样本项目，或在自己的作品里新建条目以后，能在应用里看条目树、打开条目页、切换位置、点值看来历、就地改、记一笔、看回执、处理待处理、看改动记录并还原。

开发者已定的（都有记录）：

- 2026-11-02（t16 第 1 到 3 轮）：条目树在侧栏“设定”；条目页、回执、变更详情是编辑器区的标签页；待处理、改动记录在底部面板，状态栏显示条数；回执不分种类；马甲挂本体下；分开写“初值”与“第 1 章开头”；几笔累出来的数不直接改；界面上不出现记录 id、Component、字段路径。
- 2026-11-10（t16 评审板第 7 版）：做最小的条目新建与删除；条目页刷新后恢复；点条目树不做预览标签；人物、面板的分页第一批就各写专门的界面；底部面板默认隐藏。
- 2026-11-10（评审板第 9 版）：界面要用而内核给不出的八项补上，第一批前面加一片“内核补口”；“底部面板默认隐藏”的声明由 w00026 t24 在视图容器的合同里加，本 Task 在它提供之前按默认显示做。

依据：

- 合同：`docs/specs/canon/project.md`、`model.md`、`revisions.md`、`rendering.md`、`components.md`；`docs/specs/workbench/editor.md`（输出 33、“视图”一条）、`views.md`、`commands.md`；`docs/specs/ui/workbench-shell.md`、`workbench-layout.md`、`i18n.md`。
- 原型：草稿 worktree `.worktree/w00039-t16-drafts` 的 `world-engine/`（17 个组件，自带同步引擎）。
- 相邻的工作：工作台的视图容器（w00026 t24，提案已接受，实施中）。视图不写容器时各自是一个隐式容器，本 Task 的三个视图都不写。

审查核实出的现状（改变了第二版的前提）：

- **内核的合同不是现成的。** `preview` 只收写入请求与还原请求；`revisions` 的读取结果没有 ops；没有读章表的方法；`tree` 不带位置，不给出场、马甲关系与总数；来历只能整个条目一起要，步骤里没有安放；`changes` 不能筛“某位置之前”、不能倒序、没有总数；`entry` 不给字段的种类与约束；`recordDelta` 只收数。
- **页面标签只在活动时渲染**，同一种页面在一个编辑组里共用一个组件实例，`context` 是整个窗口共用的一个对象；恢复时贡献没交付显示的是“这个页面已经不在了”。
- canon 的浏览器入口没有 `onStartup`；内置命令的 id 有域词表，里面没有 `canon`。
- `@notnotype/nb-canon/node` 依赖 `node:fs`，真实的 `WorldService` 在真实浏览器（Lab）里跑不起来；Vitest 的组件测试在 Node 里，可以跑。
- 产品里的世界宿主没接小模型：语义档在产品里总是“还没归纳”。
- nb-ui 的 `Tree` 没有右键菜单、行内后缀与“再显示 N 项”的行。

工作方式：代码在 Work 的 worktree `.worktree/w00039-novel-writing-plugins`（分支 `feat/w00039-t31-author-ui`）；记录与 Spec 在主工作区；主会话写代码；审查分两路：内核补口（后端）派 Claude Opus（本会话约定不开 omp），界面与编辑器派 Claude Sonnet；每片验证过后单独提交，做完合入 master，不 push。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 条目树 | nb-ui 的 `Tree` 外包一层 `EntryTree`（右键菜单用 nb-ui 的 `ContextMenu`，“再显示 N 项”做成一个普通的树行） | 文件资源管理器的 `ExplorerTree` 绑着文件语义不复用，但照它的做法包；`Tree` 本身缺的行内后缀按 S3 实际需要给 nb-ui 加一个行尾插槽 |
| 页面里的控件 | nb-ui 现有的 `Tabs`、`Select`、`Switch`、`NumberInput`、`Input`、`Button`、`Badge`、`Banner`、`Dialog`、`Field` | 都现成 |
| 读取的缓存与失效 | 自己写一层薄的（“关键设计 三”） | 只要“按世界版本失效、同参数合并、同一轮事件合并重读”；查询库多一套概念与依赖 |
| 组件测试里的世界 | 真实的 `WorldService` 经 canon 现有的测试场地（`testing/harness.ts`）走真实的 `createCanonClient` | 不手写内存客户端：它会重写订阅、独占与断线，恰好是读取层要测的 |
| Lab 场景里的世界 | 脚本从真实服务录下的读取结果，回放 | 真实服务在浏览器里跑不了；录下来的是生成物，与真实实现同源，不手写 |

## 关键设计

### 零、内核补口（`packages/nb-canon/`、`plugins/canon/shared/contracts.ts`、`backend/remote.ts`）

八项，都是加方法或加字段，不改已有行为；每项写进对应 Spec 的 planned 条目（S0），实现后在三百万字夹具上按 `canon/project.md` 输出 14 的规模量一次。

| 项 | 加什么 | 给谁用 | 改哪份 Spec |
|---|---|---|---|
| K1 就地改与记一笔的预览 | 读方法 `previewEdit`：入参同 `editInPlace`、`recordDelta`、`recordNote`；只算不发。返回“会写回哪里”（改初值、改某条变更的那一笔、在某位置新记一条变更）、预览的修订（改了什么、带来的变化）、后面改过同一地址的记录；会被拒收时返回同样的失败 | 就地改与记一笔的确认条 | `revisions.md` 输出 5、8、9；`project.md` 方法表 |
| K2 读一次修订 | 读方法 `revision {id}`：完整的修订（改了什么、带来的变化、还原的是哪一次、能不能还原与原因），没有时为空 | 回执页 | `project.md` 方法表；`revisions.md` 输出 14 |
| K3 章表 | 读方法 `chapters`：按章序的章 id、序号、标题、讲的线，带世界版本；章序变了随 `changed` 事件失效 | 位置选择、各处“第 N 章” | `project.md` 方法表、输出 9 |
| K4 条目树的一层 | `tree` 加读取位置；每项加位置上的名字、是否已出场、是谁的马甲、是否已删除、有没有子项；页加剩余条数。已删除而有子条目的照 `model.md` 输出 23 作墓碑列出 | 条目树 | `project.md` 方法表；`model.md` 输出 14、23 |
| K5 来历 | 来历的每一步带安放与那条变更的文字；读方法 `origins {entry, path, position, mode}` 按一个地址取，覆盖字段、列表元素与子字段、名字、简介、别名与主文字的块；`entry` 的每个字段状态加“最近一次改它的安放”（没改过为空） | 点值看来历、“第 N 章改过”、流水 | `model.md` 输出 15；`project.md` 方法表 |
| K6 剧情变更的列表 | `changes` 的筛选加“安放在某读取位置之前”，加从新到旧的顺序，页带总数 | 情节分页 | `project.md` 方法表 |
| K7 字段声明 | 读方法 `components`：登记的 Component 类型与字段声明（种类、单位、选项、范围、精确或语义档、实例字段）；`entry` 的每个命名空间带类型 id | 就地改按字段出控件、新建条目选启用哪些数据 | `components.md`；`project.md` 方法表 |
| K8 语义档的记一笔 | 写方法 `recordNote`：给读取位置、语义档字段、一句发生了什么与读到的值，内核算排序键，落成一条带事件的剧情变更。顺带把 `revisions.md` 输出 18（没给排序键时程序算）与 schema 里排序键必填的不一致定下来 | 面板的“记一笔” | `revisions.md` 输出 9、18；`project.md` 方法表 |

第一批不补、界面相应收窄的（处理记录“甲”的 9、10）：

- 待处理的一键处理（“按正文改设定”“是剧情里的变化”“插一笔漏记的”）没有写入合同：第一批的待处理详情只读加跳转，核对点不符给“改这一笔”（走 K1 与就地改），与设定冲突的待定变更给“去变更详情页”，在那里改它的生效状态要不要做，S0 写 Spec 时对着 `revisions.md` 的写入校验定，做不了就只显示。
- 删除条目的确认不写“几个子条目、被几处引用”的数目，只写“删除以后引用它的地方会显示已删除的条目，可以还原”。
- 含决策修改的修订还原需要作者来源，第一批的“还原”对这种修订不可用并写原因。

要守住的：新方法都走现有的视图令牌与预算规则（`project.md` 输出 18、24）；`previewEdit` 与随后的写入在同一份读取输入上结果一致（同 `revisions.md` 输出 5 对预览的要求）；两个引擎的差分测试覆盖 K5 新加的地址种类。

### 一、编辑器：带参数的页面标签（`packages/neuro-book/src/plugins/editor/`）

条目页、回执页、变更详情页都是“同一种页面、每个对象一个标签”。提案里的“带参数的虚拟文档”（草稿与保存、拆分、墓碑）是为作者编辑主 MDX 准备的（t28）；第一批的页面是读加小写入，只扩展页面标签：

- 声明加 `instances?: true`、`restore?: true`。`nbook.editor.open-page {id, arg}`：`arg` 是不超过 200 个字符的非空字符串，`instances` 页面必须带，别的页面带了为 `invalid-args`。标签的身份是页面 id 加 `arg`（地址 `page://<id>?<arg 的 URI 编码>`），同一个已开着就切过去。
- **每个标签自己的实例**：编辑组渲染页面时以标签 id 为 key，同组里两个同种页面互不共用实例。页面标签仍只在活动时渲染（不改“视图”一条）。
- **标签状态容器**：编辑器给每个页面标签一个响应式对象 `state`，寿命同标签：切走再回来还在，关闭才销毁，不存盘。条目页把位置、按计划、当前分页、展开的来历放在里面。
- **按标签的 context**：页面组件收到的 `context` 改成每个标签一份：原有的 `recent`，加 `arg` 与 `state`。无参数的页面（欢迎页、对话页、主题编辑器）收到的多两个字段，行为不变。
- **标题**：实现可以给 `title(arg)`，返回文字值或 null；编辑器在标签条里对它做响应式读取（实现内部读响应式数据，标题跟着变），null 或没给时用声明的标题。条目页的标题读的是读取层里已有的名字，不为标题单独发请求；条目还没读到时先显示声明的标题。
- **恢复**：`restore` 页面在 `editor.tabs` 里记页面 id 与 `arg`，刷新后照文件标签恢复。恢复出来的标签分三种状态：声明在、实现已交付（正常）；声明在、实现还没交付（“正在加载页面”，交付后自己变成正常）；声明不在（“这个页面已经不在了”）。`openOnFirstVisit` 与 `restore` 不能同时写。
- **面包屑**（开发者 2026-11-10 问“要不要”，主会话建议要，待回话）：实现可以给 `breadcrumbs(arg)`，返回几段文字与各自要执行的命令；编辑器在标签条下面那一行照文件的面包屑画。不给时页面没有面包屑，同现在。
- 不做：拆分、固定、预览标签。

要守住的：`page://<id>` 的旧地址、`openOnFirstVisit`、三个现有页面的行为不变；`pageIdOf` 取 `?` 之前的部分；最近打开列表、标题动作对“页面没有当前文件”的假设不变。`editor.md` 的命令表、输出 33 正文、声明校验与错误码在 S0 一起改全。

### 二、样本与测试

- 样本：星瑕样本的 JSON 与转换从 `packages/nb-canon/tests/sample/` 挪到 nb-canon 的子路径 `@notnotype/nb-canon/sample`（不进主入口；S0 先对 `packages/AGENTS.md` 与 `docs/modules/monorepo-boundaries.md` 核对子路径与发布内容的约定，不合就改放 `packages/neuro-book/scripts/` 下、nb-canon 的测试经相对路径读同一份 JSON）。
- `packages/neuro-book/scripts/canon-sample.ts`：经真实的 `WorldService` 把样本发布到一个目录，生成一部完整的作品（活页夹三章正文加世界日志），开发与 e2e 共用；e2e 的接法照 `e2e/fixtures.ts` 与 `e2e/support/` 的现有做法。
- 组件测试（`*.dom.test.ts`，Vitest 在 Node 里）：用 canon 现有的测试场地起真实的世界服务与真实的 `createCanonClient`，界面的读取层接在它上面。resync、ended、独占这些路径由场地真实触发。
- Lab 场景：`scripts/canon-sample.ts` 另出一份“读取结果的录像”（每个场景要的那几次读取的输入与输出），场景用一个只回放的客户端。录像是生成物，入库前由一条测试核对“重新生成后与入库的一致”，世界合同变了它会失败。

### 三、读取层（`plugins/canon/web/world.ts`）

界面不散着调客户端。窗口里一份读取层：

- 订阅先于第一次读取建立。`version` 跟 `changed` 事件走；`resync` 时重读 `status`；`ended` 之后标成断开。
- `read(method, input)` 返回 `{data, error, loading}`。同一个 `(method, input)` 在同一个版本里只发一次；版本变了，**只重读前台可见的**读取，同一轮事件（一个微任务里到的几条 `changed`）合并成一次重读；不可见的回到前台时重读；重读期间保留旧数据。
- 来历不随条目页整页读：点开一个值时才调 `origins`（K5）。“第 N 章改过”来自 `entry` 的字段状态（K5），不读来历。
- 翻过页的列表在游标过期后，按已读的条数从头重读一次，不丢作者的位置。
- 确认条打开期间版本前进：读到的值没变时只重取预览；值变了，确认条写“这个值刚刚变了”并换上新值，要作者再确认。
- 写入是薄包装：带请求 id；失败码转成给作者的一句话；`unknown-outcome` 时按请求 id 查结局。
- 验收里写数字：样本上条目页开着、树展开两层、面板开着时，一次别处的发布引起的读取次数；三百万字夹具上打开一个热门条目页的读取次数、最大一次的字节数与耗时。超过单次预算的一半要回来改。

界面在 canon 插件自己的浏览器入口里，直接用入口的远程访问建自己的那份客户端。入口加 `onStartup`（视图、页面、状态栏条目的实现要在启动时交付）。

### 四、界面（`plugins/canon/web/components/`）

从原型搬组件，把对原型 store 与引擎的同步调用改成读取层的读取；每个组件配同名 `.md`、能力标签、Lab 场景与 `*.dom.test.ts`；界面文字走界面文字机制，不写死。

| 界面 | 位置 | 来自原型 | 主要读取 |
|---|---|---|---|
| 设定（条目树） | 侧栏视图 `nbook.canon.entries` | `SettingsTree` | `tree`（K4） |
| 条目页 | 页面 `nbook.canon.entry`，参数是条目 id | `EntryPage` | `entry`、`render`、`chapters`（K3）、`origins`（K5）、`changes`（K6）、`components`（K7） |
| 回执页 | 页面 `nbook.canon.receipt`，参数是修订 id | `ReceiptPage` | `revision`（K2） |
| 变更详情页 | 页面 `nbook.canon.change`，参数是剧情变更 id | `ChangeDetail` | `object`、`previewEdit`（K1） |
| 待处理 | 底部面板视图 `nbook.canon.pending` | `PendingView` | `pending` |
| 改动记录 | 底部面板视图 `nbook.canon.revisions` | `RevisionsView` | `revisions`、还原的 `preview` |
| 状态栏 | 条目 `nbook.canon.pending-count` | — | `pending` 的总数；显不显示由公开状态 `nbook.canon/hasPending` 定 |
| 保存后的提示 | 三种页面顶部的一行 | `NoticeBar` | 刚发布的修订 |

- 命令 id 用 `nbook.canon.*`，`commands.md` 的域词表加 `canon`（S0）。
- 条目页的页头、位置选择、分页、来历、情节分页照 t16 已定的注意力顺序；“改”做成值旁常显的小按钮（悬停才出现的在触屏上找不到）；每个页面的内容列都封顶。
- **数据分页的贡献点** `canon.component-views`：贡献 id 是 Component 类型 id，声明 `{title?}`，实现 `{load()}`。界面组件收到的 `context` 是 canon 的 `shared/` 里定义的窄接口：这个条目与命名空间在所选位置上的字段状态（响应式）、字段声明、看一个地址的来历、发起就地改与记一笔。不把读取层交出去。S0 用第二批的两个界面（谁知道、目标与态度）对着这个接口走一遍，不够就在 S0 补。canon 自己给人物、面板各贡献一个界面；别的类型用通用字段表。
- 新建条目的对话框：名字、条目的种类（人物、地点、物品这类分组用的词，可以新写）、放在谁下面、启用哪些数据（已登记的 Component 类型，K7）、从哪里出场（缺省“一开始就在”）；顺序排在同层最后。
- 写入的入口：就地改（确认条选“改设定”或“剧情里变了”，预览走 K1）、记一笔（精确档走 `recordDelta`，语义档走 K8）、还原（先预览依赖）、新建与删除条目。
- 语义档归纳后的样子在产品里看不到（宿主没接小模型）：第一批只保证“还没归纳”的写法，归纳后的写法在 Spec 里标 planned。
- 变更详情页与待处理里“到原句”：第一批只在编辑区打开那一章；选中原句要编辑器提供按原文定位的能力，标 planned。
- 失败的呈现：`busy`、`world-read-only`、`no-project`、`value-conflict`、`version-conflict`、`unknown-outcome` 与断开，各有固定的写法（Spec 里列表）。

### 五、底部面板默认隐藏

待处理、改动记录两个视图不写容器，各自是底部面板里的一个入口。“默认隐藏”的声明由 w00026 t24 加；它提供之前底部面板按现行规则默认显示，S7 的外壳 e2e 基线按“默认显示”写一遍，声明到位后改声明与基线各一处。

## Spec 与文档改动（S0）

| 文件 | 改什么 |
|---|---|
| `docs/specs/canon/project.md` | 方法表加 `previewEdit`、`revision`、`chapters`、`origins`、`components`、`recordNote`，改 `tree`、`changes`、`entry` 的说明；都标 planned |
| `docs/specs/canon/revisions.md` | 输出 5、8、9 加就地改与记一笔的预览、语义档的记一笔；输出 18 与排序键 |
| `docs/specs/canon/model.md` | 输出 15 的来历步骤带安放、按地址取、覆盖的地址种类；字段状态的“最近一次改它的安放” |
| `docs/specs/canon/components.md` | 登记的类型与字段声明可以读 |
| `docs/specs/canon/author-ui.md`（新，`planned`） | 第一批的界面行为，按本版重写（草稿已有，未提交） |
| `docs/specs/workbench/editor.md` | 输出 33 的带参数的页面、每个标签的实例与状态容器、按标签的 context、标题、恢复的三种状态、面包屑；命令表、声明校验、错误码、`editor.tabs` 的记法、验收场景 |
| `docs/specs/workbench/commands.md` | 域词表加 `canon` |
| `docs/specs/README.md` | 注册表加 `canon/author-ui.md` |
| `packages/neuro-book/AGENTS.md` | 命令一节加生成样本项目的脚本（实施时） |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | Spec（上表）。分两路审：内核补口的条目派 Opus，界面与编辑器的派 Sonnet；处理后请开发者批准 | `bun run docs:check` |
| K-a | K2、K3、K6、K7：纯加读取，互不相干 | nb-canon 的 `service.test.ts`、应用的 `canon.test.ts`、类型检查；规模脚本 |
| K-b | K4、K5：`tree` 与来历（要动两个引擎） | 同上，加差分测试 |
| K-c | K1、K8：预览与语义档的记一笔 | `revisions.test.ts`、`edits.test.ts`；预览与发布一致的用例 |
| — | 内核补口的实现审查（Opus），修正 | — |
| E | 带参数的页面标签（实例、状态容器、context、标题、恢复、面包屑） | 编辑器的 `bun test` 与 `*.dom.test.ts`、`e2e/editor-area.e2e.ts`、`e2e/welcome.e2e.ts` |
| S2 | 样本与生成脚本；读取层；入口的 `onStartup` 与命令的域 | `sample.test.ts`、读取层的测试（真实服务：失效、合并、resync、ended） |
| S3 | 条目树（`EntryTree`） | `*.dom.test.ts`；Lab 场景 |
| S4 | 条目页（文字、位置、来历、情节）；贡献点、通用字段表、人物与面板两个界面；量读取次数与耗时 | `*.dom.test.ts`；Lab 场景；数字记进 `evidences/` |
| S5 | 写入：就地改、记一笔、保存后的提示、新建与删除条目、失败的呈现 | `*.dom.test.ts`（真实服务上写入后界面跟着变） |
| S6 | 回执页、变更详情页 | 同上 |
| S7 | 底部面板两个视图、状态栏条目 | 同上；外壳 e2e |
| S8 | e2e、截图取证、组件文档、实现审查（Sonnet）、逐条核对后晋升 Spec | 见“验证” |

K 三片与 E 互不依赖，可以交替做；S2 起依赖它们。每片先写用例再写实现，验证过后单独提交。

## 验收映射

S0 写完 Spec 后把下表换成条目编号：

| 行为 | 覆盖 |
|---|---|
| 内核补口八项各自的读写结果；预览与随后的发布一致；`origins` 覆盖列表元素、名字、块；`tree` 的出场、马甲、墓碑、剩余条数 | nb-canon 的合同测试、应用的 `canon.test.ts`、差分测试 |
| 带参数的页面：同参数切过去、不同参数各开一个；两个同种页面来回切状态不串、切走再回来状态还在；标题跟着条目名变；刷新后恢复的三种状态 | `editor/area.test.ts`、`groups.test.ts`、编辑组的 `*.dom.test.ts`、`e2e/editor-area.e2e.ts` |
| 条目树、条目页、写入、回执、还原、待处理与状态栏、失败的呈现 | 各组件的 `*.dom.test.ts`（真实服务） |
| 读取次数与大小的上限 | 读取层的测试与 S4 的测量 |
| 星瑕一周走一遍 | `e2e/canon-author.e2e.ts` |

## 验证

- 每片：受影响的 `bun test` 与 `*.dom.test.ts`；类型表面变了跑对应包的类型检查。内核各片另跑规模脚本，对照 `project.md` 输出 14 的预算。
- 收口：`bun run test:affected --typecheck --since <分支起点>`；e2e 跑 `canon-author`、`editor-area`、`welcome`、`lab-scenes`，以及假定初始布局的外壳文件 `workbench-*` 与 `plugins`。
- 真实浏览器：`nbdev dev start` 起服务，打开脚本生成的星瑕项目，桌面与 390 像素宽各走一遍主路径，明暗两套主题截图，发一份 `report` 产物。
- 不验证：多窗口同时写（内核已有两进程测试，界面只验证“别处发布后本窗口更新”）；语义档归纳后的样子（产品里没有小模型）。

## 不做与风险

不做：

- 剧情侧的界面与决定、正文建议两个面板视图：第二批（设计在 t16 第 5 轮以后）。
- 作者编辑主 MDX（t28）；新建、编辑剧情变更与计划。
- 待处理的一键处理；删除确认里的数目；含决策修改的修订的还原。
- 内置 Component 的完整字段清单（t10）；人物、面板以外的类型的专门界面。
- 页面标签的拆分、固定、预览标签；按原文定位并选中。
- 记账与 Agent 工具（t19、t20）。

风险：

- **内核补口改的是已 implemented 的 Spec。** 只加不改，但 `tree`、`entry` 的返回多了字段，现有调用方（剧情插件、测试）要过一遍；K5 动两个引擎，由差分测试兜底。
- **第一批比第一版大了约三分之一**（内核三片加页面标签的状态容器与恢复）。K 与 E 先做，做完界面各片才开工；任何一片发现合同还缺东西，回 S0 补 Spec，不在界面里绕。
- **底部面板第一次有产品视图**，而且赶上视图容器换模型。S7 开头先放一个空视图跑通布局与外壳 e2e；t24 合入的先后会影响 S7 的基线，开工前看它的状态。
- **原型组件是同步引擎上的。** 搬过来时每个读取都变成异步，加载中与失败两种状态要逐个补。
- **Lab 的录像会过时。** 由“重新生成后一致”的测试守着；世界合同一变就要重录。
