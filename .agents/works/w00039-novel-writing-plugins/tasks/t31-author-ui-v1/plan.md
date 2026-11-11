# t31 实施计划：作者界面第一批（设定侧）

状态：第四版（2026-11-10）。第二版经设计审查 35 条都成立（[处理记录](evidences/design-review-resolution.txt)），开发者定“内核缺的八项补上”，第三版照此重写并写了 Spec 草稿；第二轮设计审查分两路（内核 15 条、界面与编辑器 18 条，[处理记录](evidences/design-review-r2-resolution.txt)），本版按它改。下一步：开发者批准 Spec 后开工。前三版见 git 历史。

## Context

内核（`nb-canon`）与剧情侧都已合进 master，但作者在应用里还看不到、用不上：canon 插件的浏览器入口只提供世界客户端，没有界面。开发者 2026-11-10 定作者界面分两批，本计划只管第一批（设定侧）。

期望结果：打开星瑕样本项目，或在自己的作品里新建条目以后，能在应用里看条目树、打开条目页、切换位置、点值看来历、就地改、记一笔、看回执、处理待处理、看改动记录并还原。

开发者已定的（都有记录）：

- 2026-11-02（t16 第 1 到 3 轮）：条目树在侧栏“设定”；条目页、回执、变更详情是编辑器区的标签页；待处理、改动记录在底部面板，状态栏显示条数；回执不分种类；马甲挂本体下；分开写“初值”与“第 1 章开头”；几笔累出来的数不直接改；界面上不出现记录 id、Component、字段路径。
- 2026-11-10（t16 评审板第 7 版）：做最小的条目新建与删除；条目页刷新后恢复；点条目树不做预览标签；人物、面板的分页第一批就各写专门的界面；底部面板默认隐藏。
- 2026-11-10（评审板第 10 版）：批准第一批的 Spec；面包屑第一批就做。
- 2026-11-10（评审板第 9 版）：界面要用而内核给不出的八项补上，第一批前面加一片“内核补口”；“底部面板默认隐藏”的声明由 w00026 t24 在视图容器的合同里加，本 Task 在它提供之前按默认显示做。

依据：

- 合同：`docs/specs/canon/project.md`、`model.md`、`revisions.md`、`rendering.md`、`components.md`；`docs/specs/workbench/editor.md`（输出 33、“视图”一条）、`views.md`、`commands.md`；`docs/specs/ui/workbench-shell.md`、`workbench-layout.md`、`i18n.md`。
- 原型：草稿 worktree `.worktree/w00039-t16-drafts` 的 `world-engine/`（17 个组件，自带同步引擎）。
- 相邻的工作：工作台的视图容器（w00026 t24，提案已接受，实施中）。视图不写容器时各自是一个隐式容器，本 Task 的三个视图都不写。

审查核实出的现状（改变了第二版的前提）：

- **内核的合同不是现成的。** `preview` 只收写入请求与还原请求；`revisions` 的读取结果没有 ops；没有读章表的方法；`tree` 不带位置，不给出场、马甲关系与总数；来历只能整个条目一起要，步骤里没有安放；`changes` 不能筛“某位置之前”、不能倒序、没有总数；`entry` 不给字段的种类与约束；`recordDelta` 只收数。
- **页面标签只在活动时挂载**，切走就卸载，组件里的状态不保留（内容层本来就是每个标签一块，同种页面不共用实例）；`context` 是整个窗口共用的一个对象；存盘与恢复是纯模型，手里没有页面声明；恢复时贡献没交付显示的是“这个页面已经不在了”。
- canon 的浏览器入口没有 `onStartup`；内置命令的 id 有域词表，里面没有 `canon`。
- `@notnotype/nb-canon/node` 依赖 `node:fs`，真实的 `WorldService` 在真实浏览器（Lab）里跑不起来；Vitest 的组件测试在 Node 里，可以跑。canon 现有的测试场地（`testing/harness.ts`）引 `bun:test`、要起真实的项目子进程，在 Vitest 里不能用。
- 就地改与记一笔重发同一个请求 id 得到 `value-conflict`，不是第一次的结果（与 `revisions.md` 输出 16 的承诺不符）。
- 登记的类型变了、只改了某一章各段讲的线、世界只读时宿主给了新章序，这三种情况世界版本不动，也没有事件。
- 产品里的世界宿主没接小模型：语义档在产品里总是“还没归纳”。
- nb-ui 的 `Tree` 没有右键菜单、行内后缀与“再显示 N 项”的行。

工作方式：代码在 Work 的 worktree `.worktree/w00039-novel-writing-plugins`（分支 `feat/w00039-t31-author-ui`）；记录与 Spec 在主工作区；主会话写代码；审查分两路：内核补口（后端）派 Claude Opus（本会话约定不开 omp），界面与编辑器派 Claude Sonnet；每片验证过后单独提交，做完合入 master，不 push。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 条目树 | nb-ui 的 `Tree` 外包一层 `EntryTree`（右键菜单用 nb-ui 的 `ContextMenu`，“再显示 N 项”做成一个普通的树行） | 文件资源管理器的 `ExplorerTree` 绑着文件语义不复用，但照它的做法包；`Tree` 本身缺的行内后缀按 S3 实际需要给 nb-ui 加一个行尾插槽 |
| 页面里的控件 | nb-ui 现有的 `Tabs`、`Select`、`Switch`、`NumberInput`、`Input`、`Button`、`Badge`、`Banner`、`Dialog`、`Field` | 都现成 |
| 读取的缓存与失效 | 自己写一层薄的（“关键设计 三”） | 只要“按世界版本失效、同参数合并、同一轮事件合并重读”；查询库多一套概念与依赖 |
| 测试里的世界 | S2 写一个 Node 侧的场地：进程内的 `createWorldHost` 加 `remoteWorld`，经 `@notnotype/nb-runtime` 的 `createLinkPair` 接真实的 `createCanonClient`；断线与服务结束由场地关掉链路造出来。S2 第一步先验证这条路走得通；走不通时读取层改在 `bun test` 里用现有场地测，组件测试用读取层的真实实例加回放的客户端 | 不手写内存客户端：它会重写订阅、独占与断线，恰好是读取层要测的。现有场地在 Vitest 里跑不了 |
| Lab 场景里的世界 | 脚本从真实服务录下的读取结果，回放。录的时候用与产品宿主相同的配置（不接小模型、固定的时钟）；没录过的输入回一个固定的失败；写入类场景只演示静态的确认条与失败条，保存后的变化由组件测试覆盖 | 真实服务在浏览器里跑不了；录下来的是生成物，与真实实现同源，不手写 |

