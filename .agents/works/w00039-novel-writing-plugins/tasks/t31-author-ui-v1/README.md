---
schema: nbook.task/v2
taskId: t31-author-ui-v1
status: active
updated: 2026-11-18
---

# 作者界面第一版

## 目标与范围

在 nb-canon 内核上做作者界面的第一版：样本项目打开后能在应用里看条目、切换位置、看回执与待处理、就地改、记一笔、还原

合同：要新写作者界面的 Spec（`docs/specs/canon/author-ui.md`，S0 写），并改编辑器 Spec 的页面标签（[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 33）；读写世界按 [`canon/project.md`](../../../../../docs/specs/canon/project.md) 的方法表。

## 当前状态

2026-11-10 开发者定“按你的建议分两批开始”，本 Task 恢复：剧情侧（t32 到 t35）已做完，11-04 搁置的理由不再成立。

- **第一批（设定侧）**：2026-11-18 完成，合进 master（`4c242d226`），`canon/author-ui.md` 晋升 `implemented`。范围照下面“第一版拟定的范围”，实施计划见 [`plan.md`](plan.md)；过程记录在下文，收尾见最后几条。
- **第二批（剧情侧）**：剧情容器、时间线、知情、伏笔账本、目标表、决策、检查、简报预览（剧情表不在本批，见待确认清单 11-19）。静态稿在 [t16](../t16-plot-workbench-ui/README.md) 第 4 到 6 轮，开发者 11-10、11-11 答完。2026-11-19 起自主推进：分四期（[`plan-b2.md`](plan-b2.md) 的“第二批的分期”），第一期 B2-1（读的几张表与人物页）的计划第一版经设计审查两路 44 条（都成立，[处理](evidences/b2-design-review-resolution.txt)），改成第二版：剧情读取另开作者用的 `nbook.plot/author`、先在低负载下量剧情读取的规模再定索引（omp 实测现有读取在 1000 章上输入一变第一次读要 33 到 76 秒）、专门界面带一节通用字段、加组件测试的场地。
- 前置的缺陷已修：内核来历的初值一步被后面的补丁改到（1a0080305）。

2026-11-04 经 nbdev 新建。同日开发者看过范围后收回提前：时间线还没做好，先不做界面（Work README 决定表）。

第一版拟定的范围：设定容器与条目树；条目页（位置选择、文字与 Component 的 Tab、点值看来历、面板流水与记一笔）；就地改的确认条与保存后的提示；回执页；变更详情页（保存前预览）；底部面板的待处理与改动记录、状态栏计数；星瑕样本项目。前置的平台改动：编辑器现在的标签只能开文件或无参数的页面，要先做“带参数的页面标签”（内核提案“五、影响”里的“带参数的虚拟文档”的最小版）。

开发者 2026-11-10 在 [t16 评审板](../t16-plot-workbench-ui/artifacts/review/index.html)第 7 版答了 `plan.md` 末尾的五项（答复 `20261110T065353529Z-971ce853`）：

| 题 | 决定 |
|---|---|
| `b1-entry-crud` | 做最小的条目新建与删除（推荐项） |
| `b1-restore` | 条目页刷新以后恢复（推荐项） |
| `b1-preview` | 第一批不做预览标签，单击就开正式标签（推荐项） |
| `b1-component-tabs` | **第一批就给人物、面板各写一个专门的界面**（没按推荐的通用字段表） |
| `b1-panel-quiet` | 底部面板默认隐藏，靠状态栏“待处理 N”打开（推荐项） |

设计审查（2026-11-10，Claude Sonnet，审计划第二版与 Spec 草稿）：35 条（阻断 4、重要 22、建议 9），核实后都成立（[报告](evidences/design-review-sonnet.txt)、[处理](evidences/design-review-resolution.txt)）。两件大事：

- **计划把内核合同当现成的，实际要补八项**（就地改的预览、回执的“改了什么”、章表、条目树的位置与出场和马甲与总数、来历里每一步的安放与按地址读、情节分页的筛选与倒序、字段声明、语义档的记一笔）。补它们要改内核、世界服务的接口与四份已 implemented 的 canon Spec，是范围的变化，放到 t16 评审板第 9 版问开发者（`b1-kernel-gaps`：补还是收窄，推荐补）。
- **带参数的页面标签比计划写的大**：页面标签只在活动时渲染、没有按标签区分的实例，context 是窗口共用的。改成每个标签自己的实例加一个随标签寿命的状态容器。

Spec 草稿 `docs/specs/canon/author-ui.md` 与 `editor.md`、`docs/specs/README.md` 的改动都还没提交，等 `b1-kernel-gaps` 定了以后与计划第三版一起重写，不照现在的草稿实施。

另：写 Spec 时发现“底部面板默认隐藏”要落在工作台的视图容器合同里（w00026 t24 正在改），本 Task 没动那两份 Spec，放到评审板问由谁加（`b1-panel-default-owner`）。

开发者 2026-11-10 在 t16 评审板第 9 版答（答复 `20261110T081136877Z-57ae1ba0`）：`b1-kernel-gaps` 选“补上这八项，第一批前面加一片内核补口”（推荐项）；`b1-panel-default-owner` 选“让 t24 顺手加”（推荐项，由开发者转告那边；本 Task 在它提供之前按默认显示做）。

S0（2026-11-10）：计划第三版已提交（2ba5231dd）。Spec 草稿写在主工作区、**未提交**：四份内核 Spec 的补口条目（`canon/project.md` 方法表与输出 28 到 32、`revisions.md` 输出 22、23 与 18 末句、`model.md` 输出 37、`components.md` 输出 21）、重写的 `canon/author-ui.md`、`workbench/editor.md` 输出 33 的“带参数与可恢复的页面”、`workbench/commands.md` 的域词表、`docs/specs/README.md` 的登记行。第二轮设计审查分两路在跑：内核补口派 Opus、界面与编辑器派 Sonnet，说明与报告在 `/tmp/review-w00039-t31-design2/`（处理后存进 `evidences/`）。

第二轮设计审查（2026-11-10）：内核补口派 Claude Opus（15 条：阻断 1、重要 7、建议 7），界面与编辑器派 Claude Sonnet（18 条：阻断 1、重要 8、建议 9）。33 条逐条核实都成立：27 条改了 Spec 与计划，4 条记为已知限制，2 条随改，面包屑交开发者定。报告在 [`evidences/design-review-r2-kernel-opus.txt`](evidences/design-review-r2-kernel-opus.txt)、[`evidences/design-review-r2-ui-sonnet.txt`](evidences/design-review-r2-ui-sonnet.txt)，处理在 [`evidences/design-review-r2-resolution.txt`](evidences/design-review-r2-resolution.txt)。要点：

- 来历改成按步分页（主角字段的来历有几千步，整份返回会超远程预算）；`changedAt` 改成可选、倒扫时间线算。
- 内核补口从八项变成十项：加“重发同一请求 id 返回第一次的结果”（现有缺陷）与事件 `inputChanged`（章表、登记变了而版本不动）。
- “改这一笔”与“把待定的改成生效”不加内核方法，按对那条变更的普通写入做。
- 带视图令牌时不给上级、本体与 `changedAt`：剧情插件按视角过滤时会原样带出。
- 页面标签：实例本来就是每个标签一份，要补的是标签状态（含填了一半的输入）、记着的标题、存盘与恢复只看标签。
- 组件测试用的世界：现有场地在 Vitest 里跑不了，S2 先写 Node 侧的场地。
- 面包屑第一批不做，放到 t16 评审板第 6 轮上问。

计划改成第四版；Spec 草稿相应改过，仍未提交，`bun run docs:check` 通过。同一对象已审两轮，这一轮没有推翻方向的发现，不开第三轮。

开发者 2026-11-10 在 t16 评审板第 10 版批准了第一批的 Spec（`b1-spec-approve`），并定面包屑第一批就做（`r6-breadcrumb`）。Spec 已提交为 planned，连同补上的面包屑：`workbench/editor.md` 输出 33 的 `breadcrumbs(arg)`、`canon/project.md` 输出 33 的上级链 `ancestors`、`canon/author-ui.md` 输出 6、20、21 的面包屑。计划相应改了“一、编辑器”与 K4、E 两片。

实施（2026-11-10 起，worktree `.worktree/w00039-novel-writing-plugins`，分支 `feat/w00039-t31-author-ui`）：

| 片 | 提交 | 内容与验证 |
|---|---|---|
| K-a | `04e440e89`、`cbd2c406c` | 读一次修订、章表（标题取自章节文件名）、登记的类型、`changes` 的 `before`、倒序与总数、事件 `inputChanged`。nb-canon `tests/author-reads.test.ts`；应用 `canon.test.ts` 经真实项目子进程与链路 |
| K-b | `462696afd`、`6be7f80fb` | 条目树带位置与墓碑规则、条目的上级链与本体、`changedAt`（两个引擎各一份 `lastTouched`，进差分测试）、分页的来历 |
| K-c | `ac10a99c5`、`6be7f80fb` | 就地改与记一笔的预览、语义档的记一笔、同一请求 id 重发返回第一次的结果（`edits.ts` 拆成“定方案”与“发布”两步） |
| E | `5f2552422` | 编辑器的带参数页面标签：声明的 `instances`、`restore`，页面地址 `page://<id>?<arg>`，每个标签的 context（状态容器随标签寿命）、记着的标题、存盘与恢复只看标签、页面的面包屑与“聚焦面包屑”。DOM 测试与 Lab 夹具；e2e 还没跑 |
| K 修正 | `165d9389b`、`d2e363083` | 内核补口实现审查的修正（见下） |
| S2（部分） | `fe0d990d7`、`4b13fa2f3` | 进程内的世界场地 `testing/node-world.ts`（Vitest 里可用，带断线、重连、项目结束），与项目子进程的场地共跑同一契约场景 `testing/venue-scenario.ts`，两边观察一致；读取层 `web/world.ts` 与 8 条用例（接真实服务），五处判据做过变异检查 |
| S3 | `2c0d61049` | 侧栏“设定”视图：`EntryTree`（分组、未出场与已删除、展开时才读、再显示、世界断开横幅）与视图宿主 `web/entries-view.ts`；命令 `nbook.canon.open-entry`（命令域加 `canon`）；入口改成启动时激活、读取层在视图第一次挂上时才建；界面文字目录 `locales/`；nb-ui `Tree` 加 `muted`、`suffix` 插槽与 `data-tree-id`。组件测试 7 条、宿主接真实世界 4 条、Lab 场景 6 个；`02cac1fd2` 外壳用例的排除名单加 canon 与剧情插件、`EntryTree` 包一层根元素 |

- 验证：nb-canon `bun test` 599 条全过、`bun run typecheck` 过；应用 `bun test src/plugins/canon src/plugins/plot` 全过、`bun run typecheck` 过。
- 规模（`bun scripts/scale.ts`，1000 章、520 条目、两万条变更，负载约 3.5）：随机读一个条目并取各字段最近一次改动，50 次中位 2.05 毫秒、最慢 15 毫秒（预算 20）；常出场条目的存款在最后一章末尾的来历 8001 步，算一次中位 20 毫秒、最慢 111 毫秒（界面每翻一页算一次）。
- 实现中改了 Spec 措辞的：`project.md` 输出 28、31、32、33、验收 10 与方法表的 `previewEdit`；`model.md` 输出 37（核对点的一步也带安放）。
- 顺带修了一个原有的竞态：世界正在打开时活页夹目录才出现，目录监视还没接上，章表会一直是空的；打开完成后补读一次清单。
- 内核补口的实现审查（Claude Opus，范围 `6973bbb28..6be7f80fb`）：11 条（重要 6、建议 5）都成立，都改了；第 3 条建议的“差分纳入列表字段”接受取舍（两个引擎共用 `fieldPath`，差分抓不到口径错，改由 `author-reads` 的用例守，变异检查确认）。[报告](evidences/impl-review-k-opus.txt)、[处理](evidences/impl-review-k-resolution.txt)。Spec 措辞随之对齐：`components.md` 输出 21，`project.md` 输出 9、28、33，`revisions.md` 输出 8、22、24，`model.md` 输出 37。
- 修正后的验证：nb-canon 606 条全过；应用 canon、plot 插件测试全过、typecheck 过。完整路径规模（[`evidences/scale-k-service.txt`](evidences/scale-k-service.txt)，1000 章、负载 1.3 到 2.0）：带 `changedAt` 的随机读中位 0.33 毫秒、最大 11；常出场条目的存款来历一页（8000 步）中位 33 毫秒、最大 139。“发布一次记账”中位 162 毫秒超预算，是 t34 C7 已记的（当时 155），不是本次回归。

- E 片的 e2e（2026-11-10，`editor-area`、`editor-types`、`workbench-shell`、`lab-scenes`、`welcome`、`bookshelf-stats`）：73 过、2 失败。`editor-area` 的“离开页面先请求确认”单独重跑通过（第一次负载约 3，偶发）；`lab-scenes` 只剩主题编辑器场景的素材 404（夹具用假哈希，w00041 引入，w00025 t05 与 w00026 t22 都在 master 上对照确认过），不是本分支引入。顺带补了页面面包屑组件文档的 `state:inject` 标签（治理检查）。
- 星瑕样本项目要用应用内置的类型，样本自己的四种类型（人物五个字段、面板、身份、剧情线）与内置的两种对不上，放到 t16 评审板第 13 版问开发者（`b1-sample-types`，推荐换成内置类型、内置人物补“身体”“现在的样子”“性格”三个文字字段）。定了以后再挪样本、写生成脚本。

- S3 的验证（2026-11-10）：Lab 截图（亮色，分组、未出场、已删除、再显示、断开横幅）看过。外壳 e2e 第一轮 120 过 10 败：活动栏多了“设定”，外壳用例本来就用 `NBOOK_EXCLUDE_PLUGINS` 排除带视图的内置插件，照做加上 canon 与依赖它的剧情插件；`EntryTree` 有两个根节点，Lab 报属性透传警告，包了一层根。重跑后 `workbench-views`、`workbench-dnd` 全过；`lab-scenes` 只剩主题编辑器的素材 404（master 原有）。`plugins.e2e` 在“其它”设置分区点不动而失败：在 S3 之前的提交 `4b13fa2f3` 上同样失败，不是 S3 引入的；是本分支早先的提交还是 master 原有，留到合入前对照。

- S4 条目页（2026-11-11，`5a9e05e59`；细计划见 `plan.md` 的“S4 的细计划”，主工作区 `032a573d2`）：页面 `nbook.canon.entry`（带参数、刷新后恢复，标签状态随标签，标题与面包屑读挂着的条目页报上来的页头）；骨架 `EntryPage`、文字 `EntryText`（自己画作者渲染的 mdast）、来历 `OriginList`、`FieldTable`、`PanelView`、`PlotList`，各配同名文档、组件测试与 Lab 场景；宿主 `EntryPageHost` 与两个数据分页界面（`FieldsDataView`、`PanelDataView`）标 `io:read`，只在真实界面验证；贡献点 `canon.component-views` 与注册表。只读，写入入口在 S5。
  - 验证：canon 前端测试 47 条（条目页接真实世界 9 条：页头与面包屑、缺省位置与换位置、点值才读来历、来历分页与初值一行、状态随标签、选过的章被删掉、情节与数据分页、别处发布原地更新不出加载占位、找不到/已删除/未出场、断开横幅、读取次数）、Lab 覆盖测试、`bun test src/plugins/canon`、`bun run typecheck`、`governance:check` 都过。
  - e2e（`lab-scenes`、`plugins`、`editor-area`）：52 过、3 失败。`lab-scenes` 只剩主题编辑器的素材 404（master 原有），新加的六个组件的场景都挂得上、没有警告；`plugins.e2e` 是 S3 时对照过的老失败；`editor-area` 的“离开页面先请求确认”单独重跑通过（第一次负载约 6，偶发，E 片时也见过）。
  - 实现中对 Spec 的改动：`author-ui.md` 输入一节的 `ComponentViewContext` 加 `state`、`blocked`、`place`（标签状态要随标签、写入入口要知道能不能写、界面要把安放写成“第 N 章”）；数据分页标题的约定键改成 `componentViews.<本地 id>.title`（同视图与页面）。
  - 修了 S3 的一个错：视图与命令标题的约定键是去掉插件前缀的本地 id（`views.entries.title`），目录里原来写成了完整 id，S3 的测试没测标题。
  - 测量（[`evidences/scale-s4-entry-page.txt`](evidences/scale-s4-entry-page.txt)）：一次别处发布引起的读取，每个在用的读取各一次；1000 章上打开热门条目页的一组读取合计中位 66 毫秒，其中 `entry` 12、`changes` 20、`origins` 35 毫秒超过单次预算的一半，都在内核，加了内核优化片 K-d（排在 S8 之前）。
  - 前端实现审查（Claude Sonnet，2026-11-11）：20 条（重要 8、建议 12），19 条改了（`96cd270b1`），1 条接受（变更详情的命令 S6 才登记）。要点是读取切换时旧句柄没释放、来历不随位置与模式重读、标签标题随所选位置变。补的测试做了两处变异检查都抓得到。[报告](evidences/impl-review-s4-sonnet.txt)、[处理](evidences/impl-review-s4-resolution.txt)。
  - 已知限制：条目树的选中项还是“最后点过的那个”，没有跟着活动的条目页（要订阅编辑器的活动标签，S8 前补）；“停了再激活换回专门界面”（验收 9 的后一半）运行时没有单独停一个插件的接口，组件测试只测了撤回与加载失败，留给 S8 的 e2e。

- S5 写入（2026-11-11，`96ffa2adb`、`f90fd9a91`；细计划见 `plan.md` 的“S5 的细计划”）：
  - 就地改：字段表与面板值卡上常显的“改”（数、文字、选项、是否；列表、图片、引用第一批不就地改），确认条 `ConfirmBar` 贴在分页顶上；填的值、意图、读到的值与请求 id 在标签状态里，切走再回来还在；停 300 毫秒预览写回哪里与带来的变化；确认条开着时别处改了这个值，写“这个值刚刚变了”并换上新值，再点保存就以新值为准；累出来的数锁保存并展开来历；保存或取消后焦点回到“改”。
  - 记一笔：面板流水上面的 `RecordForm`，精确档 `recordDelta`、语义档 `recordNote`；初值、按计划、写不了时不可用并写原因。
  - 写不了（`writable.ts`：只读、独占、断开）与失败的写法（`failures.ts`）各一处；独占结束后自动恢复。
  - 保存后的提示：窗口里一份，条目页顶上的 `NoticeBar`（标题、看回执、关闭）。“撤销”与工作台通知随 S6 的还原对话框一起做。
  - 新建条目：命令 `nbook.canon.new-entry`、视图标题栏、条目树右键（菜单键与 Shift+F10）；`NewEntryDialog`；成功后展开上级、选中并打开它的条目页。删除条目：页头“更多”里，确认后写墓碑，标签留着显示已删除。
  - 验证：canon 前端与 Lab 覆盖测试 76 条（条目页接真实世界的写入六条、新建一条）、`bun test src/plugins/canon`、`bun run typecheck`、`governance:check` 都过。
  - e2e `lab-scenes` 第一次 Lab 整个起不来：浏览器代码在运行时引了 nb-canon 主入口（`displayText`），主入口带着渲染链，Vite 开发模式下其中的 `debug` 包没有缺省导出；S5 让入口在启动时同步加载到它。S4 的条目页（`rows.ts`）有同样的问题，只是一直没被同步加载，组件测试在 Node 里测不出来。修正 `c45cf7ef8`：`displayText` 挪到 nb-canon 不依赖渲染链的 `core/display.ts`，经浏览器用的 `schema` 子路径导出；架构测试加一条“插件的 `web/`、`shared/` 在运行时不引 nb-canon 主入口与 `node` 子路径”。同一次 `test:affected` 还抓到 S4 起 canon 从工作台的 `shared/views` 引命令 id（跨插件只能引对方的合同文件），改成从工作台合同取。之后 `test:affected --typecheck` 全过，`lab-scenes` 只剩主题编辑器的素材 404（master 原有）。
  - 教训：每片的验证只跑了 canon 目录下的测试，包级的架构测试没跑到；之后每片收尾跑 `test:affected`，界面片另外打开一次真实浏览器（Lab 或开发服务）。
  - 发现：Spec 输出 19 的“不能删除时（`not-deletable`）对话框里写服务给的原因”碰不到：删除写墓碑，`not-deletable` 只在给条目 `after: null` 时出现（`revisions.md` 输出 20）；晋升 Spec 时删掉这半句。“看回执”与“改这一笔”的命令在 S6 登记。

- S2 剩下的样本（2026-11-11，`7269a49b3`）：开发者 2026-11-11 定 `b1-sample-types=map-builtin`（t16 评审板第 13 版）。nb-canon 加子路径 `./sample`（样本 JSON 与转换，从 `tests/sample/` 挪来，只给 Bun、Node 用，边界测试守住主入口走不到它；这是包导出的变化，记进 `docs/modules/monorepo-boundaries.md`）。`packages/neuro-book/scripts/canon-sample.ts <目录>` 经 canon 后端的世界宿主逐次发布，生成能直接打开的作品：人物用内置人物（补了“身体”“现在的样子”“性格”三个文字字段），面板的五个字段成为条目自己声明的字段，身份只把“外观”并进人物（文字里 `.identity.外观` 跟着改），剧情线不带，章 id 换成编号。21 个条目、版本 12。`scripts/canon-sample.test.ts` 重新打开生成的世界核对。原计划的“Lab 用读取录像回放”在 S4 已改成手写场景，不做。
  - 同时：边界表里 nb-canon 的“主入口前后端共用”改成“浏览器代码在运行时只引 `./schema`”（S5 时证实主入口在 Vite 开发模式下加载不了）。
  - 验证：`test:affected --typecheck`（nb-canon 全部、应用受影响的 bun 与组件测试）；一条合同测试与一条条目页测试按“内置人物现在 6 个字段”改了断言。

- 真实浏览器走查（2026-11-11，开发服务加脚本生成的星瑕样本，本机 Chrome，亮色 1440×900）：打开作品 → 设定视图 → 展开“人物” → 点星瑕 → 条目页（标签标题“星瑕”、面包屑“设定 › 人物 › 星瑕”、缺省位置第 3 章末尾、文字里的值与“第 N 章改过”）→ 点存款展开来历（估计的那笔警告色、核对点“对不上”）→ 面板分页（值卡、“改”、记一笔的输入、流水）都通，控制台没有错误。看到并改了两处（`f194331d4`）：面板流水较窄时来历的表头被挤成竖排；样本第 3 章没有标题却用了“第 3 章”当标题。

- S6 回执页、变更详情页与还原（2026-11-11，`a755a6b77`、`af39fbd58`、`b1f2cdb72`、`f9a9d1884`、`c27ac875d`；细计划见 `plan.md` 的“S6 的细计划”）：
  - 回执页 `nbook.canon.receipt`（带参数、刷新后恢复）：标题与“谁 · 什么时候 · 种类”；“改了什么”按新建、修改、删除、章序分节，修改列出字段的显示名与改前改后（显示名经条目的字段声明，`receipt.ts`）；带来的变化；它是一次还原时写还原的是哪几次并链接过去；页头“还原这次修订”（章序调整、写不了时不可用，有依赖时写一句）。面包屑“设定 › 改动记录 › 标题”，“改动记录”指向 S7 才登记的视图。
  - 还原：对话框挂在工作台的页面浮层里（`nbook.canon.revert`），窗口里一份，回执页、提示里的“撤销”（以后还有改动记录）都往同一个 `RevertRequests` 放。先预览：没有依赖写带来的变化；有依赖从新到旧列出依赖它的修订，只给“连同这些一起还原”；章序调整、要作者来源时只写原因。结果回来前不关、按钮不可用，失败写原因，结局不明给“再查一次”。
  - 保存后的提示：加“撤销”；有条目页、回执页、变更详情页挂着时在页面顶上，没有时改发工作台通知（只有“看回执”一个动作，记进待确认清单）。
  - 变更详情页 `nbook.canon.change`：文字、安放、已写还是计划、生效状态，待定时写原因与“改成生效”（先预览再发布）；原句与出处，章节正文的有“打开这一章”（经文件服务在活页夹目录里按编号找文件，再交编辑器打开；章节文件名的规则挪到 `shared/binder-files.ts`，项目实例读正文用同一份）；涉及的条目；每一处改动与依据，数的改动旁有“改”（同条目页的确认条，读出这条变更、换掉那一处的值，照普通写入预览与发布）。读出以后被别处改过写“这个对象刚被改过”，以重读到的为准重新预览、要作者再点一次。
  - 顺带补上：三种页面顶上的世界只读横幅（`WorldBanners`，输出 28 的前一半，S5 漏了）；`write-unknown` 不再把码写给作者；条目页的就地改预览与回执、还原共用一份“带来的变化”的写法（`impact.ts`），多写一句“N 条情节套不上了”。
  - 测试：回执页、还原、变更详情页各接真实世界（`receipt-page.dom.test.ts` 4 条、`change-page.dom.test.ts` 5 条，含验收 6 的有依赖还原、提示里的“撤销”、独占时不可用、读出后被别处改过、校验不过）；`RevertDialog`、`ReceiptPage`、`ChangePage`、`WorldBanners` 的组件测试与 Lab 场景；提示的去处（`notices.test.ts`）。三处变异检查（不带依赖地还原、回执页不看写不了、改过以后不换基准版本）都抓得到。
  - 验证：`test:affected --typecheck`（应用的类型检查、bun 2776 条、组件 591 条）全过。真实浏览器（开发服务加新生成的星瑕样本，本机 Chrome）：条目页点存款的来历 → “改这一笔”开出变更详情页 → 改那一笔、预览“会写回这条情节”与带来的变化 → 保存，页顶提示 → “看回执”开出回执页（修改与带来的变化）→ “还原这次修订”对话框写还原以后的值 → 还原，页顶提示 → “撤销”打开对话框 → 取消；“打开这一章”开出 `00002-用钱说话.md`；390 像素宽看回执页与变更详情页，没有横向滚动。控制台没有错误。看到并改了一处：回执页窄屏时“还原这次修订”悬在标题下一行的中间（`b1f2cdb72`）。
  - e2e `lab-scenes`：第一次在负载 17 时 Lab 15 秒内没起来（自己起开发服务看，7 秒就绪、控制台干净）；负载降下来重跑，所有场景都挂得上，只剩主题编辑器的素材 404（master 原有，S5 时同样）。这个 404 让用例停在控制台检查，后面的版面门禁一直没跑到，所以逐个场景量了 canon 的 36 个场景：世界横幅加了外边距，在手机画布上横向越出 12 像素（条目页从 S4 起就有，设定视图的断开横幅同样），改成贴边整宽（`f9a9d1884`），重量都干净。
  - 待确认清单加了四行（工作台通知只有“看回执”、“前台”按挂着判断、回执里写不出值的改动只写“改了”、校验原因是内核的英文说明）。
  - 前端实现审查（Claude Sonnet，2026-11-11）：14 条（重要 5、建议 9），13 条改了（`c27ac875d`），第 13 条是已记的取舍。要点：带来的变化把名字、简介、主文字块写成字段路径，未归纳的语义档写成原始 JSON；还原对话框打开后不随世界重取预览，有了依赖以后点“还原”只写“没有成功”；变更详情页的改动只认加减与设值。另改了点“撤销”时提示先留着（焦点有地方回），与 Spec 输出 18 有一点出入，记进待确认清单。补的真实世界用例做了三处变异检查都抓得到。修正后 `test:affected --typecheck` 全过（负载高时 SDK 打包与示例插件各超时一条，单独重跑都过）。[报告](evidences/impl-review-s6-sonnet.txt)、[处理](evidences/impl-review-s6-resolution.txt)。

- S7 的前三片（2026-11-13；细计划见 `plan.md` 的“S7 的细计划”，开发者定两个视图分开放、加 `show-revisions`，“可以 A”）：
  - S7a 合进 master（`ba29d6b35`）：解了 4 处冲突（架构测试、命令域加 `canon`、工作台合同、消息目录检查），`node-world.ts` 的控制台出口改从 `@notnotype/nb-host/web` 引。`test:affected --typecheck` 与 e2e `editor-area`、`welcome` 过（`editor-area:1265` 全量里失败一次，单独重跑过，t24、t25 起就时有时无）。
  - S7b 登记、状态栏与可见（`e5ca8e1da`）：两个视图 `revealRegion: false`、各是一个隐式容器；状态栏“待处理 N”（警告色，`when` 要 `nbook.canon/hasPending`，点了执行 `show-pending`）与公开状态 `hasPending`；`show-pending`、`show-revisions`。状态栏一开始就要条数，所以窗口绑定了项目时启动就建读取层（原来等第一次挂界面）。设定视图停放、收起时释放读取，回到前台先显示留着的再重读（输出 26），加了用例并做了变异检查。验证：`test:affected --typecheck` 全过；外壳 e2e（`workbench-views`、`workbench-shell`、`workbench-containers`、`background-tasks`、`plugins`）64 条过 63 条，失败的 `plugins:78` 在 master 上同样失败（设置窗口“其他”导航不可用）。
  - S7c 改动记录视图（`4d3790881`）：从新到旧，一行写标题、谁、什么时候与带来的变化的一句摘要；“看回执”“还原”（章序调整不可用并写原因，有依赖的写一句、照常能点）；按章、按写入者筛，筛选与当前行在窗口里一份；键盘在行之间移（`roving.ts`，只有当前行在 Tab 序列里）；视图窄于 480 像素时一行里上下排（容器查询）。停放时释放读取、行留在屏幕上。测试：接真实世界 4 条（含验收 12：没有页面挂着时还原后是工作台通知；世界日志的锁被占着时对话框不关、写出原因；按读出来的条数重读），骨架 5 条，纯函数 3 条；变异检查一处（停放时行不留着）抓得到。计划里写的“读了两页以后发布一次，仍是两页加新的那条”与 Spec 输出 24 的“已经读出来的条数原样重读”不符，按 Spec 测，`plan.md` 已改。
  - S7c 验证：`test:affected --typecheck` 全过（负载下 SDK 示例的一条与锁那条超时，前者单独重跑过，后者是测试把超时参数写错了形状，改了）。真实浏览器（开发服务加星瑕样本，本机 Chrome，亮色）：状态栏有“待处理 1”；命令面板“显示改动记录”打开底部面板，12 次修订，键盘上下移、焦点线在；点“还原”对话框写带来的变化；390 宽没有横向滚动；控制台没有错误。看到并改了一处：两个筛选各占一整行（`Select` 的宽度要用原子类覆盖）。

  - S7d 内核补口 K-e 与待处理视图（`c1440446b`、`75b465e17`、`8d2582682`）：K-e 让 `pending` 的一页带这一页提到的插件诊断的显示名 `labels`（nb-canon 加两条测试，全量 608 条过）。待处理视图：三组（“只是提示”“已处理”默认收起，组名后写条数，条数取自状态栏那一个读取）；每条一句是什么与位置（`pending.ts`，二十来种各一句，插件的发现写显示名，没有时“插件的一项检查”）；详情按种类（核对点不符写原句与“打开这一章”、两个数、嫌疑的每一笔，估计的标出来、初值点开条目；待定写原因；套不上写根因与原因，原因经 `changes` 取根因的结局；已处理写作者的决定）；第一次打开与 `show-pending` 之后选中“待处理”的第一条，选中的那条消失后选它原来位置上的那一条；上下键跨组移、选中跟着焦点走；宽 640 像素以上左右排；不完整时列表顶上写哪些检查没算出来；有人独占时写是谁并可“强行解除”（二次确认，失败时对话框不关）。停放时行留在屏幕上（`useKeptRead`，改动记录同用）。测试：纯函数 5 条，骨架与对话框 6 条，接真实世界 5 条（含验收 5 的界面部分：改对以后这一条消失、条数与状态栏一起变；强行解除与失败）；变异检查一处（消失后不选下一条）抓得到。
  - S7d 验证：`test:affected --typecheck` 全过（bun 2945 条、组件 728 条）。真实浏览器（开发服务加星瑕样本，本机 Chrome，亮色）：状态栏“待处理 1” → 底部面板的待处理视图选中“星瑕的存款对不上：正文写 19,800，算出来是 21,500” → 详情有原句与“打开这一章”、两个数、估计的那笔在前 → “改这一笔”开出那条变更的详情页；底部面板约 640 像素宽时左右排，390 宽上下排、没有横向滚动；控制台没有错误。
  - 待确认清单加了四行（K-e 是第九项内核补口、`show-pending` 每次选回第一条、超出 50 个对象的行只写种类、详情里世界线与时间几种写得简略）。

  - S7 实现审查（2026-11-13）：前端派 Claude Sonnet（11 条：重要 4、建议 7），K-e 派 Claude Opus（6 条：重要 3、建议 3）。到齐后一起归类，修正 `56cecd84a`。要点：读取层的结果带 `stale`，待处理视图只在现在的结果上选第一条（停放回来后 `show-pending` 按旧结果选是第 1 条，已复现）；两个视图“停放时不读”与两个 show 命令补了测试；详情里长链接截断；选中的位置跟着变；强行解除确认时核对持有者。补测试时另发现两个真问题一并改了：内核的 `cannot-apply.root` 是弄坏它的那次修订，不是情节（实现、S7 计划与 Spec 输出 23 都当成了情节，Spec 已改）；行的 `data-row` 用 NUL 分隔，按选择器找行在浏览器里对不上。内核第 6 条（诊断登记变了不发事件，启动时会一直显示“没算出”）是既有问题，并入 K-d。修正后 `test:affected --typecheck` 全过（nb-canon 610 条、bun 2947 条、组件 733 条），真实浏览器重走待处理的路径无误。[前端报告](evidences/impl-review-s7-sonnet.txt)、[内核报告](evidences/impl-review-s7-opus.txt)、[处理](evidences/impl-review-s7-resolution.txt)。

- K-d（2026-11-18 开工）：开发者定用自主推进做完 K-d 与 S8。开工前在 1000 章规模样本上逐段计时，`entry` 的 `changedAt` 慢在引擎倒扫整条时间线，`origins` 慢在每页重放全部步并整份冻结，`changes` 慢在每次对两万条排序；细计划见 `plan.md` 的“K-d 的细计划”，交 omp 做设计审查。
- S8a 合进 master（2026-11-18，`2b5aba138`）：分支落后 911 个提交；两处冲突（边界表 nb-story 一行取 master 的、nb-canon 一行取分支的；Lab 夹具的导入两边都留），master 加了 `nb-flock` 包，合并后 `bun install`。`test:affected --typecheck --since 56cecd84a`：类型检查与组件测试全过，bun 3428 过、17 败。负载降下来后单独重跑，超时的都过了；剩下 9 条是 master 自己带来的断言失败，分支没改它们涉及的文件：`server.test.ts` 6 条与 `builtin-names.test.ts` 1 条是新内置插件 `nbook.stickers` 没写进期望，`sdk.test.ts` 2 条是 nb-ui 新加的 `DateInput`、`SortableList`、`TagInput` 没列进 SDK。
- K-d 设计审查（2026-11-18，omp 默认模型；90 分钟被截停，续跑补齐报告）：6 条（重要 3、建议 3），5 条成立、都改进了计划，第 2 条（合同版本）不成立：`inputChanged` 是本分支才加的，master 上没有。要点：诊断登记的代次进 `pending` 的分组缓存与游标；`lastTouched` 改成按事件缓存，因为时间线每次发布都会换新对象，按时间线建索引在“发布后重读”时省不下来；来历的一页隔得远时跳到快照；变更列表只为按条目筛的查询建索引，窄查询照旧先筛后排；测量补上早章、中间页、稀疏地址与窄查询。[报告](evidences/design-review-kd-omp.txt)、[处理](evidences/design-review-kd-resolution.txt)。
- S8b 条目树跟着条目页（`8a43f89e2`，与 K-d 的审查并行做的）：条目页挂上时把设定视图的选中设成它的条目；组件测试接真实世界与产品的浏览器入口，变异检查抓得到。编辑区拆成两组时在组之间换焦点树不跟着变，记进待确认清单。`test:affected --typecheck` 剩下的失败只有 S8a 认出的 master 带来的 9 条。
- K-d 实施（2026-11-18）：
  - K-d1（`83ba1ead4`，Spec `23b029115`）：`inputChanged` 加 `diagnostics`、`marks`；服务里加诊断登记的代次，进 `pending` 的分组缓存与游标。nb-canon 两条用例，剧情插件的链路用例补“浏览器收到 diagnostics”；三处变异检查都抓得到。
  - K-d2（`a4c3f9aae`）：`lastTouched` 按事件缓存它碰到的字段。
  - K-d3（`2d96babbd`）：来历按页算，引擎只数步、只为这一页取值，隔得远时跳到快照；差分测试加 `originsPage` 的几种窗口与三百个事件的长时间线；两处变异检查。
  - K-d4（`b4e49867e`）：按条目筛的 `changes` 走按条目的索引；两处变异检查。
  - K-d5（`21ed0568b`）：规模脚本加发布后第一次读与重读、来历第三页、稀疏地址、只筛一章的 `changes`；60 章试跑过。1000 章的正式测量等负载降下来再跑（别的会话的评测与类型检查让负载在 15 到 36 之间）。
  - 临时探针（1000 章、负载 5 到 10，直接调服务）：`entry` 带 `changedAt` 中位 15 → 0.72 毫秒；`origins` 存款 81 → 6.9；按条目的 `changes` 20 → 3.5。
  - 验证：nb-canon 614 条全过、typecheck 过；`test:affected --typecheck` 剩下的失败只有 S8a 认出的 master 带来的 9 条，另有三条负载下的超时单独重跑都过。
- S8c e2e（`6c79ad14c`）：`e2e/canon-author.e2e.ts` 生成星瑕样本作品后起生产服务，五个场景（验收 1、2、3、5 与在改动记录里还原）都过，每个用例结束时控制台没有错误。写的过程中改了三处用例写法：设定视图已开着时再点活动栏会把侧栏收起来；没有带值写法的条目页不能用值来判断读到了；状态栏另有一份量宽度用的副本。
- 截图（2026-11-18）：开发服务加新生成的星瑕样本，亮色，1440 与 390 宽，八张，控制台没有错误、390 宽没有横向滚动，发成 `report` 产物 `s8-screens`（`cc193967b`）。看到 master 合进来的底部面板入口条（待处理、后台任务、改动记录、通知）已经接上本 Task 的两个视图。
- 收口审查（2026-11-18）：
  - S8 前端（Claude Sonnet，S8b、S8c、合并带进来的部分，并逐条核对 `author-ui.md` 能不能晋升）：18 条（审查发现 7 条都是建议；Spec 核对重要 1、建议 9、已记 1），都成立。修正 `00deaa8fa`：待处理视图交 `badge`；两个底部面板视图 `order` 改成 5、6（产品取舍，记进待确认清单）；组件测试补世界只读（验收 8 的前一半）、一次调用装不下、取消与 Escape 后的焦点、章序调整的回执；e2e 补验收 11（只用键盘）、验收 14（390 宽）、底部面板默认没显示、树跟着标签选中、入口条打开改动记录、否定断言的对照。Spec 措辞的出入在晋升时按实现改。[报告](evidences/impl-review-s8-sonnet.txt)、[处理](evidences/impl-review-s8-resolution.txt)。
  - K-d（omp 默认模型，`8a43f89e2..21ed0568b`；90 分钟被截停，续跑补齐）：10 条（重要 3、建议 7），都成立，第 10 条部分接受。修正 `58669b17c`：`pending` 游标另带服务实例的标识（进程重启以后旧游标作废）；同一批登记表先换代次再发事件；按条目的变更索引不为不存在的 id 留键；项目门面与宿主替换诊断登记时不先注销（新加 `backend/world-host.test.ts`）；差分的长时间线加改值的稀疏地址；规模脚本的发布后第一次读轮着来、新项在旧指标取完以后重新打开量。变异检查四处。[报告](evidences/impl-review-kd-omp.txt)、[处理](evidences/impl-review-kd-resolution.txt)。
  - 修正后的验证（负载 25 到 40）：nb-canon 616 条里只有差分测试的种子在负载 25 以上贴着每条 30 秒超时（种子 1 不带新比较也要 24.5 秒），canon 与剧情的 bun 测试 364 条、canon 组件测试 124 条、应用类型检查都过；`canon-author.e2e.ts` 七个场景都过。
- 合并 master 后的 e2e 清单（2026-11-18，8 个文件 157 条：`canon-author`、`editor-area`、`lab-scenes`、`plugins`、`welcome`、`workbench-containers`、`workbench-shell`、`workbench-views`；负载 25 到 40）：第一轮 14 条失败，`--last-failed` 剩 7 条。分支带来的只有 `workbench-containers:1413`：它的服务没排除 canon 与剧情插件，底部面板多了两个视图（`b197353be` 排除，整个文件 35 条过）。其余在当时 master（`84994e1d6`）的对照 worktree 上同样失败，或单独重跑能过：`editor-area` 2171、2207、2301（负载下的实时拆组，已知偶发）、`workbench-shell:792`、`lab-scenes`（Lab 没起来）、`plugins:83`（单独跑、放宽超时后 39 秒过）。
- Spec 晋升核对（omp 默认模型，固定在 `58669b17c`；90 分钟被截停，续跑补齐）：内核四份与编辑器 Spec 里本 Task 加的“（planned）”逐句核断言，132 行（去掉 50、留 58、没做 13、改写 11）。编辑器有两句是本 Task 漏做的：恢复出来的页面在贡献方还没交付时显示成“已经不在了”、`focus-breadcrumbs` 对页面标签一直不可用；补在 `91defc75b`（页面注册表加 `pending`、公开状态 `nbook.editor/breadcrumbs`），两处变异检查都抓得到。其余“没做”的八句在内核里本来就排在后面，标记留着。[报告](evidences/spec-promotion-omp.txt)、[处理](evidences/spec-promotion-resolution.txt)。
- 合入 master（2026-11-18，`4c242d226`；合入前的 master 是 `8eb0e10a1`）。Spec 晋升随后提交（`d1f5780b3`）：`author-ui.md` 晋升 `implemented`，补实现合同与证据，注册表那一行挪到“已实现”；内核四份与 `workbench/editor.md` 去掉 41 处标记、按实现改措辞 8 处，没有能区分的断言的句子单独标 planned（编辑器验收 44 整条留着）。
- 合入后的验证（master，负载 12 到 40）：
  - `test:affected --typecheck --since 8eb0e10a1`：类型检查全过；bun 测试第一轮失败 77 条，大多是 5 秒超时。单独重跑后剩下的都在合入前的 master 上同样失败（在 `8eb0e10a1` 的对照 worktree 上跑过）：`server.test.ts` 6 条与 `builtin-names.test.ts` 1 条（`nbook.stickers` 没写进期望）、`architecture.test.ts` 1 条（stickers 的跨插件导入）、`server-projects.test.ts` 场景 14、15 三条、`workspace-files.test.ts` 的分组一条、dev-panel `leases-cli.test.ts` 的 herdr 一条。nb-story 的超时单独跑全过。
  - 编辑器的修正晚于上面那轮 e2e，覆盖它的 `welcome`、`canon-author` 与 `editor-area:1284`（面包屑）合入后在 master 上重跑，12 条都过（负载 19）。
  - 1000 章规模（K-d5）：负载 12 到 22，整体比负载 1.3 时慢约 3 倍。条目页那一组里 `entry` 带 `changedAt` 中位 5.26 毫秒、来历 16、按条目的 `changes` 14（K-d 之前负载 13 下是 15、81、20）；来历的第三页与稀疏地址不比第一页慢。“中位 10 毫秒以内”与“打开到可以读”（这次 5746 毫秒，负载 1.3 时 1728）要在低负载下整程重跑才算有证据。[测量](evidences/scale-kd.txt)。
  - 低负载重跑（2026-11-19，负载 1.4 到 3.6）：两项预算都达到。条目页那一组 `entry` 带 `changedAt` 中位 1.92 毫秒、按条目的 `changes` 8.11、来历 7.26；打开到可以读 1832 毫秒（预算 2000）。上次来历发布后重读的 80 毫秒这次是 7.77，按负载解释成立。“发布一次记账”中位 181 毫秒仍超预算 100，是 t34 C7 已记的，K-d 没碰发布路径。K-d 收口。同一份[测量](evidences/scale-kd.txt)的第二节。
- 清理：Spec 核对的审查 worktree、两个 master 对照 worktree 与 K-d 的临时探针都已删除；实现 worktree 与分支留着给第二批。

第二批 B2-1 的进展（实现 worktree，分支 `feat/w00039-t31-author-ui` 先快进到 master）：

- F（`9508eb570`）：组件测试的场地装得上剧情插件：Vitest 里把 `bun:sqlite` 换成 Node 26 自带的 `node:sqlite` 上的同一组调用（`@notnotype/neuro-book-test-support/bun-sqlite`），进程内的世界场地可加项目插件；冒烟用例经远程读剧情、把写作指示写进存储。变异检查：去掉别名就加载不了。
- M 第一轮（`88befa1ff` 加作者读取的基线，[证据](evidences/b2-plot-scale-m1.txt)）：进程内五个现有读取输入一变后第一次 23 到 178 毫秒；omp 经远程量的 33 到 76 秒在进程内复现不出来。omp 的远程探针在负载 8 到 18 下连造样本都超时（跑完留下一个孤儿项目进程，已结束）；推断慢在每次发布后重算全部剧情诊断，待低负载时按高密度形状量。
- C1（`3ccb2e31e`）：读取服务 `canonReadsKey`：外部读取与外部列表同一代失效、同一轮换上，取数抛错只让它自己失败（`external-failed`），结果版本落后时这一代补读一次；外部列表重读时按真实页长翻回已读的条数。读取层一轮的收尾不再可能卡住。四条新用例，三处变异检查都抓到。
- C2（`0d50f6e02`）：窗口在看的线：公开状态 `nbook.canon/line`（字符串）与 `lineReady`、状态栏“在看：……”、`nbook.canon.pick-line` 走快速选择、条目页读取带上窗口的线（标签标题不带），分叉撤销后回到跟着章。三处变异检查都抓到。
- C3（`7f515f357`）：页头的线选择（跟着章时写“此刻：线名”，只有主线时不画）；读取服务交出页头组件 `PageHead` 与 `usePosition`。
- C4（`68b95e0e8`）：附加分页 `canon.entry-tabs`；`ComponentViewContext.FieldTable`（专门界面嵌一节通用字段，W3 用剧情的界面测）。变异检查抓到 `requires` 的过滤。
- canon 组件测试 132 条全过、类型检查与 `architecture.test.ts` 过。
- A1（`19935cd9e`）：`nbook.plot/author` 的 `person`、`point`：人群（人物与组织、已出场、未删除，马甲归本体）、程度（含忘了、显式不知道、没有行）、来处（初值、事件带章与段、目标出场、从别的线带过来带原证据）、读者按读取位置的程度与整书第一次（带那一段的开头）、和它有关的（直接挂与只经读者守卫的决策分开，只取待定与已定，重新打开的不写旧结论）。知情索引加 `winner()`。项目入口几个合同共用的结果写法挪到 `backend/results.ts`。
- A2（`311fa0486`）：`secrets`：行按主体在条目树里的顺序与名字、点名的人各自的程度、别的人（至多 12）、生效的揭示计划与挂着的决策、全表的分段条数、候选与主要角色。
- A3（`51510c4ee`）：`goals`、`ledger`、`experience`，`person` 加目标与态度；目标动过与停滞共用 `goalQuiet`（只算改到 `goal` 命名空间、套上的变更），久没提与没打算怎么收由诊断与账本共用。
- A 片的包测试 16 条（真实 `World`），每片做了四处变异检查都抓到；剧情插件 341 条全过；远程用例经进程内场地调了六个方法。
- M 第二轮（`050eb5c45`，规模脚本加六个作者读取）：30 章、负载 16 到 24 的冒烟里，`secrets` 同一份输入再读 156 毫秒、`goals` 80 毫秒，作者读取没有缓存、每次整张重算；1000 章的数等低负载时量，细设计按“同一份视图与位置缓存整张表，请求只做投影”写，再派 omp 审。
- W1（`bbb66bb8a`）：剧情的浏览器入口、侧栏“剧情”（三张表与剧情线）、“谁知道什么”一页；组件测试接场地上的真实世界服务与剧情项目入口，变异检查抓到缺省点名。U 并进 W（三样组件写在剧情插件里，见计划的技术选型）。
- W2（`ecd596299`）：伏笔账本与目标表两页。
- W3（`05c82ae39`）：条目页的“知道什么”“目标与态度”“谁知道”三个专门界面（各带一节这一页的通用字段）与人物的附加分页“经历”。“目标与态度”的态度另成一张表（对象、态度、起因、称呼）：目标表那一组的“对某某：态度”一行写不下 Spec 输出 17 要的起因与称呼。组件测试 3 条接 canon 的真实条目页。

## 下一步

1. 第二批 B2-1（[`plan-b2.md`](plan-b2.md) 第二版）：S0、F、C、A、W1 到 W3 已做；下一步 M（负载低于 3 时在 1000 章上量六个作者读取与高密度的读待处理，写缓存与索引的细设计并派 omp 审），再 D（样本、e2e、截图）与收口。B2-1 的 Spec 草稿：新写 `docs/specs/plot/author-ui.md`，`canon/author-ui.md` 输出 34 到 36，`plot/checks.md` 输出 9、`knowledge.md` 输出 3 与 11、`goals.md` 输出 5 的 planned 句。剧情读取的实际形状整理在 [`evidences/b2-plot-read-shapes.txt`](evidences/b2-plot-read-shapes.txt)。
2. Spec 里留着的句子级 planned：[`spec-promotion-omp.txt`](evidences/spec-promotion-omp.txt) 每行写了缺什么断言，后续碰到相关代码时照着补测试再去掉标记。
