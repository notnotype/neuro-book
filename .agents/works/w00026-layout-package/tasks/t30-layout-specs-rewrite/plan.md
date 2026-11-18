# t30 计划：workbench-layout 已实现条目晋升，nested-grid 编号拆条

第 1 稿（2026-11-18）。

## Context

t26 的深入审查（docs-01、05、10、13）指出：`ui/workbench-layout` 是 `implemented`，正文里却有 97 行带“（planned）”（拆开算 149 处），前言还写“视图容器还没有实现”，读的人分不清哪些条目有测试守着；`ui/nested-grid` 的输出条目没有编号、靠小标题当 id 被引用，“过渡”“内容层”两条各一千五到两千六百字，一条里写好几件事，还把组件的属性、插槽、标记写进了 Spec，`NestedGrid.md` 里同样的内容又写一遍。

开发者 2026-11-16 答 t26 第 3、4 件（见 t26 README）：批准 workbench-layout 里已实现、有测试守着的 planned 条目晋升，只留真没做的；nested-grid 重写：输出条目编号、长条拆成能各自对上测试的小条、组件 API 移到 `NestedGrid.md`。晋升不需要开发者批准，证据写全、逐条核对通过后由实施者晋升（`docs/specs/README.md`“两种成熟度，一个文件”，开发者 2026-11-17 定）。

依据：盘点报告（Claude Sonnet，只读，主工作区 `.local/agent/works/w00026-layout-package/tasks/t30-layout-specs-rewrite/reports/inventory.txt`，存为 `evidences/inventory.txt`）。workbench-layout 149 处标记：A（已实现、有测试）141，B（已实现、没找到测试）3，C（没做）1，N（不是功能条目）4；nested-grid 7 处：A 6，B 1。

约束：只改写法与成熟度标记，不改行为。核对中发现 Spec 与代码不一致时，先核实错的是哪一边：错在 Spec 的随本 Task 改正，错在代码的另建 Task。Spec 在主工作区改；`NestedGrid.md` 在包里，按代码改动的规矩在 worktree 里改，合入。

## 技术选型

无。

## 关键设计

### `docs/specs/ui/workbench-layout.md`

- A 类 141 处：去掉“（planned）”。一行里有几处标记、结论不同的，只去 A 的那几处。
- C 类（输出 44 入口右键菜单的“移到”另外两个区域）：那一句保留“（planned）”，同条已实现的“重置”去掉标记。
- B 类：
  - 输出 18“活动栏与右栏、底部面板的入口条也各是一站”：保留“（planned）”。入口条在树序里、入口是按钮，但没有用例断言 F6 停在入口条上。
  - 验收 1 的后半“改放到工具视图浮动窗的标签条，内容仍从侧栏滑到窗里”：保留“（planned）”。已有的用例量的是窗到窗、面板到面板。
  - “边界与兼容”的标记一句“锚不进呈现树，`[data-leaf="sidebar"]` 这类选择器选不到东西”：和输出 48 不一致（区域打开着、一个分节都没有时，锚就是那块空面板）。改成“区域里有分节时锚不进呈现树……”，并注明空区域时锚就是那块面板，去掉标记。`layout-project.test.ts` 的“锚与不在当前容器里的分节不进呈现树”“空区域打开着”两条守着它。
- N 类：
  - “目标与非目标”里“容器的其它形态”：是非目标，去掉标记、写成不承诺。
  - “活动栏隐藏时切换侧栏的容器”：是已知限制，去掉标记、写成已知限制。
  - “输出与可观察行为”下的前言段（“视图容器……还没有实现。标题后面带（planned）的……”）：删掉。条目级标记的读法是 README 的规则，不在每份 Spec 里重复。
- 顺手改盘点里列出的三处：
  - 证据行的“。；”；
  - 证据里“标 planned 的视图容器条目”那句，标记清掉后改写；
  - 输入一节 `PanelRecord` 示例的字段名和第 91 行的说明对齐。
- 本 Spec 里引用 nested-grid 小标题的 6 处（第 53、143、144、148、242、360 行）：改成引用新编号，写法是“[ui/nested-grid](nested-grid.md) 输出 N”。
- “验收与 Smoke”的最后一行与“证据”的 `Smoke：`、`合同测试：`：
  - 补上实际在验这份 Spec 的 e2e：`workbench-containers`、`workbench-live-drag`、`workbench-float`、`workbench-drag-cost`、`lab-workbench-surface`、`lab-drop-sectors`、`editor-area`（只写与本 Spec 相关的拖动、拆分）、`files-explorer`（树里的文件拖到工作台）；
  - 合同测试补 `state/containers.test.ts`、`state/layout-present.test.ts`、`entry-drop.test.ts`、`live-drag.test.ts`、`commands/part-commands.test.ts`、`commands/panel-commands.test.ts`、`commands/view-commands.test.ts`、`shell/adjacency.test.ts`、`WorkbenchPanelHead.dom.test.ts`、`WorkbenchRegionStrip.dom.test.ts`、nb-layout 的 `layout-project.test.ts`；
  - `lab-grid-structure` 验的是 nested-grid，从这一行挪掉。