## 关键设计

### 零、内核补口（`packages/nb-canon/`、`plugins/canon/shared/contracts.ts`、`backend/remote.ts`）

十项：前八项是开发者定的补口，K9、K10 是第二轮审查查出的两处现有缺口。每项写进对应 Spec 的 planned 条目，实现后在三百万字夹具上按 `canon/project.md` 输出 14 的规模量一次。

| 项 | 加什么 | 给谁用 | Spec |
|---|---|---|---|
| K1 就地改与记一笔的预览 | 读方法 `previewEdit`：入参同 `editInPlace`、`recordDelta`、`recordNote`；只算不发。返回 `route`（改初值、改某条变更的第几个补丁、在某位置新记一条变更；是可以再加种类的联合）、预览的修订、后面改过同一地址的记录；世界层会拒收时返回同样的失败。预览不看也不记请求 id；只读、独占这些服务的状态不在预览里判断 | 就地改与记一笔的确认条 | `revisions.md` 输出 22 |
| K2 读一次修订 | 读方法 `revision {id}`：完整的修订，没有时为空 | 回执页 | `project.md` 输出 29 |
| K3 章表 | 读方法 `chapters`：按章序的章 id、序号、标题（宿主从章节文件名取）、各段讲的线，带读取戳 | 位置选择、各处“第 N 章” | `project.md` 输出 28 |
| K4 条目树与条目的关系 | `tree` 加读取位置；每项加位置上的名字、是否已出场、是谁的马甲；已删除而没有未删除子孙的不列，`hasChildren` 与新加的 `remaining` 按同一规则数。`entry` 加上级链、本体与分组（带视图令牌时不给） | 条目树、条目页的页头与面包屑 | `project.md` 输出 30、33 |
| K5 来历 | 读方法 `origins`：按一个地址取，**按步分页**、从最近一步往前，初值与归纳两步在页外；每步带安放与那条变更的文字；覆盖字段、列表元素与子字段、名字、简介、别名与主文字的块。`entry` 可以要每个字段的 `changedAt`（带视图令牌时不给） | 点值看来历、“第 N 章改过”、流水 | `model.md` 输出 37；`project.md` 输出 32 |
| K6 剧情变更的列表 | `changes` 的筛选加 `before`，加从新到旧，页带总数；新参数进游标 | 情节分页 | `project.md` 输出 31 |
| K7 字段声明 | 读方法 `components`：登记的 Component 类型与字段声明，带读取戳 | 就地改按字段出控件、新建条目选启用哪些数据 | `components.md` 输出 21 |
| K8 语义档的记一笔 | 写方法 `recordNote`：给读取位置、语义档字段、一句发生了什么与读到的值；变更的文字与事件是同一句 | 面板的“记一笔” | `revisions.md` 输出 23 |
| K9 重试 | 就地改、记一笔、语义档的记一笔先按请求 id 查：同样的输入返回第一次的结果，不同的输入 `request-id-reused`；存的是调用方输入的摘要 | 断线后的重试 | `revisions.md` 输出 24 |
| K10 版本不动的变化 | 事件 `inputChanged`：章表或登记的类型变了而版本没动时发 | 读取层 | `project.md` 输出 34 |

实现时照这几条做，不另想办法：

- **`changedAt` 不经来历算。** 来历每一步都要复制值，实测把条目读取从 0.24 毫秒拖到几十毫秒。做法：拿到这个位置在时间线上的下标以后，从它往前扫，对每个字段找第一条碰到这个地址（含元素与子字段）、这个补丁本身套上了的变更或给起点的核对点，不复制值；子线上带过去的值取原线上的那一条。两个引擎各做一次，进差分测试；规模脚本加一项“带 `changedAt` 的随机读”。
- **`origins` 的“空结果”在服务的读方法里判断**（条目不存在、路径不认、字段没有声明）。引擎按地址算来历的行为不变：就地改还在用它。
- **K9 照回写与还原的现成做法**：发布时把调用方输入的摘要作为请求摘要存下。
- `tree` 改了已删除条目的列法，`entry` 多了字段：先把现有调用方（剧情插件、测试）过一遍。`K7` 原来写的“每个命名空间带类型 id”与 K4 的“是否已删除、有没有子项”内核已经有，不用做。

第一批不补、界面相应收窄的（处理记录“甲”的 9、10）：

- 待处理的一键处理（“按正文改设定”“是剧情里的变化”“插一笔漏记的”）没有写入合同：第一批的待处理详情只读加跳转。
- **“改这一笔”与“改成生效”不用新的内核方法**：变更详情页读出这条变更（`object`）、换掉那一处的值或生效状态，照普通写入走 `preview` 与 `publish`（`revisions.md` 输出 7、8、17）。原型样本里“把蛋糕改成 −2,000”就是这样的一次写入。拼请求的函数放在 canon 插件的 `shared/`，只有这一处用。
- 删除条目的确认不写“几个子条目、被几处引用”的数目，只写“删除以后引用它的地方会显示已删除的条目，可以还原”。
- 含决策修改的修订还原需要作者来源：第一批不做授权，点了“还原”以后预览返回原因，对话框只写原因。

