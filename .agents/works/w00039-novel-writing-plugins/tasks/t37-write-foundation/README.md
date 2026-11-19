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

## 下一步

1. F5 剩下的：确认条的草稿分“字段”与“条目头”、移到页头之下；页头的名字、简介“改”与别名一行（`aliases`）；“更多”菜单的“移动到……”（`MoveDialog`，`place`，含出场与另一个身份）与“添加一组设定”；数据分页的“去掉这组设定”；已删除页的最简页头与“恢复”；新建对话框的种类快捷按钮与 `EntryPicker` 候选。
2. F6：字段表的引用（`EntryPicker`）、图片（`ImageInput`）、语义档（改起点、每个分页能记一句）、列表与元素对话框（nb-form）、主文字的块（“文字”分页总出）；`ComponentViewContext` 的新方法。
3. F7：e2e 与截图；之后实现审查（前端 Sonnet、后端 omp）、合入，Spec 改动随合入提交。
2. 第二轮处理完后照切片 F1 到 F7 实施。
3. 底座合入后，和开发者定人物 Component 闭环的范围。
