---
schema: nbook.task/v2
taskId: t37-write-foundation
status: active
updated: 2026-11-19
---

# 写入底座：作者与 Agent 都能改设定

## 目标与范围

作者在界面里、Agent 用工具都能读写设定的全部数据：各种字段、列表与元素、引用、图片、语义档、主文字的块、Component 的加与去、条目的名字与位置。都走同一条发布通道、留改动记录、可还原。设定视图空着时有明显的新建入口。

来由：开发者 2026-11-19 看过 t31 第二批第一期后定的方向（[Work README](../../README.md) 决定表同日）：作者与 Agent 都能改数据最重要；先把底座做好，再做通一个闭环（候选是人物 Component 的设定）；UI 打磨排到最后。人物的闭环不在本 Task，底座做完再定。

合同：

- 改 [`canon/revisions.md`](../../../../../docs/specs/canon/revisions.md)（一次改几处）、[`canon/project.md`](../../../../../docs/specs/canon/project.md)（远程方法）、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)（各种字段的改法、空状态）；
- 新建 `canon/agent-tools.md`。

计划：[`plan.md`](plan.md)。

## 当前状态

- 2026-11-19 新建。主会话核实现状：Agent 一侧什么都没有；作者只能就地改四种标量字段。
- 计划第 1 稿与独立设计（Sonnet，[`evidences/independent-design.txt`](evidences/independent-design.txt)）对照后定稿，交设计审查：后端 omp 11 条（阻断 5），前端 Sonnet 15 条（重要 11），全部成立，[处理](evidences/design-review-resolution.txt)后改成第 2 稿。后端的五条阻断改动了内核的核心规则，第 2 稿的后端部分再交 omp 审一轮；前端的处理照审查建议落地，不再开设计审查。

- F4（分支 `feat/w00039-t37-write-foundation`）：nb-ui `SearchSelect` 加远程模式（`search` 事件、不在本地筛、`selectedLabel`）与清空按钮（`b12b9cad8`）；canon 的条目选择器 `EntryPicker` 与图片输入 `ImageInput`（`86d6a91c3`）。`EntryPicker` 原先自己发查找、标 `io:read`，Lab 挂不了（带 `io:` 的组件只能在真实界面验证），改成受控零件，去抖与晚到结果作废挪进组合式函数 `useEntryFind`，各宿主共用。dom 测试与变异检查都过，网页与浏览器测试的类型检查通过。

- 后端第二轮设计审查（omp，[`evidences/design-review-backend-omp-r2.txt`](evidences/design-review-backend-omp-r2.txt)）：2 条重要，第一轮的处理逐条认可。照建议改出第 3 稿：Agent 的读前提从“世界版本没变”改为读取戳（版本加读取输入摘要）；远程合同不升版本、只加方法（升了老页签没有刷新的出路）。不再开第三轮。

- F1（`9f6d68917`）：nb-canon 的 `editEntries`、`previewEntries`（`src/world/entry-edits.ts`）与世界服务的 `findEntries`；就地改、记一笔、语义档的记一笔改成一项操作的批（请求摘要、缺省标题、失败码照旧），顺带修了章首剧情变化读回必然失败与显式主线被改成按章选线；条目读取加 `removedComponents`。测试：`entry-edits.test.ts` 12 条、`entry-edits-service.test.ts` 3 条（真实服务与日志：读取戳两种过期、findEntries）、`edits-differential.test.ts` 23 条（单项入口与 t37 之前逐字相同，有意不同的三处另写断言）、`worldlines.test.ts` 加显式主线一条；关键的五处做了变异检查。nb-canon 全量 652 条、应用 canon 插件 bun 17 条与 vitest 139 条都过，两边类型检查通过。`findEntries` 在 520 条目、1000 章上中位数 6.06 毫秒（[证据](evidences/f1-find-entries-perf.txt)）。
- Spec 改动（`canon/revisions.md` 输出 25 与输出 8、10、22 的补充、失败码；`canon/components.md` 输出 3、7）已写在主工作区，链接指向分支上的新文件，合入时与代码一起提交。

