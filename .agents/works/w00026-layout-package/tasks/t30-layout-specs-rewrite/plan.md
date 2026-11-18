# t30 计划：workbench-layout 已实现条目晋升，nested-grid 编号拆条

第 2 稿（2026-11-18）：按设计审查（[`evidences/plan-review.txt`](evidences/plan-review.txt)，15 条，处理在 Task README）改：

- 晋升按句子核对断言，不按条目标题或测试名（第 2 条）；
- 拆条前先逐句列表（第 3、4 条）；
- 按小标题的引用改成组名加逐个改编号（第 1 条）；
- API 的去处按符号逐个定，不只 `NestedGrid.md`，并给 `NestedGrid.md` 去重（第 5、6 条）；
- nested-grid 先查清没闭合的范围再定晋升（第 7 条）；
- 输出 44 的改写（第 8 条）；
- 顺序与计数（第 9 条）；
- Smoke 行（第 10 条）、实现合同（第 11 条）；
- B 类能补一行断言的补上（第 12 条）；
- 标记的读法留在 README（第 13 条）；
- 失败项编号、证据整理（第 14 条）；
- `PanelRecord` 示例（第 15 条）。

第 1 稿：只改文档、照盘点晋升。

## Context

t26 的深入审查（docs-01、05、10、13）指出两件事：

- `ui/workbench-layout` 是 `implemented`，正文里却有 97 行带“（planned）”，拆开算 149 处，读的人分不清哪些条目有测试守着；
- `ui/nested-grid` 的输出条目没有编号，靠小标题当 id 被引用；“过渡”“内容层”两条各一千五到两千六百字，还把组件 API 写进了 Spec，`NestedGrid.md` 里同样的行为又写一遍。

开发者 2026-11-16 答 t26 第 3、4 件：

- workbench-layout 里已实现、有测试守着的 planned 条目晋升，只留真没做的；
- nested-grid 输出条目编号、长条拆成能各自对上测试的小条、组件 API 移到组件文档。

晋升不需要开发者批准（`docs/specs/README.md`“两种成熟度，一个文件”，开发者 2026-11-17 定）。

依据：盘点报告 [`evidences/inventory.txt`](evidences/inventory.txt)，Claude Sonnet 读代码给的结论，A 141、B 3、C 1、N 4。设计审查抽查指出其中几处 A 只对上了测试名、没对上断言，所以盘点只当线索，每一处由实施者按句子重核。

范围：

- 不改产品行为。
- 补几条测试，只断言现有行为。
- Spec 与代码不一致时先核实哪边错：错在 Spec 的随本 Task 改，错在代码的另建 Task。
- Spec 与 `docs/specs/README.md` 在主工作区改；包里的 `.md`、代码注释与测试在 worktree `w00026-t30-specs`（分支 `docs/w00026-t30-specs`）改，合入后再提交引用它们的 Spec。
- 主工作区提交一律路径限定。

## 技术选型

无。

## 关键设计

### 晋升的判据（两份 Spec 通用）

- 一处标记去掉，要满足两条：
  - 这句话（不是这一条的标题）在代码里成立；
  - 有一个测试的断言能区分“成立”与“不成立”。只靠自动等待、测试自己传的常数、辅助函数里顺带数到的，都不算。
- 输出 40 到 48 这种上千字的条目，按句列成“句子 → 测试 文件:行 → 断言是什么”。
- 结论写进 `evidences/promotion.txt`，盘点的每一处都有一行：去掉，还是留句子级标记及缺什么。
- 设计审查已指出的降级：
  - #27：输出 6 的 32px 与“底部面板至少 112”，测试传的是自造的 `{height: 32}`，产品值是 `PANEL_HEAD_HEIGHT + stripTopInset`；
  - #48：输出 13 还原时“过渡结束才搬回入口条”；
  - #62：输出 20 的“分节没有隐藏按钮”（侧栏、右栏）；
  - #103：输出 38 的“分节的标题行不吸收”；
  - #109：输出 39 的“多标签的窗要先撕下标签”；
  - #122 至 #124：输出 47 的“每个入口一个 Tab 停靠”，同输出 18。
  - 这些先按 B 处理，能用一两条断言补上的进“补测试”一片，补不上的留句子级标记。
- 再用脚本列出测试名与文件头里引用的“输出 N”“验收 N”，对照两份 Spec 的全部编号，没有任何测试引用的编号单列出来人工看。

### 补测试（worktree，第 1 片）

只断言现有行为，每条先在当前代码上跑过：

- workbench-layout：
  - “区域里有分节时锚不进呈现树”：e2e 断言 `[data-leaf="sidebar"]` 为 0，空区域打开时为 1。
  - 输出 18 与 47“入口条是一站、每个入口一个 Tab 停靠”：`workbench-containers` 入口条的用例后加 F6 与 Tab 的断言。
  - 降级里一两行能补的：#62 侧栏、右栏分节的头里没有隐藏按钮；#27 入口条叶的高度等于产品常数，按实测改 Spec 的说法；#109 多标签的窗中央不接收、单标签的接收。
  - #48 的“过渡结束才搬回”要逐帧看，#103 要拖到标题行上量，写得出就写，写不出留标记。