- “实现合同”：对照 t27、t28 之后的代码核对。公开入口、owner、不超过五条有测试锁定的内部不变量；容器、入口条若缺一条关键不变量就补，超过五条时换掉最不关键的。

### `docs/specs/ui/nested-grid.md`

- 输出条目编号 1 起，按现在的先后。每条保留粗体标题：现在按小标题引用的地方（代码注释、测试名、提案）不用跟着改，仍然找得到。
- 拆长条：
  - “过渡”拆成几条：判定（哪些变化过渡、哪些不）、一整棵子树新开出来、离开的叶留着缩回去、降到零的叶、内容跟外框与内容不跟外框、裁切与卡片形状。每条的标题都以“过渡：”开头，第一条就叫“过渡”。
  - “内容层”同样拆，标题以“内容层：”开头。
  - “交换”“浮动窗”超过一件事的也拆。
  - 每条只说一件事，能对上一组测试。
- 组件 API 移到 `NestedGrid.md`：Spec 里出现的属性名、插槽名、`data-*` 标记、组合函数名（`useLayoutExtent`、`useGridLayout`、`placeLifted` 等）挪过去或核对 `NestedGrid.md` 里已有，Spec 只写行为并链接 `NestedGrid.md`。判据是 README 的第 1 条：换一种实现、行为不变，这句话要不要改？要改就挪。宿主观察 DOM 所依赖的公开标记，可以在 Spec 的“边界与兼容”里一句话指到 `NestedGrid.md` 的标记表。
- 标记：
  - A 类 6 处去掉“（planned）”。
  - B 类“分隔线的宿主样式”整条保留“（planned）”：nb-layout 里没有直接测 `sashStyle` 的用例，“同名的以网格为准”也没有断言。
  - Spec 的 `status` 不变，仍是 `planned`：第 118 行写明的 Storage 宿主、未知引用的合成保存与真实浏览器验收没有闭合，与条目标记无关。
- 证据补上“交换”的测试（`grid-swap.test.ts`、`useGridMotion.dom.test.ts`、`NestedGrid.dom.test.ts`、`lab-grid-swap.e2e.ts`）。自引用的小标题（第 126、131 行）改成编号。

### `packages/nb-layout/src/vue/NestedGrid.md`（worktree）

- 接住从 Spec 挪出来的属性、插槽、标记与时机，已有的不重复写。行为规则不在这里重复，链接 Spec 的编号。
- 改动只在这一个文件；按小标题引用 nested-grid 的代码注释与测试名不改（标题保留）。

## Spec 与文档改动

即上面三节。Task README 记盘点与各片；`docs/specs/README.md` 的注册表行若写着“待晋升”，同步改掉。

## 切片

1. **workbench-layout**：标记、前言、三处顺手改、引用 nested-grid 的改成编号（依赖片 2 的编号，所以片 2 先定编号表）、Smoke 与证据、实现合同。主工作区提交。
2. **nested-grid 与 `NestedGrid.md`**：先定编号表（旧标题到新编号），再拆条、挪 API、改标记与证据。Spec 在主工作区提交，`NestedGrid.md` 在 worktree 提交后合入。

顺序：片 2 的编号表先定（写进 Task README），再做片 1，最后做片 2 的其余部分。

验证：`bun run docs:check`、`bun run governance:check`；`grep -c "（planned）"`，留下的逐个对上 B、C 类清单；按小标题引用 nested-grid 的地方逐个对过，新 Spec 里都还有这个标题（脚本列出全部引用的标题，对照新 Spec 的粗体标题）。

## 验收映射

- 不改行为，没有新的输出条目。晋升的依据是盘点报告里每一处 A 类给出的测试（文件:行），存进 `evidences/inventory.txt`。
- `docs/specs/README.md`“编号”：nested-grid 编号之后只在末尾追加；拆出来的条目按现在的先后一次排定。

## 验证

见切片。另把改后的两份 Spec 交实现审查（Claude Sonnet），只看三件：去掉标记的条目，测试真守着吗；拆条与挪 API 有没有丢掉行为；引用还对得上吗。

## 不做与风险

- 不补 B 类缺的测试、不做 C 类的“移到”：要改代码，不在“只改文档”的范围。Task README 列出它们，补了测试即可晋升。
- 不晋升 nested-grid 整份 Spec。
- 风险：盘点是 Sonnet 读代码给的结论，个别 A 类可能是测试名对上、断言没对上。实施时抽查每节至少两处；实现审查专门查这一点。
- 风险：拆“过渡”时丢掉某个限定条件。拆之前把原文按句子列出来，拆完逐句对照。