- F2（`e95c7a346`）：远程合同只加方法（`editEntries`、`previewEntries`、`findEntries`，版本不升）；批量编辑的输入只留一份 TypeBox 结构（`nb-canon` 的 `core/schema.ts`），内核与合同共用；浏览器的新建与删除改走 `editEntries`（去掉 `lastOrder` 与拼整份条目）；读取层加 `onRevision`，在“版本不新就不重读”之前按修订 id 去重交出每次发布。测试：`canon.test.ts` 经链路一条（预览与写入相同、读取戳过期、findEntries、视图令牌拒、老方法照常），`world.dom.test.ts` 一条（事件晚于本窗口写入的结果也交出，做了变异检查）；canon 插件 bun 40 条、vitest 141 条都过。Spec `canon/project.md` 的方法表与“只加方法不升版本”写在主工作区，合入时提交。

- F1 补（`edf0a5983`）：新加的元素与块按 `i`、`b` 加序号生成 id（内核的 `LOCAL_ID_PREFIX`），避开同一批里刚分配的。
- F3（`51e48bd71`）：canon 的服务端入口（`backend/agent-tools.ts`、文字在 `agent-text.ts`）贡献 `canon_lookup`、`canon_tree`、`canon_read`、`canon_write`，都给所有会话；每次调用按会话的作品取项目租约、经 `{project}` 目标调世界；名字、`$代号`、“设定组.字段[元素].子字段”在工具层解析成 id；读取结果第一行的“版本 12·摘要前 12 位”带回写入当读取戳；写入者 `{agent, session}`、请求 id 用 `invocation`。测试 `canon/agent-tools.test.ts` 6 条（真实服务端与项目子进程：建查读改、作者中间改了被拒、写错参数的回话、两条回复同一个 callId、看树与还原、会话不属于作品），请求 id 与读取戳两处做了变异检查；插件表、贡献前缀、Agent 的工具表与 Profile 测试都过。Spec `canon/agent-tools.md`（planned）与注册表写在主工作区，合入时提交。
- 计划里 F3 的那条真实模型测试没做：现有的真实模型场地 `agentWorld` 只有服务端、没有项目子进程，canon 的工具要调项目里的世界，得先把两套场地拼起来；挪到人物闭环，那时的验收本来就要跑真实对话。

- F5 进行中：空状态（`4b9e21203`：条目树空着、可以新建时是 `EmptyState`，“新建人物”预填人物与人物设定组，“新建条目”打开对话框，不能写时禁用并写原因）；Agent 提示（`3685fb256`：提示服务另开 `agent` 一格，窗口在 `onRevision` 里收写入者是 Agent 的修订，三种页面顶上另画 `AgentNotice`，“看改动记录”经提示服务的路由打开改动记录视图）。

- F5 页头（`7414c0572`）：确认条移到 `EntryPage` 的 `bar` 插槽（页头之下、各分页共用）；宿主的 `field()` 把 `entry.name`、`entry.summary` 当文字字段，确认条照字段的写法改它们；别名一行（`aliases`）；“更多”里“添加一组设定……”（对话框列出没有的类型，去掉过的标“恢复”）与“去掉这组设定”（当前是数据分页时）；已删除页有“恢复”；页头写入失败的原因写在页头下面。`entry-page.dom.test.ts` 加两条（真实世界）。

- F5 移动（`2d39ccd7b`）：`MoveDialog`（上级与另一个身份用 `EntryPicker`，分组、种类、放在最前、出场），只带改了的几项发 `place`。顺序只有“保持原位”“放在这一层最前”（“放在某项之后”要先读新的一层，没做）；树的右键菜单没加“移动到……”。
- F6 引用与图片（`71051290c`）：确认条的输入按种类分，引用用 `EntryPicker`（按声明的 `targets` 筛，当前值的名字按 id 读一次条目），图片用 `ImageInput`；字段表这两种也有“改”；语义档改起点时用起点（`unreduced.anchor`）预填，不用归纳文字。宿主测试用一个内联插件登记带引用与图片字段的类型。
- 没做（F5）：新建对话框的种类快捷按钮与 `EntryPicker` 候选（现在的下拉能用，只列树里读到的条目）。