- nested-grid：
  - “分隔线的宿主样式”：`NestedGrid.dom.test.ts` 断言宿主的 `sashStyle` 写到分隔线元素上，同名的属性以网格的位置为准。
- 不写：验收 1 的后半，侧栏的视图并入浮动窗时内容逐帧滑过去。要新写一条逐帧的 e2e，留句子级标记，Task README 列为后续。

### `docs/specs/ui/nested-grid.md`（第 3 片）

- **先列句子表**：
  - 把“过渡”“内容层”“交换”“浮动窗”四条按句子拆成表，存 `evidences/nested-grid-sentences.txt`，每句写归入哪一条新条目。
  - 审查列出的易丢句子要在表里有归属：
    - “过渡”：四条边一起到位、嵌套的网格、单个新叶、新分隔线跟外框的边、横向贴边（只写一处，别的条目引用它）、过渡中开始手势或容器变化直接到终点、连续变化重新计时、`shapedLeaves` 的时间、浮动窗不按形状裁、投影与叠放、离开的叶默认立即消失，以及例外要四个条件同时成立；
    - “内容层”：只有 `insetTop` 变了不过渡、五层叠放、`lifted` 的两种状态、换叶时滑、不活动等都按停放、一站是外框加活动内容、不传内容项的宿主行为不变；
    - “浮动窗”：不承诺挪到“目标与非目标”，实时布局落地的例外指到 workbench-layout 输出 38、39。
  - 改完逐句打勾。
- **编号与拆条**：
  - 输出条目编号 1 起。拆出来的条目标题带组名前缀（“过渡：判定”“过渡：离开的叶”……），第一条也带后缀，不单独叫“过渡”。
  - “输出与可观察行为”开头写一句：标题以“过渡：”开头的各条合称“过渡”，其余组同理。按旧小标题的引用读作这一组，逐个改成编号的除外。
  - “分隔线的宿主样式”拆成两条：宿主样式、`sashDisabled`。
  - 第 78 行拖动中兄弟之间的分配（开发者 2026-11-15 决定），是可观察行为却放在“副作用与数据”里，提到输出里编号。
  - 失败与恢复编号。
  - 例子里的工作台词汇（“区域展开时的整列”“隐藏的区域按拖到零画”）换成原语的说法，例子留给 workbench-layout。
- **API 的去处**：
  - 先列“Spec 里的符号 → 现在写在哪份文档、缺什么”的表（`evidences/nested-grid-symbols.txt`）。按审查的分法：
    - 挪走：组合函数与签名，即 `useLayoutExtent`、`useGridLayout`、`placeGrid`、`useSashGesture`、`GridGestureCommit`、`onGestureCommit`、`resizeBranches`、`splitLeaf` 的签名。去 `NestedGrid.md`、`grid.md`，缺的补上。
    - 已在 `DropFeedbackOverlay.md` 的落点函数与已在 `Splitter.md` 的悬停数值：Spec 删掉并链接。
    - 留在 Spec：交互合同与时机，即 `content-parked` 由谁处理焦点、`swap` 的 `token` 何时用掉与作废、`moving` 等读到的是这一轮的；还有宿主观察 DOM 依赖的公开标记，`data-swap` 的取值、`position: fixed` 的包含块这类。
    - 判据：换一种实现、行为不变，这句话要不要改？要改就挪；宿主据此写代码、写测试的，留下。
  - 第 116 到 122 行的“实现合同”：行为进输出，API 去包文档；要不要留这一节按下面的晋升结论。
- **成熟度**：
  - 先查第 118 行“Storage 宿主、未知引用的合成保存与真实浏览器验收未闭合”对应哪些条目与验收。
  - 只是验收与少数句子时，Spec 晋升 `implemented`，未闭合的标句子级“（planned）”，补齐实现合同与三行证据；查下来范围大时保持 `planned`，并去掉条目级标记，在“目标与非目标”里列出未闭合的部分。结论写进 Task README。
- **证据**：整理成固定几行，即批准依据，以及晋升时的实现入口、合同测试、Smoke。日期、评语、Task 编号这类叙述挪到 Task。核对第 112 行的验证入口还在不在。

### 包文档（worktree，第 2 片）

- `NestedGrid.md`：接住挪过来的组合函数、属性与时机。“布局”“交互”两节里与 Spec 重复的行为正文压掉，只留 Spec 没有的用法与使用提醒（例如叶里的 `ResizeObserver` 过渡中每帧都会收到尺寸），链接 Spec 的编号。
- `grid.md`、`Splitter.md`、`DropFeedbackOverlay.md`：按符号表补缺的。
- 代码注释里按小标题指向某一条子规则的，改成编号，例如 `grid-motion.ts`、`NestedGrid.vue:144`、`useContentLayer.ts`；指整组的不改。
- 编号表在第 3 片之前定下（写进 Task README），这一片引用它。
- 先后：编号表 → 第 2 片在 worktree 写 → 第 3 片的 Spec 在主工作区写好 → worktree 合入 → 第 3 片提交。合入与 Spec 提交紧挨着，中间不留两边都没有的内容。