要守住的：新方法都走现有的视图令牌与预算规则（`project.md` 输出 18、24）；`previewEdit` 与随后的写入在同一份读取输入上结果一致（同 `revisions.md` 输出 5 对预览的要求）；两个引擎的差分测试覆盖 K5 新加的地址种类。

### 一、编辑器：带参数的页面标签（`packages/neuro-book/src/plugins/editor/`）

条目页、回执页、变更详情页都是“同一种页面、每个对象一个标签”。提案里的“带参数的虚拟文档”（草稿与保存、拆分、墓碑）是为作者编辑主 MDX 准备的（t28）；第一批的页面是读加小写入，只扩展页面标签：

- 声明加 `instances?: true`、`restore?: true`。`nbook.editor.open-page {id, arg}`：`arg` 是 1 到 200 个字符的字符串，`instances` 页面必须带，别的页面带了为 `invalid-args`。标签的身份是页面 id 加 `arg`（地址 `page://<id>?<arg 的 URI 编码>`），同一个已开着就切过去。`instances` 与 `openOnFirstVisit` 不能同写（声明校验里查，schema 表达不了）。
- **实例不用动**：内容层本来就是每个标签一块，页面在这一块里、只在标签活动时挂载。要补的是下面两条。
- **标签状态容器**：编辑器给每个页面标签一个响应式对象 `state`，按标签 id 存，寿命同标签：切走再回来还在，移到别的组还在，关闭才销毁，不存盘。实现可以给 `initialState(arg)`；页面的 `context` 带泛型，`state` 有类型。条目页把位置、按计划、当前分页、展开的来历、选中的值卡，以及填了一半的就地改与记一笔放在里面。
- **按标签的 context**：页面组件收到的 `context` 改成每个标签一份：原有的 `recent`，加 `arg` 与 `state`。无参数的页面（欢迎页、对话页、主题编辑器）收到的多两个字段，行为不变。
- **标题**：实现可以给 `title(arg)`，返回文字值或 null；编辑器在标签条里对它做响应式读取。编辑器在标签上记着最近一次得到的标题：`title(arg)` 为 null、没给、贡献方已停止（句柄撤回后不能再调实现，先判断）时显示记着的，再没有才是声明的标题。条目页的 `title` 读的是读取层里已有的名字，不为标题单独发请求。
- **恢复**：要不要恢复、`arg` 与记着的标题在打开时抄到标签上（`PageTab` 自带），存盘与恢复只看标签，不看声明：记录多一种形状 `{page: true, id, arg?, title?}`，别的页面仍是 `{page: true}`。所以刷新后没点开的条目标签也有名字，声明晚到时一次存盘不会把标签抹掉。恢复出来的标签分三种状态：声明在、实现已交付（正常）；声明在、实现还没交付（“正在加载页面”，交付后自己变成正常，一直不交付就一直是它，记为已知限制）；声明不在（“这个页面已经不在了”）。
- **面包屑**（开发者 2026-11-10 定第一批就做）：实现可以给 `breadcrumbs(arg)`，返回几段文字与可选的命令。编辑器的面包屑组件现在只认文件（段是根、目录、文件，必须有目录读取与大纲）：加一种“命令段”（没有下拉，点了执行命令），目录读取与大纲改成可选；编辑组算面包屑时对页面标签读实现的返回；`focus-breadcrumbs` 对有面包屑的页面可用。条目的上级链由 `entry` 的 `ancestors` 给（K4），不为面包屑另发请求。
- 不做：区分同名标签、拆分、固定、预览标签。

要守住的：`page://<id>` 的旧地址、`openOnFirstVisit`、三个现有页面的行为不变；`pageIdOf` 取 `?` 之前的部分；最近打开列表、标题动作对“页面没有当前文件”的假设不变。

### 二、样本与测试

- 样本：星瑕样本的 JSON 与转换从 `packages/nb-canon/tests/sample/` 挪到 nb-canon 的子路径 `@notnotype/nb-canon/sample`（不进主入口；S0 先对 `packages/AGENTS.md` 与 `docs/modules/monorepo-boundaries.md` 核对子路径与发布内容的约定，不合就改放 `packages/neuro-book/scripts/` 下、nb-canon 的测试经相对路径读同一份 JSON）。
- `packages/neuro-book/scripts/canon-sample.ts`：经真实的 `WorldService` 把样本发布到一个目录，生成一部完整的作品（活页夹三章正文加世界日志），开发与 e2e 共用；e2e 的接法照 `e2e/fixtures.ts` 与 `e2e/support/` 的现有做法。
- 组件测试（`*.dom.test.ts`，Vitest 在 Node 里）：用“技术选型”里那个 Node 侧的场地起真实的世界服务与真实的 `createCanonClient`，界面的读取层接在它上面。resync、ended、独占这些路径由场地真实触发。场地与 canon 的 `bun test` 场地各跑同一组契约用例（订阅、独占、断开后的失败码）。
- Lab 场景：组件都是受控的领域视图，场景用手写的 props，不用读取录像（2026-11-11 改，见“S4 的细计划”）。

### 三、读取层（`plugins/canon/web/world.ts`）

界面不散着调客户端。窗口里一份读取层：

