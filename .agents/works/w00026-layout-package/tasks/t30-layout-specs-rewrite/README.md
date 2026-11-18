---
schema: nbook.task/v2
taskId: t30-layout-specs-rewrite
status: active
updated: 2026-11-18
---

# 布局 Spec 的晋升与重写：workbench-layout 已实现条目晋升、nested-grid 编号拆条

## 目标与范围

从 t26 拆出：ui/workbench-layout 里已实现、有测试守着的 planned 条目晋升（含 t27、t28 的入口条与切换，补实现合同与证据）；ui/nested-grid 输出条目编号、长条拆成能各自对上测试的小条、组件 API 移到 NestedGrid.md，并改全部引用。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)。只改写法与成熟度标记，不改行为；发现 Spec 与代码不一致时按“核实后修正错误的一侧”，改行为的另建 Task。依据：t26 README 里开发者 2026-11-16 答第 3、4 件（晋升已实现、有测试守着的条目；nested-grid 编号、拆条、组件 API 移到 `NestedGrid.md`）；晋升不需要开发者批准（`docs/specs/README.md`“两种成熟度，一个文件”，开发者 2026-11-17 定）。

## 当前状态

2026-11-18 开工。先盘点：两份 Spec 里每一处 planned 有没有实现、有没有测试守着，nested-grid 的条目被哪些地方按小标题引用，Smoke 与证据行缺哪些 e2e（Claude Sonnet，`claude -p`，只读，报告在主工作区 `.local/agent/works/w00026-layout-package/tasks/t30-layout-specs-rewrite/reports/inventory.txt`）。盘点回来后写 `plan.md`，做设计审查，再动 Spec。

盘点回来（[`evidences/inventory.txt`](evidences/inventory.txt)）：workbench-layout 149 处标记，A（已实现、有测试）141，B（已实现、没找到测试）3，C（没做）1，N（不是功能条目）4；nested-grid 7 处，A 6，B 1。计划第 1 稿见 [`plan.md`](plan.md)。

- 计划第 1 稿的设计审查（Claude Sonnet，2026-11-18，[`evidences/plan-review.txt`](evidences/plan-review.txt)）：15 条，重要 9、建议 6。抽查了第 2 条点到的 #27（测试传的是自造的 `{height: 32}`）、#48（只有自动等待），属实。都按审查的方向改成第 2 稿，没有新机制，不再送第二轮：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | 拆条后按旧小标题的引用会指向错的小条 | 改：组名加前缀，开头写组名的读法，指具体子规则的引用逐个改编号 |
  | 2 | 盘点的几处 A 只对上测试名、没对上断言 | 改：按句子重核，降级 #27、#48、#62、#103、#109、#122 至 #124，`evidences/promotion.txt` 逐处记 |
  | 3、4 | “过渡”“内容层”“浮动窗”拆条容易丢限定 | 改：先列句子表、逐句打勾 |
  | 5 | API 的去处不止 `NestedGrid.md`；交互合同与公开标记该留在 Spec；第 78 行是行为 | 改：符号表逐个定去处，第 78 行提进输出 |
  | 6 | `NestedGrid.md` 里重复的行为正文没去重 | 改：压掉重复，留用法与提醒 |
  | 7 | nested-grid 不晋升的理由没查实，`:48` 一条两种结论 | 改：先查第 118 行未闭合的范围再定；`:48` 拆两条，补 `sashStyle` 的测试 |
  | 8 | 输出 44 的改写含糊、互相引用 | 改：写明改法；“移到”菜单项另建 Task |
  | 9 | 计数用 `-c` 数的是行；先后会留悬空引用 | 改：逐处列表；包文档先合入、Spec 紧挨着提交 |
  | 10 | Smoke 末行太长、漏 `lab-grid-panels` | 改：末行只写入口，证据行补全 |
  | 11 | 实现合同没核 | 改：写出五条不变量与公开入口的写法 |
  | 12 | B 类有几条补一行断言就能晋升 | 改：加“补测试”一片；“只改文档”是第 1 稿自己立的范围 |
  | 13 | 标记的读法跟前言一起删了 | 改：补进 `docs/specs/README.md` |
  | 14 | 失败项没编号、证据有叙述 | 改 |
  | 15 | `PanelRecord` 示例补字段与“内部合同”冲突 | 改：保持内部、标注 |

- 2026-11-18 在后台：
  - omp（默认模型）按句子核对两份 Spec 的每一处标记，在 detached worktree `.worktree/review-t30-promotion` 里跑，报告逐条追加到主工作区 `.local/agent/works/w00026-layout-package/tasks/t30-layout-specs-rewrite/reports/promotion.txt`，处理后存为 `evidences/promotion.txt`。
  - Claude Sonnet 起草第 3 片：句子表、符号表、编号表、成熟度建议、新的 nested-grid 与 `NestedGrid.md` 草稿，写在同目录 `reports/draft/`，不动仓库，主会话逐句审过再落进仓库。
  - 第 1 片（补测试）等 t26 审查修正合入 master 再开 worktree：两边都改 `workbench-containers.e2e.ts`。