- F6 共用输入（`25cd1e1a9`）：确认条按种类画输入的那段抽成 `FieldInput`，确认条与元素对话框共用。元素对话框因此不用计划里的 nb-form（理由写在计划的技术选型）。
- F6 列表（`131e672d2`）：字段表的列表每个元素一行带“改”“去掉”，末尾“＋ 添加一项”；`ComponentViewContext` 加可选的 `listAdd`、`listEdit`、`listRemove`。元素对话框 `ElementDialog`：以条目为键的先用 `EntryPicker` 选条目（改一项时不能换），别的填名字；子字段用 `FieldInput`，语义档在改一项时只读；有两个意图时可选。加一项发 `listAdd`，改一项只发改过的子字段（`set` 到 `列表[元素].子字段`），去掉先确认、可选意图再发 `listRemove`。宿主测试一条（内联插件的普通列表与以条目为键的列表：加、改、去、选条目），组件测试两条，Lab 加 `FieldInput`、`ElementDialog` 的场景；改一项的地址做了变异检查。
- F6 主文字与记一句（`f69a4c783`）：没删除的条目总有“文字”分页，没有主文字时写“还没有主文字”，缺省仍先看第一组设定；每一块旁边“改这一段”（源文字取条目读取里所选位置上的那一块）、“删掉这一段”，文末“＋ 加一段”，都可选意图。通用字段表展开着的数或语义档字段，来历下面一行“记一笔”（语义档只填一句），所以每个数据分页都能记。宿主测试两条，改一段的地址做了变异检查。
- F6 比计划简化的（功能都在，交互从简，按开发者“先功能和基本 UX”）：去掉一项不先预览、不写“第几章加的”，来自剧情变更的一项按“改设定”去掉时内核拒收（`element-from-change`），原因写在对话框里，改选“剧情里变了”再去；字段表没标出来自变更的元素；以条目为键的选择器没把已在列表里的灰掉（重复时内核拒收）；对话框里的语义档子字段没有“改起点”“记一句”（展开那个列表字段的来历也记不了，记一句只对整字段）；`EntryPicker` 选不到时没有“新建‘词’”；块的“删掉这一段”是按钮，不是菜单。

- F7（`b6822955c`、`30ff7d03d`）：新 e2e `canon-write.e2e.ts`（空作品、脚本化的本机模型端点）两条：作者从空状态新建人物、改外观、加一段主文字、加别名；Agent 经 `canon_write` 建组织与挂在下面的人物（`$代号`、外观初值、主文字），批准后树里有、条目页读得到，条目页开着时 Agent 再写一次出 Agent 提示，从提示撤销后那个条目消失。计划里写的是在 `canon-author.e2e.ts` 补作者的用例、另起 `canon-agent-write.e2e.ts`；星瑕样本作品不是空的，空状态与 Agent 都要空作品，所以合成一个新文件。跑 e2e 时发现并修了两处：`ImageInput` 从 nb-canon 根入口取路径规则，Lab 的开发服务里把 CommonJS 的 `debug` 原样交给浏览器，ChangePage、ConfirmBar、ElementDialog、FieldInput、ImageInput 的场景加载失败（改从 `./schema` 子路径取，Spec 的实现合同本来就这样要求）；列表元素的 8rem 缩进按视口判断，嵌在剧情专门分页的窄格子里时“添加一项”溢出（`plot-author` 验收 6 在 600 宽失败），改成小缩进。
- F7 验证：`canon-write` 2 条、`canon-author` 与 `plot-author` 全部通过；`lab-scenes` 只剩分支起点上就有的 ThemeEditor 四条 404，挡在版面检查之前，所以新增与改过场景的 11 个组件用 `nbdev shot` 量（亮色，手机与自由画布），没有越界、裁切与页面错误；nb-ui `SearchSelect` 量了 nbook、macos 两个主题乘亮暗两种配色、手机与自由画布，都干净。
- Spec `canon/author-ui.md`：新行为按条目标 planned（输出 9、10、12、16、17、8 的改动，新增输出 37 到 42，验收 15，`ComponentViewContext` 的列表方法），写在主工作区，合入时提交。