- 订阅先于第一次读取建立。`version` 跟 `changed` 事件走；`resync` 时重读 `status`；`ended` 之后标成断开。
- `read(method, input)` 返回 `{data, error, loading}`。同一个 `(method, input)` 在同一个读取戳里只发一次（章表与登记的类型版本不动也会变，收到 `inputChanged` 重读）；版本变了，**只重读前台可见的**读取，同一轮事件（一个微任务里到的几条 `changed`）合并成一次重读；不可见的回到前台时重读；重读期间保留旧数据。
- 来历不随条目页整页读：点开一个值时才调 `origins`（K5）。“第 N 章改过”来自 `entry` 的字段状态（K5），不读来历。
- 翻过页的列表在游标过期后，按已读的条数从头重读一次，不丢作者的位置。
- 本窗口的写入成功返回时，读取层立刻把已知版本抬到返回的版本并重读可见的读取，不等 `changed` 事件；事件随后到达时版本已经一样，不再重读。
- 没人用的读取结果留着，最多留最近用过的 64 个键，多了丢最久没用的。页面标签切回来时重新挂载，先拿到留着的旧数据，同时重读；同一个页面的几个读取都回来以后一起换。
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
| 变更详情页 | 页面 `nbook.canon.change`，参数是剧情变更 id | `ChangeDetail` | `object`；改一处的值或生效状态走 `preview`、`publish` |
| 待处理 | 底部面板视图 `nbook.canon.pending` | `PendingView` | `pending` |
| 改动记录 | 底部面板视图 `nbook.canon.revisions` | `RevisionsView` | `revisions`、还原的 `preview` |
| 状态栏 | 条目 `nbook.canon.pending-count` | — | `pending` 的总数；显不显示由公开状态 `nbook.canon/hasPending` 定 |
| 保存后的提示 | 前台是三种页面之一时在页面顶部；否则是一条工作台通知 | `NoticeBar` | 刚发布的修订；读取层持有这一条 |

- 命令 id 用 `nbook.canon.*`，`commands.md` 的域词表加 `canon`（S0）。
- 条目页的页头、位置选择、分页、来历、情节分页照 t16 已定的注意力顺序；“改”做成值旁常显的小按钮（悬停才出现的在触屏上找不到）；点了以后确认条贴在分页顶上，输入控件在确认条里（专门界面的值在它自己的组件里，条目页没法替它换成输入控件，所以两种界面用同一种确认条）；每个页面的内容列都封顶。
- **数据分页的贡献点** `canon.component-views`：贡献 id 是 Component 类型 id，声明 `{title?}`，实现 `{load()}`。界面组件收到的 `context` 是 canon 的 `shared/` 里定义的窄接口：这个条目与命名空间在所选位置上的字段状态（响应式）、字段声明、世界版本（第二批的界面要读剧情插件的远程方法，按它重读）、看一个地址的来历、发起就地改、记一笔（返回成功或失败的原因）。不把读取层交出去。点的定义照 `editor.pages`：必须交实现、id 按插件前缀校验、标题有约定键。canon 自己给人物、面板各贡献一个界面；别的类型用通用字段表。
- 新建条目的对话框：名字、条目的种类（人物、地点、物品这类分组用的词，可以新写）、放在谁下面、启用哪些数据（已登记的 Component 类型，K7）、从哪里出场（缺省“一开始就在”）；顺序排在同层最后。
- 写入的入口：就地改（确认条选“改设定”或“剧情里变了”，预览走 K1）、记一笔（精确档走 `recordDelta`，语义档走 K8）、改一条变更里的数与把待定的改成生效（普通写入）、还原（先预览依赖；对话框在结果回来前不关）、新建与删除条目。
- 语义档归纳后的样子在产品里看不到（宿主没接小模型）：第一批只保证“还没归纳”的写法，归纳后的写法在 Spec 里标 planned。
- 变更详情页与待处理里“到原句”：第一批只在编辑区打开那一章；选中原句要编辑器提供按原文定位的能力，标 planned。
- 失败的呈现：各失败码有固定的写法（`author-ui.md` 的失败表与输出 29），不把码给作者看。
- 三个视图的声明写 `order`（设定 10，排在文件资源管理器之后；不写会按 id 排到它前面）、图标与标题。

#### S3 的细计划（2026-11-10，开工前补）

- **nb-ui `Tree`**（`packages/nb-ui/src/components/navigation/Tree.{vue,md}`）：节点加 `muted?: boolean`（标题用次级色）；加插槽 `suffix`（`{node}`，标题后面的一小段说明，例如“未出场”）；每行带 `data-tree-id`，包一层右键菜单的调用方据此知道右键的是哪一行。都是通用的，不带条目语义。Lab 场景补一个带后缀与次级色的；`Tree` 的 `.dom.test.ts` 补三条。
- **界面文字**：canon 插件加 `locales/{zh-CN,en-US}.json` 与 `web/text.ts`（照 `explorer/web/text.ts`），在 `web/plugins.ts` 的 `builtinPluginCatalogs` 登记。
- **`EntryTree`**（`plugins/canon/web/components/EntryTree.{vue,md}`，领域视图、受控）：props 是按父条目分好的各层（`{items, remaining, loading}`）、展开的 id、选中的 id；根下按分组插一层分组节点（分组节点的 id 带前缀，不可打开）；未出场的 `muted` 加后缀“未出场”，已删除的加“已删除”；一层有剩余时末尾一行“再显示（还有 N 项）”。emits：`open(id)`、`update:expanded`、`more(parent)`、`menu(id | null, event)`。不发请求。Lab 场景用手写的各层数据（它不读世界，不需要录像）。
- **视图宿主**（`plugins/canon/web/entries-view.ts`，渲染函数写，同 `explorer/web/view-host.ts`）：用读取层的 `list("tree", {parent, position: 缺省位置})` 读根与每个展开的父条目；展开时才读那一层；`more` 调列表的 `more()`；树跟着世界变由读取层保证，展开状态在宿主里（视图实例的寿命），选中项跟着活动的条目页（S4 之前没有条目页，选中项是最后点过的那个，不在了就清掉）。没有绑定项目时只显示一句“打开作品后可用”。打开条目经命令 `nbook.canon.open-entry`；宿主收一个 `execute(id, args)` 端口。
- **缺省位置**：最新一章末尾；没有章时是初值（`author-ui.md` 输出 7 的“缺省位置”）。宿主读 `chapters` 得到。
- **入口**：canon 的浏览器入口改成 `onStartup`，在激活时建本窗口的那份读取层（用入口自己的远程访问），交视图 `nbook.canon.entries`（侧栏、`order: 10`、图标 `i-lucide-book`）与命令 `nbook.canon.open-entry`（执行编辑器的 `nbook.editor.openPage`，页面 `nbook.canon.entry`，参数是条目 id）。条目页在 S4 才登记，S3 之间打开得到编辑器的“这个页面已经不在了”。
- **测试**：`EntryTree.dom.test.ts`（纯组件）；`entries-view.dom.test.ts` 接进程内的真实世界：分组与次级色、展开时才读、“再显示”、别处发布后展开状态保留且内容更新、点了执行打开命令。