- 第 1 片（一）`42844c5f0`（分支 `docs/w00026-t30-specs`）：`sashStyle` 写到那一条分隔线上、同名以网格的位置为准（变异检查：样式放到后面盖住位置时失败）；有分节时锚不进呈现树、空区域打开时锚就是那块面板；F6 停在活动栏与两条入口条上、入口条在分节之前；入口条里每个入口一个 Tab 停靠。降级里别的几条等 omp 的逐句结论再补。
- 第 3 片 nested-grid：Claude Sonnet 起草（句子表、符号表、编号表、成熟度建议、整份 Spec 与 `NestedGrid.md`），存为 `evidences/nested-grid-*.txt`。138 条输出，标题带组名前缀，开头写组名的读法；失败 1 到 4。主会话的决定：
  - 成熟度保持 `planned`，不照草稿晋升：草稿自己说输出 11 到 16、19、24、25、28、30、36、58、112 没找到能区分的断言，只按测试名抽查过。条目级标记全部去掉；`目标与非目标` 里列“晋升为 implemented 之前要补的”，加上这十几条。“宿主样式”已由第 1 片的测试守着，从清单里拿掉。
  - 草稿删掉的“减少动态效果时不渐显、停留时长照旧”（判为与 `Splitter.md` 重复）补回第 13 条：`Splitter.md` 确有这句，但它说的是独立 Splitter，多写半句不丢行为。
  - 草稿按代码改正的两处照收：浮动窗的字段是 `gesture?`，不是 `moving?`；原第 112 行“Component Lab --suite workbench-shell”只在旧应用里，删掉。第 122 行“不再有百分比换算……Reka 拖动通道”是历程，删掉。
  - 草稿列的“只在 `NestedGrid.md` 里的行为句子”（`evidences/nested-grid-notes.txt` 第 5 节）不升进 Spec：不加输出条目；以后晋升时再看。
- 第 2 片包文档：`NestedGrid.md` 换成草稿（压掉与 Spec 重复的行为正文，链接编号）；`grid.md`、`Splitter.md`、`DropFeedbackOverlay.md` 按补丁补几处。两个比例的边界在 `grid-drop.ts` 里核过（插入位大于 0.5 不合法、边缘不小于 0.5 不合法，缺省 0.2）。代码注释与测试名里指向某一条子规则的引用改编号，交给 Claude Sonnet 按编号表机械迁移。

- 第 2 片 `ae607f38c`、第 3 片 nested-grid `e09869392`，2026-11-18 合入（`b7f57492c`）。代码注释与测试名的引用迁移：Claude Sonnet 按编号表改了约 40 处，主会话审 diff，只动引用那几个字；抽查 15 个编号都对上新 Spec；改掉两处多出的空格。`layout-project.ts:125` 写的是属性名、不是引用，不改。nb-layout `bun test` 593、vitest 258、两个包的类型检查都过。
- 第 4 片第一步 `b4ffc7435`：
  - 引用 nested-grid 的地方改成编号，输出 44 改写；
  - 删掉过时的前言，非目标去掉标记；
  - 实现合同只写包入口，补“当前容器只在提交时变”“切换容器不改尺寸意图”两条有测试的不变量，骨架那条补上 `predatesContainers`；
  - Smoke 末行只写四个入口，证据补齐，删掉“。；”；
  - `PanelRecord` 示例的 `collapsed` 注明同名不同义；
  - `docs/specs/README.md` 写明标记的范围，以及去掉标记的判据。
- 输出 44 的“移到”菜单项另建 [t32](../t32-entry-menu-move-to/README.md)，待确认清单同日一行。
- omp 逐句核对（[`evidences/promotion.txt`](evidences/promotion.txt)，只读，没跑测试）：workbench-layout 149 处，去掉 100、留 39、没做 5、改写 5；盘点判 A 的 141 处里 40 处降为留或没做，大多是整条标题上的标记，那一条里有几句缺能区分的断言。
  - “没做”的 5 处：两处是“锚不进呈现树”的全称说法（原句在空区域时不成立），另外是输出 22、44、47 里各有一句没做或缺断言。
  - 落标记交给 Claude Sonnet 出草稿：去掉的删，整条标题上留的挪到缺断言的那几句，锚的两句按新测试改写后去掉，F6 与 Tab 停靠按第 1 片的新测试去掉。主会话审标记的 diff 后提交。

## 下一步

审 Sonnet 的标记草稿（`reports/draft2/`），提交；收口：`grep -n planned` 逐处对上 `promotion.txt` 与改动表；`docs:check`、`governance:check`；实现审查（omp）。