- 收口（2026-11-19）：master 无冲突并入（`d7649c4ea`）。nb-ui、nb-canon、nb-form、neuro-book 的快速测试与类型检查：vitest 与类型检查全过，`bun test` 11 条失败。其中 6 条是本 Task 的：F3 加了 `nbook.canon` 服务端插件，宿主测试 `server.test.ts` 的插件表没跟着改；它只依赖宿主能力（项目登记），会比诊断先发布，“诊断最先发布”的断言改成不算它。另有 1 条是 t31 留下的：剧情的线标签从 canon 的 `shared/reads` 运行时导入 `MAIN_LINE`，跨插件只能经 `shared/contracts.ts`，改经 contracts 转出（都在 `9b88b4232`，两份测试重跑通过、类型检查通过）。其余 4 条在 master 上同样失败、与 w00039 无关：SDK 组件清单少列 nb-ui 新的 `ImagePreviewDialog`（w00050）；活动栏、页面浮层、条目注册表三条“同 id 的两条一起被拒”。
- 顺带改正：服务端把内置插件都列为必需（`server/start.ts`），canon 的工具入口随启动激活，`agent-tools.md` 原写的“第一次调用才激活”只对不必需它的场地成立，Spec 与代码注释已改。
- 实现审查（审在 `9b88b4232`，[处理](evidences/impl-review-resolution.txt)）：后端 omp 6 条（[报告](evidences/impl-review-backend-omp.txt)），全部成立、都改；前端 Sonnet 12 条（[报告](evidences/impl-review-frontend-sonnet.txt)），9 条改，第 5 条（几个引用子字段共用一份查找结果）记为已知限制，第 6 条的拆分推后，第 10 条（Agent 提示没有时间界限地累计）进待确认清单。修正在 `ee9fc3f5e`（内核：同一批重复的临时 id 与设定组拒收，`findEntries` 按树序）、`c1bcc09dd`（Agent 工具：重发先按请求 id 查结局，重复的代号与设定组拒收，名字重名时列候选，解析挪进 `agent-names.ts`）、`33cb3e2e8`（界面：对话框带打开时的版本、错误跟着对话框走，条目选择器记住选中的名字，撤销 Agent 那次后写“已撤销”，等等）；每条改动都补了用例，关键的做了变异检查。修正后 `canon-write`、`canon-author`、`plot-author` 15 条 e2e 都过。Spec 随之补了 `revisions.md` 输出 25、`project.md` 的 `findEntries`、`agent-tools.md` 输出 7 与 10、`author-ui.md` 输出 40、41、42 与新的输出 43。
- 推后到人物闭环：`EntryPageHost.vue`（九百多行）按写入种类拆成组合式函数与对话框模板，意图选择器抽成组件；移动各字段“只发改了的”、剧情意图下的元素与块补专门用例；元素有几个引用子字段时各用一份查找。
- 合入（2026-11-19）：master 又并进分支一次（`8b5e76f54`，带进 Agent 对话视图与审批向导的改动），类型检查与 `canon-write`、`canon-author` 9 条 e2e 都过，合入 master（`8858e946e`）。Spec 随合入提交（`3612d8fc5`）：`canon/agent-tools.md` 新登记为 planned；`revisions.md` 输出 25、`author-ui.md` 输出 37 到 43、`project.md` 的 `findEntries` 等都是 planned，晋升等开发者看过底座再定。

## 下一步

1. 开发者审查底座（作者在界面上改、Agent 用工具改，同一条通道）。
2. 和开发者定人物 Component 闭环的范围；推后的几项（`EntryPageHost.vue` 的拆分、意图选择器抽组件、补的几条用例）并进那个 Task。
3. 开发者同意后做 Spec 晋升前核对（opus 子代理）：`canon/agent-tools.md`，`revisions.md` 输出 25，`author-ui.md` 输出 37 到 43。