#### S4 的细计划（2026-11-11，开工前补）

S4 只做读：页头、位置、分页、文字、来历、通用字段表、人物、面板、情节、贡献点、量读取。“改”按钮、确认条、记一笔的输入都在 S5；S4 的界面不画写入入口。

- **组件按“受控领域视图”拆**（同 `EntryTree`：数据由宿主给，只把点击翻成事件，Lab 场景用手写数据）。原计划“Lab 场景用读取录像回放”改为不用：受控组件不读世界，手写的 props 就是场景；录像只在要在 Lab 里跑读取层时才需要，第一批没有这样的组件。宿主 `.ts` 不引 nb-ui（应用 tsc 没有 DOM 类型），所以页面骨架也是一个 `.vue`：
  - `EntryPage.vue`：页头（名字、简介、“是谁：某某”、位置选择、“按计划”开关）、未出场一行、“原来选的那一章已经不在了”、断开横幅、分页条，分页内容是默认插槽；状态 `loading | missing | deleted | normal`。
  - `EntryText.vue`：给作者的渲染（`AuthorBlock[]`）。块是 mdast；条目 MDX 允许 CommonMark 加方言，自己写一个小的递归渲染（段落、标题、列表、引用、强调、行内代码、代码块、链接显示文字、分隔线、换行；别的节点显示它的纯文本），canon 节点：值是按钮（读屏名“显示名：值”），后面是“改过”标记；未知、不完整照输出 10；`canonRef` 是到条目页的链接；出错的块显示纯文本与原因。展开的来历是插槽，紧跟所在块之后。不复用 nb-markdown 的展示器：它收原文、自己解析，接不进已经算好值的语法树。
  - `OriginList.vue`：来历的一页（`origins` 的 `items` 加 `initial`），从新到旧、初值最后；“再显示更早的（还有 N 步）”；估计的依据警告色带“估计”；变更给出的步行尾“改这一笔”；读取失败写原因与“重试”。条目页的文字分页、通用字段表、人物与面板的流水共用。
  - `FieldTable.vue`：通用字段表（输出 12），列表字段一行一个元素；值可点，展开的来历是插槽。
  - `PersonView.vue`、`PanelView.vue`：canon 给 `nbook.canon.person`、`nbook.canon.panel` 交的数据分页界面，收 `{context}`（下面的贡献点）；人物复用 `FieldTable` 再加语义档的起点与之后各句；面板是值卡加流水（来历），390 像素宽上下排。
  - `PlotList.vue`：情节分页（输出 15）。
- **“改过”与位置的写法**：`web/positions.ts` 一组纯函数：章表 → 位置选项；读取位置 ↔ 选项值；安放（`Placement`）→“第 N 章”“前史”；`changedAt` → 标记文字。测试用纯单元测试。
- **贡献点 `canon.component-views`**：点与声明的 schema 在 `shared/component-views.ts`（`implementation: "required"`、`idPrefix: "plugin"`、只收浏览器入口，照 `editor/shared/contracts.ts` 的 `editor.pages`）；实现与 `ComponentViewContext` 的类型在 `web/component-views.ts`（要 Vue 的类型），注册表照 `editor/web/pages.ts`：每次经句柄取实现，句柄撤回后换成通用字段表，换了句柄重新加载。`context` 在 Spec 的形状上补两项（回 S0 改 `author-ui.md` 的输入一节）：`state`（这个分页在标签上的状态，例如面板选中的值卡，切走再回来还在；输出 7 要求它随标签，而界面组件随标签卸载）与 `blocked`（写入入口不可用时的原因，输出 28；没有为 null）。S4 里 `edit`、`record` 先交“写入不可用”（与 `blocked` 同一条路径），S5 换成真的。
- **页面 `nbook.canon.entry`**（`web/entry-page.ts`）：编辑器页面贡献，`instances: true`、`restore: true`，声明标题是约定键（“条目”）。
  - `initialState(arg)`：`{position: null, planned: false, tab: null, origin: null, views: {}}`。`position: null` 表示缺省位置，跟着章表走；选过的章被删掉时回到 null 并记一句提示（输出 7）。
  - 读取（都经读取层、组件挂载时才建、卸载时释放）：`entry`（带 `withChangedAt`）、`chapters`、`components`（分页名的最后一档）；当前分页是文字时 `render`；展开一个值时 `list("origins", …, 20)`；当前分页是情节时 `list("changes", {filter: {entry, before: {position, mode}, order: "desc"}}, 50)`。不在前台的分页不读。
  - `title(arg)`、`breadcrumbs(arg)`：读本模块的一张响应式表“各条目最近读到的页头”（名字、分组、上级链），由挂着的条目页写入。所以标题与面包屑不另发请求；不在前台的标签用编辑器记着的标题（editor.md 输出 33 已经这样处理）。面包屑：“设定”执行 `nbook.view.open`（视图 `nbook.canon.entries`），上级执行 `nbook.canon.open-entry`，分组与名字不带命令。
  - 选中项：条目树的选中跟着活动的条目页（宿主订阅编辑器的活动标签；拿不到这个信号就保留 S3 的“最后点过的那个”，记为已知限制）。
