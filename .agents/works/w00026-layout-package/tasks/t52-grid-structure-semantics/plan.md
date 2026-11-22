# t52 计划：nb-layout 结构操作不压固定栏、`setSize`（第 2 稿）

第 1 稿的设计审查（Claude Sonnet，重要 8、建议 6，[证据](evidences/design-review.txt)）与 API 形状审查（Claude Sonnet，重要 8、建议 5，[证据](evidences/api-review.txt)）的重要问题，大半落在第 1 稿自己加的“展平与拆分继承尺寸规则”上：继承来的属性进不了快照，约束分轴、整体替换会丢，拆分把收起策略搬走后宿主按叶 id 收起会失效。这些是库里本来就有的问题，不在开发者定的范围里，硬改牵出更多问题。第 2 稿收回到开发者的决定：原地增删不压固定栏、加设宽度的入口。差别见末尾“修订记录”。

## Context

- **为什么做**：开发者 2026-11-22 定“原地增删不压固定栏、加设宽度的入口”（[t51 的“决定”](../t51-layout-api-gaps/README.md)）。
- **现状**（实测）：`addLeaf`、`removeLeaf`、`moveLeaf` 与 `resize` 经 `shiftSiblings`（`shareAxis`）把意图摊给全部兄弟：保留像素的兄弟被改（导航 188 变 150，再删也回不去）、收起中的兄弟被写成 0、按比例分的意图被当成像素夹进最小尺寸。
- **调用方**：结构操作与 `resize` 在仓库里只有 nb-layout 自己的测试与 Lab 的两个场景在用；工作台从布局文档重建网格，不受影响。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t52-grid-structure`（分支 `w00026/t52-grid-structure`）。只改 `packages/nb-layout/`。

## 关键设计：`src/grid.ts`

### 一、增删与移动不改兄弟的意图

- 意图按节点的 `sizing` 解释：保留像素的是像素；按比例分的是同一分支里按比例分的兄弟之间的相对份额。插进或拿走一块之后，份额自然按比例重分。
- `addLeaf`、`removeLeaf`：兄弟的意图一律不改（保留像素的、按比例分的、收起中的都不改）。
- `addLeaf` 的按比例分的新叶没给主轴意图（`size` 省略或主轴为 0）时，取这一支里按比例分、没收起、意图为正的兄弟的平均意图（平分一份）；没有这样的兄弟时取 1。给了就照用，单位同兄弟（`grid.md` 写明：要等分就别给）。
- `moveLeaf`：
  - 同分支重排：意图不变（同现在）。
  - 按比例分的节点移到别的分支：它的意图按“按比例分的新叶”重算（取目标分支的平均份额），不带着源分支的单位进来（API 审查第 6 条、设计审查第 3 条）。
  - 保留像素的节点移到别的分支：意图照旧（像素）。移到方向不同的分支、新主轴上没有正的意图时失败，不悄悄改成按比例分（设计审查第 4 条：那样来回移动不可逆）：码 `invalid-argument`、`params: {field: "size-missing", id}`，树不变。
- 展平单孩子分支、`splitLeaf` 不改（审查发现的老问题写进 `grid.md` 的已知限制，见下）。
- 输出：`ui/nested-grid` 新增条目 153。

### 二、`resize` 也不压固定栏

- `shiftSiblings` 只剩 `resize(id, axis, delta)` 在用。把它分摊的候选改成“按比例分、没收起”的兄弟（同 `sharesByWeight` 的判据），保留像素与收起中的兄弟不动（设计审查第 9 条：不改的话“导航 188 变 150”换个入口还在）。`resize` 的 `applied` 在固定兄弟多的分支里会变小，单测钉住。
- 输出：并进条目 153。

### 三、`grid.setSize(id, px)`

- 只改这个保留像素节点沿父分支主轴的意图，兄弟不动；不读布局、不夹约束（约束在布局时夹，同其它意图）。
- 收起中的节点：同时把 `collapse.restoreSize` 改成 `max(collapsedSize, px)`，展开（`setCollapsed`）与分隔条上的 Enter 回到同一个宽度。
- 返回 `{ok: true, changed}`；有收起策略时另带 `collapse`（与 `setCollapsed` 的结果同形）。
- 失败：
  - `not-found`；
  - 根节点：`invalid-argument`（`field: "root"`，已有形状）；
  - 按比例分的节点：新码 `wrong-sizing`，`params: {id, expected: "fixed"}`（码集合开放，ADR 0054 第 4 条）；
  - 非有限：`not-finite`，`params: {field: "size", id}`（新形状）；
  - 负数：`invalid-argument`，`params: {field: "size-negative", id}`（新形状，不带 `side`）。
- 轴是父分支的主轴（竖向分支里设的是高度），文档写明；分支也可以（保留像素的分支同样有意图）。
- 用 `useGridHost` 的宿主调完要 `host.invalidate()`（同其它结构操作，README 已有）。不另做 `host.setSize`、`host.update`：开发者的决定里没有，第 1 稿加的 `host.update` 与开发检查各自带出问题（API 审查第 8、9 条），不做。
- 输出：新增条目 154；失败 5 的码表加 `wrong-sizing` 与两种新参数形状；失败 6（提交的返回）原样转交不变。

### 四、文档写明的已知限制（不改行为）

`src/grid.md` 加一节“结构操作的已知限制”（审查的设计第 1、2、5、12 条，API 第 1 到 5 条）：

- 删到只剩一个孩子的分支被它的孩子替换（展平）：分支的 id 没了，留下的节点只拿到分支的 `size`，分支的 `sizing`、约束、收起策略丢掉。宿主要一组栏常在（例如一列可增删的面板），就保留至少两个孩子，或从自己的记录重建网格（工作台的做法）。
- `splitLeaf` 的新分支是按比例分的、没有约束；拆保留像素的叶，新分支不再保留像素，目标叶落进新方向。要在保留像素的一栏里加一块，先建好分支（建树或重建），不要拆那块叶。
- 只有保留像素兄弟的分支：增删之后放不下或有空，布局按已有规则压缩或出 `unabsorbed-space`。
- `maximumSize` 的 0 是“上限 0”，不是不限：保留像素的叶只给主轴的意图时，交叉轴的 `maximumSize` 别写 0（README“约定”加一句，API 审查第 10 条）。

## 测试

- `src/grid.test.ts`：
  - 插进、拿走保留像素与按比例分的叶，兄弟的意图逐值不变（含收起中的兄弟）；按比例分的新叶省略意图时平分一份（两块各 1 插第三块，三块 1、1、1，呈现三等分；有收起的、有 0 意图的兄弟不进平均）。
  - `moveLeaf`：按比例分的节点跨分支后取目标分支的平均份额；保留像素的节点跨同向分支意图不变；跨方向、新主轴没有意图时 `invalid-argument`（`size-missing`）且树不变。
  - `resize`：固定兄弟与收起中的兄弟意图不变；`applied` 按能分摊的算。
  - `setSize`：成功与 `changed: false`；收起中的节点同步 `restoreSize`，`setCollapsed(false)` 与 Enter 都回到新宽度；各失败码与参数形状。
  - 现有用例逐处核对：只是兄弟意图不再被改的，改断言；Task README 列出改了哪几条、旧值与新值。
- 失败码表的“码的写法逐码”测试（`grid.test.ts` 里已有）加 `wrong-sizing` 与新参数形状。
- Lab 与 e2e：结构操作的规则是纯 TS，由单测覆盖；Lab 的 `GridStructureScene` 只用按比例分的叶、只用 `splitLeaf`、`removeLeaf`、`moveLeaf`，新规则对它的呈现不变（审查第 13 条），回归跑 `lab-grid-structure.e2e.ts` 一遍确认。

## Spec 与文档改动

- `ui/nested-grid`：新增输出 153（增删移动与 `resize` 不压固定栏、份额规则、跨方向失败）、154（`setSize`），planned、实现后去掉；失败 5 的码表加 `wrong-sizing`，参数表加两种新形状。
- nb-layout：`src/grid.md`（意图的单位、结构操作不改兄弟、`moveLeaf` 的规则、`setSize`、已知限制一节）；README 的“我要做 X”表加“设一块保留像素的宽度”，“约定”加意图单位与 `maximumSize` 的 0。

## 切片

1. 一、二：增删移动与 `resize` 的规则，单测与现有用例核对；`grid.md`。
2. 三：`setSize` 与失败码，单测；README；已知限制一节。
3. 收口：`lab-grid-structure.e2e.ts` 回归、Spec 去掉 planned、Task README；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 153 | `grid.test.ts` |
| 输出 154 | `grid.test.ts` |
| 失败 5 的新码与参数 | `grid.test.ts` 的码表用例 |

## 不做与风险

- 不做：展平与拆分的行为（已知限制）；运行时改收起策略；`host.update`、开发检查；离开的内容（t53）。
- 风险：按比例分的兄弟不再被改，宿主照旧语义给新叶“像素量级”的意图时，新叶会拿到比以前大的份额。仓库里没有这样的调用方；`grid.md` 与 README 写清单位。

## 修订记录

- 第 2 稿（两份审查，重要共 16 条）：
  - 去掉展平与拆分继承尺寸规则（设计第 1、2、5 条，API 第 1 到 5 条：快照、分轴约束、收起策略的身份），改成“已知限制”写进 `grid.md`。
  - `moveLeaf`：按比例分的节点跨分支取目标分支的平均份额（设计第 3 条、API 第 6 条）；保留像素的节点跨方向缺意图时失败，不改成按比例分（设计第 4 条）。
  - `resize` 的候选同样不含固定与收起中的兄弟（设计第 9 条）。
  - 去掉 `host.update`、开发检查（设计第 7、8 条，API 第 8、9 条）与 `createGrid` 的缺意图核对（设计第 6 条、API 第 11 条）。
  - `setSize` 的细节：不夹约束、`restoreSize` 下限、返回值、码表形状、分支也可以（设计第 10 条、API 第 10 条）。
  - 平均份额的候选写成谓词：按比例分、没收起、意图为正（设计第 11 条）。
  - 只有保留像素兄弟的分支写进已知限制（设计第 12 条）；`maximumSize` 的 0 写进 README（API 第 10 条）。
  - 工作台投影里自己的展平（设计第 14 条）：不受本 Task 影响，不动。