### `docs/specs/ui/workbench-layout.md`（第 4 片）

- 标记：按判据逐处去掉或改句子级。
- N 类：
  - “容器的其它形态”写成不承诺；
  - “活动栏隐藏时切换侧栏的容器”写成已知限制；
  - 前言里过时的“视图容器还没有实现”删掉。标记的读法（标题后带的是整条，一句话后带的只有那一句）补进 `docs/specs/README.md`“两种成熟度”。
- 输出 44：
  - 改写成“重置”是现行行为，“移到”另外两个区域的两句整体保留“（planned）”，并写明拖入口已经能搬整个容器（输出 46）；
  - 第 16 行的“（输出 40 到 47）”注明 44 的“移到”菜单项除外；
  - 第 245、246 行的“同输出 44 的‘移到’”改成指“搬整个容器”的行为（输出 46）。
  - “移到”菜单项另建一个小 Task（底层 `moveContainerTo` 已有，只差菜单与文案），记进待确认清单。
- 引用 nested-grid 的地方：
  - 有小标题的 6 处，加上没小标题、指具体规则的 2 处（第 123、273 行），逐个改成编号；
  - `editor.md:148` 看全文再定。
- Smoke 与证据：
  - “验收与 Smoke”末行只写入口：`workbench-containers`、`workbench-dnd`、`workbench-shell`、`workbench-views`；
  - 证据的 `Smoke：` 列出 `workbench-containers`、`workbench-live-drag`、`workbench-float`、`lab-workbench-surface`、`lab-drop-sectors`、`lab-grid-panels`、`workbench-drag-cost`，后者注明“数次数”；
  - `合同测试：` 补盘点第 4 节列的单元测试；
  - `editor-area`、`files-explorer` 不列；`lab-grid-structure` 挪掉，它在 nested-grid 的证据里。
- 实现合同：
  - 公开入口只写包入口与公开符号，不列内部文件。
  - 不变量写五条：
    1. 骨架守住，含 `fitsSkeleton` 与 `predatesContainers` 回落；
    2. 文档只在内存一份；
    3. 内容项不换父元素；
    4. 当前容器只在提交时变（`layout-present.test.ts`、`entry-drop.test.ts`）；
    5. 切换容器不改尺寸意图（`workbench-containers` 的用例）。
  - “容器空了由 `settleContainers` 收口”并进第 1 条的测试说明。
  - 第 360 行引用的“内容层”改编号。
- `PanelRecord` 示例：保持“内部合同、字段不承诺”，示例里的内部字段标“内部”。锚的 `collapsed`（拖到零）与分节的 `collapsed`（标题行）同名不同义，在第 129、131 行的表里写明。
- 顺手：证据行的“。；”；“标 planned 的视图容器条目”那句改写。

## Spec 与文档改动

即上面几节。另：`docs/specs/README.md`“两种成熟度”补标记的读法；注册表行同步成熟度。

## 切片

1. **补测试**（worktree）：上面列的断言。验证：改到的测试文件，nb-layout `vitest`，e2e 只跑改到的文件。
2. **包文档与代码注释**（worktree）：在第 3 片的编号表、符号表定下之后写。验证：`docs:check`、`governance:check`。
3. **nested-grid**（主工作区）：句子表、符号表、编号表、成熟度结论进证据与 README；Spec 写好后与第 1、2 片的合入紧挨着提交。
4. **workbench-layout 与 README**（主工作区）：`evidences/promotion.txt` 逐处结论；标记、N 类、输出 44、引用、Smoke 与证据、实现合同、`PanelRecord`。
5. **收口**：标记逐处列表（`grep -n -i planned`，含“，planned）”与裸词），每一处对上 `promotion.txt`；引用逐个看内容，不只看标题；`docs:check`、`governance:check`。实现审查用 omp（与盘点、设计审查不同的模型），机械抽查 `promotion.txt` 的“文件:行 → 断言”每节不少于 5 处，再查拆条与 API 挪动有没有丢句子。

## 验收映射

- 不改行为、不加输出条目（nested-grid 第 78 行提进输出是把已有的规则换个位置）。
- 晋升的依据在 `evidences/promotion.txt`，每一处对一个断言。
- `docs/specs/README.md`“编号”：nested-grid 第一次编号一次排定，之后只在末尾追加。

## 不做与风险

- 不做输出 44 的“移到”菜单项，另建 Task；不写验收 1 后半的逐帧 e2e，留标记。
- 风险：重核 149 处工作量大。输出 40 到 48 按句列表是主要工作，别的条目短，逐处看断言即可。
- 风险：拆条丢句子，由句子表逐句打勾兜底。