- **测试**：
  - 组件：上面每个 `.vue` 一份 `*.dom.test.ts`（手写数据），配同名 `.md`、Lab 场景（含 390 像素宽、加载、找不到、已删除、未出场）。
  - `entry-page.dom.test.ts`：接进程内的真实世界（`canonNodeWorld`），测试里经真实服务发布人物、面板与几笔记账（不等样本）：打开后名字、简介、标题、面包屑；换位置后文字与值卡跟着变；点值才读来历、先 20 步、“再显示”；状态在卸载再挂载后还在、两个条目各有各的；找不到、已删除、未出场；情节从新到旧、总条数；别处发布后原地更新、不出加载占位；断开横幅。
  - `component-views.dom.test.ts`：照 `editor/web/pages.dom.test.ts` 用真实的贡献接收：有界面用它、撤回后换成通用字段表、再交付换回、加载失败回退并写原因（验收 9）。
- **量读取**：`entry-page.dom.test.ts` 里用计数包装（同 `entries-view.dom.test.ts`）记下“条目页开着、树展开两层、一次别处发布”引起的读取次数，写进断言的上限并记入 `evidences/`；`scripts/perf/canon-scale.ts` 加“打开热门条目页的一组读取”（`entry` 带 `changedAt`、`render`、`chapters`、`components`、情节第一页、来历第一页），记各自的字节数与耗时。超过单次预算的一半回来改。
- **审查**：S4 是界面里最大的一片，提交后派一个 Sonnet 做前端实现审查（后台，不阻塞 S5），结论回来单独修。

#### S5 的细计划（2026-11-11，开工前补）

S5 做条目页上的写入：就地改、记一笔、保存后的提示、新建与删除条目、写不了时的呈现与写入失败的呈现。“撤销”（还原）要预览依赖的对话框，与回执页的“还原这次修订”一起放 S6；S5 的提示先只有标题、“看回执”（命令在 S6 登记）与关闭。

- **能不能写**（`web/writable.ts`）：由读取层的 `status`（`state`、`reason`、`exclusive`）与连接（`ended`）算出一句原因或 null，三种页面与 `ComponentViewContext.blocked` 共用（输出 27、28）。独占事件已让读取层重读 `status`，独占结束后自动恢复。
- **失败的写法**（`web/failures.ts`）：失败码到界面文字的一张表（输出 29 与失败表），写入的各个入口共用；`value-conflict` 带回新值、`accumulated-value` 要展开来历、`unknown-outcome` 给“再查一次”（同一输入、同一请求 id，读取层的 `write` 已按请求 id 查结局）。码不给作者看。
- **就地改**：
  - `FieldTable` 每行加“改”按钮（行的 `editable` 与 `editReason`：按计划开着时写“先关掉按计划”；列表、图片、引用这几种字段第一批不就地改，没有按钮）；发 `edit(path)`。人物、面板的界面经 `context.edit(path)` 请条目页打开确认条。
  - 确认条 `ConfirmBar.vue`（受控）：字段名、按声明的输入控件（数 `NumberInput`、文字 `Textarea`、选项 `Select`、是否 `Switch`）、意图二选一（初值时没有“剧情里变了”，不完整时只有它）、预览的两句（写回哪里、带来的变化）、原因、保存与取消；贴在分页顶上（`sticky`），焦点进输入控件，保存或取消（含 Escape）后焦点回到那个“改”按钮（按 `data-edit` 找）。
  - 宿主（`EntryPageHost`）：确认条的状态在标签状态里（`state.edit`：路径、填的值、意图、读到的值与版本），切走再回来还在（验收 2）。填了值以后预览（`previewEdit`，输入停 300 毫秒再发，版本变了重取）；写回哪里按 `route` 写：“改初值”、“改第 N 章‘某某’那一笔”（变更的文字经 `object` 读）、“在某位置记一条变更”；带来的变化取预览里修订的 `impact`，写成“多了 N 条待处理”“少了 N 条”“某某跟着变成 X”这几种短句。`accumulated-value` 时写“这个数是几笔累出来的”，展开那个值的来历，保存不可用。保存走 `world.write("editInPlace", …)`；成功后关掉确认条、给提示。打开期间世界版本变了：值没变就重取预览；变了就按 `value-conflict` 写“这个值刚刚变了”并换上新值。
- **记一笔**：`PanelView` 的 `record` 插槽放 `RecordForm.vue`（受控：精确档是变化量加一句话，语义档只有一句话；不可用时写原因：初值时“先选一章”、按计划时“先关掉按计划”、`blocked`）。`context.record` 由宿主实现：精确档走 `recordDelta`，语义档走 `recordNote`；成功后输入清空，失败时原因写在输入下面。填了一半的输入在 `context.state` 里。
- **保存后的提示** `NoticeBar.vue`：本窗口每次发布成功给一条，标题、“看回执”、关闭（“撤销”S6 加）。条目页挂着时显示在页面顶上；不在条目页的写入（S6 起才有）走工作台通知。提示由本窗口的一份“最近一次提示”持有（插件入口里），切到另一个条目页时跟过去。
- **新建条目**：命令 `nbook.canon.new-entry {parent?}`、设定视图标题栏的“新建条目”、条目树的右键菜单“在它下面新建”（`EntryTree` 加 `menu` 事件与 `ContextMenu`），打开 `NewEntryDialog.vue`：名字、种类（已读到的条目用过的种类与两个内置类型的名字里选，也可以新写）、分组（缺省同种类）、放在谁下面、启用哪些数据（`components` 读到的类型）、是谁的另一个身份、从哪里出场（缺省一开始就在，否则选一章的开头）。确认后 `publish` 一个新条目（顺序排在同层最后：同层已读到的最大 `order` 加 1），成功后打开它的条目页、给提示。
- **删除条目**：条目页页头加“更多”（`DropdownMenu`）里的“删除条目”，确认对话框（`AlertDialog`）写 Spec 的那句；确认后读出存下的条目、`publish` 带 `deleted: true` 的版本；`not-deletable` 时对话框里写服务给的原因。
- **测试**：组件各一份 `*.dom.test.ts`（`ConfirmBar`、`RecordForm`、`NoticeBar`、`NewEntryDialog`、`FieldTable` 的“改”）配文档与 Lab 场景；`entry-page.dom.test.ts` 接真实世界加：改只在初值设过的字段（预览“改初值”、保存后值变了、有提示、焦点回到“改”）；累出来的数；按计划时“改”不可用；确认条开着时别处改了这个值（“这个值刚刚变了”）；记一笔精确档与语义档；别的窗口独占时写入入口不可用并写出它给的那句、释放后恢复；切走再回来确认条与填的值还在；新建（经设定视图）与删除。

#### S6 的细计划（2026-11-11，开工前补）

S6 做回执页、变更详情页与还原，并把 S5 留下的“撤销”、不在条目页时的工作台通知补上。

- **页面**（同条目页的做法：`web/receipt-page.ts`、`web/change-page.ts` 各一个编辑器页面贡献，`instances`、`restore`；宿主 `.vue` 标 `io:read`，骨架受控、配 Lab）：
  - 回执页 `nbook.canon.receipt`（参数是修订 id）：读 `revision`（输出 20）。“改了什么”按对象分节（新建、修改、删除；修改的列出每个字段的显示名与改前改后，显示名经条目的 `declarations` 取），章序调整只有一节；“带来的变化”是修订存下的 `impact`。条目、剧情变更名字是链接。页头“还原这次修订”（`revertable` 不行时按钮旁写原因）；它本身是一次还原时写明还原的是哪一次并链接过去。面包屑“设定 › 改动记录 › 标题”，“改动记录”执行 `nbook.view.open`（视图在 S7 登记，之前执行失败）。
  - 变更详情页 `nbook.canon.change`（参数是剧情变更 id）：读 `object`（输出 21）。文字、安放、已写还是计划、生效状态、原句（出处是章节正文的“打开这一章”经编辑器的打开文件命令）、涉及的条目、每一处改动。数的改动旁“改”：页面顶上同 `ConfirmBar` 的确认条（没有意图），保存是对这条变更的普通写入（读出、换掉那一处的值、`preview` 再 `publish`，`baseVersion` 用读出时的版本，被别处改过时得到 `version-conflict`）。待定时页头写原因与“改成生效”（同样先预览再发布，校验不过写第一条原因）。
  - 命令 `nbook.canon.open-receipt {revision}`、`nbook.canon.open-change {id}`（S4、S5 已在调用）。
- **还原**（输出 22）：`RevertDialog.vue`（受控）与 `web/revert.ts`：点了先 `preview` 还原请求；没有依赖时写带来的变化与“还原”；有依赖（`has-dependents`）时从新到旧列出依赖的修订（标题，经 `revision` 读），给“连同这些一起还原”与“取消”；`not-revertable`、`author-source-required` 时只写原因、没有确认。确认后 `revert`；结果回来之前对话框不关、按钮不可用，失败时原因写在对话框里，成功后关掉并给提示。回执页的“还原这次修订”与提示里的“撤销”共用这一个。还原的对话框放在窗口里一份（入口里），哪里打开都一样。
- **提示**（输出 18 的后一半）：`NoticeBar` 加“撤销”。前台不是三种页面时走工作台通知：本入口依赖 `notificationsKey`（可选）与编辑器的活动标签（取不到时一律走页面顶上的那一条）。工作台通知只有一个动作按钮（`NotificationInput.action`），放“看回执”，“撤销”从回执页做；这与 Spec 的“看回执”“撤销”都是它的动作不符，记进待确认（要两个动作得改 `workbench.notifications`）。
- **测试**：回执页、变更详情页接真实世界（改一笔后回执列出改前改后；变更详情里改那一处的值、改成生效、读出后别处改过得到“这个对象刚被改过”）；还原（没有依赖、有依赖连同一起、不能还原只写原因；验收 6、12 的界面部分）；组件测试、文档与 Lab。

### 五、底部面板默认隐藏

待处理、改动记录两个视图不写容器，各自是底部面板里的一个入口。“默认隐藏”的声明由 w00026 t24 加；它提供之前底部面板按现行规则默认显示，S7 的外壳 e2e 基线按“默认显示”写一遍，声明到位后改声明与基线各一处。

## Spec 与文档改动（S0，草稿已写，未提交）

| 文件 | 改什么 |
|---|---|
| `docs/specs/canon/project.md` | 方法表加 `previewEdit`、`revision`、`chapters`、`origins`、`components`、`recordNote`，事件加 `inputChanged`；输出 28 到 35；验收 10。顺手把打断方法表的一段挪到表后 |
| `docs/specs/canon/revisions.md` | 输出 8 表里写明“改其中某一笔”怎么做；输出 22 到 24；验收 8 |
| `docs/specs/canon/model.md` | 输出 37（按地址、按步分页的来历） |
| `docs/specs/canon/components.md` | 输出 21（读登记的类型） |
| `docs/specs/canon/author-ui.md`（新，`planned`） | 第一批的界面行为 |
| `docs/specs/workbench/editor.md` | 输出 33 的“带参数与可恢复的页面”、`editor.tabs` 的记法、命令表、验收 44 |
| `docs/specs/workbench/commands.md` | 域词表加 `canon` |
| `docs/specs/README.md` | 注册表加 `canon/author-ui.md` |
| `docs/modules/monorepo-boundaries.md` | nb-canon 的导出清单加样本子路径（实施时） |
| `packages/neuro-book/AGENTS.md` | 命令一节加生成样本项目的脚本（实施时） |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | Spec（上表）。两路审过两轮；请开发者批准后提交为 planned | `bun run docs:check` |
| K-a | K2、K3、K6、K7、K10：纯加读取与一个事件，互不相干 | nb-canon 的 `service.test.ts`、应用的 `canon.test.ts`、类型检查；规模脚本 |
| K-b | K4、K5：`tree`、`entry` 的关系与 `changedAt`、分页的来历（要动两个引擎） | 同上，加差分测试；规模脚本加“带 `changedAt` 的随机读”与“主角字段的来历一页” |
| K-c | K1、K8、K9：预览、语义档的记一笔、重试 | `revisions.test.ts`、`edits.test.ts`；预览与发布一致、同一请求 id 重发的用例 |
| — | 内核补口的实现审查（Opus），修正 | — |
| E | 带参数的页面标签（状态容器、按标签的 context、标题与记着的标题、恢复、声明校验、页面的面包屑） | 编辑器的 `bun test` 与 `*.dom.test.ts`、`e2e/editor-area.e2e.ts`、`e2e/welcome.e2e.ts` |
| S2 | Node 侧的测试场地（先验证走得通）；样本与生成脚本；读取层（入口的 `onStartup` 与命令的域挪到 S3：第一个视图出现时才有要在启动时交付的东西） | `sample.test.ts`、场地的契约用例、读取层的测试（真实服务：失效、合并、写入返回抬版本、留 64 个键、resync、ended） |
| S3 | 条目树（`EntryTree`）；入口的 `onStartup`、读取层在入口里的那一份、命令的域 | `*.dom.test.ts`；Lab 场景 |
| S4 | 条目页（文字、位置、来历、情节）；贡献点、通用字段表、人物与面板两个界面；量读取次数与耗时 | `*.dom.test.ts`；Lab 场景；数字记进 `evidences/` |
| S5 | 写入：就地改、记一笔、保存后的提示、新建与删除条目、失败的呈现 | `*.dom.test.ts`（真实服务上写入后界面跟着变） |
| S6 | 回执页、变更详情页 | 同上 |
| S7 | 底部面板两个视图、状态栏条目 | 同上；外壳 e2e |
| K-d | 内核读取的性能（S4 的测量发现，2026-11-11 加）：`changes` 按条目建索引、不每次建线表；热门条目的 `entry`（带 `changedAt`）与 `origins` 的时间线扫描。目标是打开热门条目页的每个读取都在单次预算的一半以内 | `canon-scale.ts` 的“打开热门条目页的一组读取”；nb-canon 的差分与合同测试 |
| S8 | e2e、截图取证、组件文档、实现审查（Sonnet）、逐条核对后晋升 Spec | 见“验证” |

K 三片与 E 互不依赖，可以交替做；S2 起依赖它们。每片先写用例再写实现，验证过后单独提交。

## 验收映射

| 行为 | 覆盖 |
|---|---|
| `project.md` 输出 28 到 35、验收 10；`revisions.md` 输出 22 到 24、验收 8；`model.md` 输出 37；`components.md` 输出 21 | nb-canon 的合同测试、应用的 `canon.test.ts`、差分测试、规模脚本 |
| `editor.md` 输出 33 的 planned 段、验收 44 | `editor/area.test.ts`、`groups.test.ts`（存盘与恢复只看标签）、编辑组的 `*.dom.test.ts`、`e2e/editor-area.e2e.ts` |
| `author-ui.md` 输出 1 到 33、验收 6 到 14 | 各组件的 `*.dom.test.ts`（真实服务） |
| `author-ui.md` 输出 26、27 与读取次数、大小的上限 | 读取层的测试与 S4 的测量 |
| `author-ui.md` 验收 1、2、3、5 | `e2e/canon-author.e2e.ts` |

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

- **内核补口改的是已 implemented 的 Spec。** `tree` 不再列没有未删除子孙的已删除条目，`entry` 的返回多了字段，现有调用方（剧情插件、测试）要过一遍；剧情插件按视角过滤条目时用展开的写法，新加的上级、本体与 `changedAt` 靠“带视图令牌时内核不给”守住，K-b 加一条带令牌读的用例。K5 动两个引擎，由差分测试兜底。
- **Node 侧的测试场地是新东西。** S2 第一步先验证；走不通按“技术选型”里的退路。
- **第一批比第一版大了约三分之一**（内核三片十项加页面标签的状态容器与恢复）。K 与 E 先做，做完界面各片才开工；任何一片发现合同还缺东西，回 S0 补 Spec，不在界面里绕。
- **底部面板第一次有产品视图**，而且赶上视图容器换模型。S7 开头先放一个空视图跑通布局与外壳 e2e；t24 合入的先后会影响 S7 的基线，开工前看它的状态。
- **原型组件是同步引擎上的。** 搬过来时每个读取都变成异步，加载中与失败两种状态要逐个补。
- **Lab 场景的手写数据会与世界合同脱节。** 场景数据用组件 props 的类型写，世界合同变了由类型检查与宿主的真实服务测试兜底。
