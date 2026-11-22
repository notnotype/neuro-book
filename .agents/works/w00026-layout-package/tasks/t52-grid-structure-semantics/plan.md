# t52 计划：nb-layout 结构操作不压固定栏、`setSize`（第 3 稿）

第 1 稿的设计审查（Claude Sonnet，重要 8、建议 6，[证据](evidences/design-review.txt)）与 API 形状审查（Claude Sonnet，重要 8、建议 5，[证据](evidences/api-review.txt)）的重要问题，大半落在第 1 稿自己加的“展平与拆分继承尺寸规则”上：继承来的属性进不了快照，约束分轴、整体替换会丢，拆分把收起策略搬走后宿主按叶 id 收起会失效。这些是库里本来就有的问题，不在开发者定的范围里，硬改牵出更多问题。第 2 稿收回到开发者的决定：原地增删不压固定栏、加设宽度的入口。第 3 稿按第 2 轮审查（设计与 API 合审，重要 4、建议 4，[证据](evidences/review-2.txt)）改细则，不再审，靠实现审查兜底。差别见末尾“修订记录”。

## Context

- **为什么做**：开发者 2026-11-22 定“原地增删不压固定栏、加设宽度的入口”（[t51 的“决定”](../t51-layout-api-gaps/README.md)）。
- **现状**（实测）：`addLeaf`、`removeLeaf`、`moveLeaf` 与 `resize` 经 `shiftSiblings`（`shareAxis`）把意图摊给全部兄弟：保留像素的兄弟被改（导航 188 变 150，再删也回不去）、收起中的兄弟被写成 0、按比例分的意图被当成像素夹进最小尺寸。
- **调用方**：结构操作与 `resize` 在仓库里只有 nb-layout 自己的测试与 Lab 的两个场景在用；工作台从布局文档重建网格，不受影响。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t52-grid-structure`（分支 `w00026/t52-grid-structure`）。只改 `packages/nb-layout/`。

## 关键设计：`src/grid.ts`

### 一、增删与移动不改兄弟的意图

- 意图按节点的 `sizing` 解释：保留像素的是像素；按比例分的是同一分支里按比例分的兄弟之间的相对份额。插进或拿走一块之后，份额自然按比例重分。
- `addLeaf`、`removeLeaf`：兄弟的意图一律不改（保留像素的、按比例分的、收起中的都不改）。
- `addLeaf` 的按比例分的新叶没给主轴意图（`size` 省略或主轴为 0）时：候选是这一支里所有不是保留像素的兄弟（收起中的也算，它的意图就是展开后的份额）；候选里有正意图的，取正意图的平均（平分一份）；候选非空但意图全是 0（叶输入缺省 0、全 0 均分是现有合同），新叶也取 0，保持均分；没有候选才取 1。给了就照用，单位同兄弟（`grid.md` 写明：要等分就别给）。
- `moveLeaf`：
  - 同分支重排：意图不变（同现在）。
  - 按比例分的节点移到别的分支：它的意图按“按比例分的新叶”重算（取目标分支的平均份额），不带着源分支的单位进来（API 审查第 6 条、设计审查第 3 条）。
  - 保留像素的节点移到别的分支：同向时意图照旧（像素）。移到方向不同的分支一律失败：保留像素的意图只对父分支主轴有意义，照约定交叉轴写 0，换方向后宽度没有来处（现在静默成 0 高）；也不悄悄改成按比例分（设计审查第 4 条：那样来回移动不可逆）。码 `invalid-argument`、`params: {field: "fixed-cross-axis", id}`，树不变；判在 `not-found`、`wrong-node-kind`、`into-own-subtree`、父节点检查、同分支重排之后，动树之前。出路写进 `grid.md`：`removeLeaf` 再 `addLeaf` 带新方向的意图（叶上的收起状态要宿主带过去）。
- 展平单孩子分支、`splitLeaf` 不改（审查发现的老问题写进 `grid.md` 的已知限制，见下）。
- 输出：`ui/nested-grid` 新增条目 153。

### 二、`resize` 拖保留像素的节点时不碰兄弟

- 被拖的是保留像素的节点：只改它自己的意图（夹在它自己的最小与最大之间），兄弟都不动，空间由布局里按比例分的兄弟吸收，没有就留白（同增删）。`applied` 是它自己实际变的量（第 2 轮第 3 条：只换候选集时，固定节点自己仍被压到下限、请求 +50 得 −38）。
- 被拖的是按比例分的节点：照旧（经 `shiftSiblings` 摊给兄弟、按像素夹）；写进已知限制：“`resize` 对按比例分的意图按像素夹，意图要取像素量级”，同步改 `grid.md` 里 `resize` 那段的说法。改成不夹像素的份额转移另立 Task。
- 现有 `resize` 用例（`grid.test.ts` 与 `useGridHost.dom.test.ts` 共 7 处）兄弟都是按比例分的，预计一个数都不变；新规则靠新用例钉住。
- 输出：并进条目 153。

### 三、`grid.setSize(id, px)`

- 只改这个保留像素节点沿父分支主轴的意图，兄弟不动；不读布局。值夹进它自己在这根轴上的最小与最大（不看收起时的刚性范围），同 `resize`、`resizeBranch` 写保留像素意图的做法，免得越界的值经收起抄进 `restoreSize`（第 2 轮第 8 条）。
- 收起中的节点：意图照样改（收起不写意图，展开时 `setCollapsed(false)` 按意图排），同时把 `collapse.restoreSize` 改成 `max(collapsedSize, 夹过的值)`，展开与分隔条上的 Enter 回到同一个宽度。
- 返回 `{ok: true, changed, size}`：`size` 是存下的意图（夹过的值），宿主拿它存偏好；`changed` 是意图或 `restoreSize` 有没有变（两者都进宿主要存的状态）；有收起策略时另带 `collapse`（与 `setCollapsed` 的结果同形）。类型 `GridSetSizeResult`。
- 检查的先后：`not-found`、根节点、`wrong-sizing`、`not-finite`、`px-negative`（先判目标，再判值）。
- 失败：
  - `not-found`；
  - 根节点：`invalid-argument`（`field: "root"`，已有形状）；
  - 按比例分的节点：新码 `wrong-sizing`，`params: {id, expected: "fixed"}`（码集合开放，ADR 0054 第 4 条）；公开类型 `GridFailureCode` 与 `grid-failure.ts` 的映射一起加；
  - 非有限：`not-finite`，`params: {field: "px", id}`；
  - 负数：`invalid-argument`，`params: {field: "px-negative", id}`。
  - 新形状都用没用过的 `field` 名（第 2 轮第 4 条：码的参数是按 `field` 判别的联合，同 `field` 两种形状判别不了）；连同 `moveLeaf` 的 `fixed-cross-axis`，新形状共三种，Spec 失败 5 的码表逐行改。
- 轴是父分支的主轴（竖向分支里设的是高度），文档写明；分支也可以（保留像素的分支同样有意图）。
- `grid.md` 写三个改意图入口怎么选：拖动与键盘由 `useGridHost` 经 `resizeBranches` 提交；宿主要把一块保留像素的设成已知宽度（偏好、菜单）用 `setSize`；`resize` 是按增量改的旧入口，注释里“新消费者应优先使用 `resizeBranches`”不改。`find(id).size` 读到的是意图，不是呈现。
- 用 `useGridHost` 的宿主调完要 `host.invalidate()`（同其它结构操作，README 已有）。不另做 `host.setSize`、`host.update`：开发者的决定里没有，第 1 稿加的 `host.update` 与开发检查各自带出问题（API 审查第 8、9 条），不做。
- 输出：新增条目 154；失败 5 的码表加 `wrong-sizing` 与三种新参数形状；失败 6（提交的返回）原样转交不变。

### 四、文档写明的已知限制（不改行为）

`src/grid.md` 加一节“结构操作的已知限制”（审查的设计第 1、2、5、12 条，API 第 1 到 5 条）：

- 展平：`removeLeaf` 删到只剩一个孩子、或跨分支 `moveLeaf` 把来源分支移到只剩一个孩子时，分支被它的孩子替换：分支的 id 没了（`find` 得 `null`），留下的节点只拿到分支的 `size`，按它自己的 `sizing` 重新解释这个数（例如保留像素 240 的分支里剩下一块按比例分的叶，它变成份额 240，按兄弟的份额重分，不再是 240 像素），分支的约束、收起策略丢掉。宿主要一组栏常在（例如一列可增删的面板），就保留至少两个孩子，或从自己的记录重建网格（工作台的做法）。
- `splitLeaf` 的新分支是按比例分的、没有约束；拆保留像素的叶，新分支不再保留像素，目标叶仍是保留像素、落进新方向（实测：1200 宽、188 宽的导航竖着拆，导航呈现 207×1、新叶 207×600，没有诊断）。要在保留像素的一栏里加一块，先建好分支（建树或重建），不要拆那块叶。拆保留像素的叶要不要直接失败（`wrong-sizing`），交开发者定。
- 一个分支里没有可吸收空间的按比例分兄弟（只有保留像素的，或按比例分的全收起了）：增删之后有空就留白，诊断 `unabsorbed-space`；放不下就按已有规则压缩。
- `resize` 拖按比例分的节点：按像素夹，意图要取像素量级（见第二节）。
- `maximumSize` 的 0 是“上限 0”，不是不限，平时就生效（不只是结构操作）：保留像素的叶只给主轴的意图时，交叉轴的 `maximumSize` 写 `Infinity`，不写 0（README“约定”加一句可复制的写法；nb-story 的 `book-grid.ts` 现在写的是 0，t45 改，API 审查第 10 条）。

## 测试

- `src/grid.test.ts`：
  - 插进、拿走保留像素与按比例分的叶，兄弟的意图逐值不变（含收起中的兄弟）；按比例分的新叶省略意图时平分一份（两块各 1 插第三块，呈现三等分；三块全 0 插第四块，呈现四等分；兄弟全收起时新叶取它们的平均，展开后不被压扁）。
  - `moveLeaf`：按比例分的节点跨分支后取目标分支的平均份额；保留像素的节点跨同向分支意图不变；保留像素的节点跨方向时 `invalid-argument`（`fixed-cross-axis`）且树不变；父节点不存在时报 `not-found` 而不是它。
  - `resize`：拖保留像素的节点只改它自己（导航 188 拖 +50 得 238，兄弟不变）；拖按比例分的节点照旧。
  - `setSize`：成功、越界被夹（返回夹过的 `size`）与 `changed: false`；收起中的节点同步 `restoreSize`，`setCollapsed(false)` 与 Enter 都回到新宽度；值小于 `collapsedSize` 时 `restoreSize` 取 `collapsedSize`；对保留像素的分支；各失败码、参数形状与检查先后（按比例分的节点给 `NaN` 得 `wrong-sizing`）。
  - `moveLeaf` 跨分支同向移动保留像素的节点：意图逐值不变。
  - 现有用例：结构用例都在纯按比例分的树上，`resize` 用例的兄弟也都是按比例分的，预计一个数都不变（`grid.test.ts` 删叶后的 285.71、714.29，展平的 beta 400 手算不变）；有变的在 Task README 列出旧值与新值。
- 失败码表的“码的写法逐码”测试（`grid.test.ts` 里已有）加 `wrong-sizing` 与新参数形状。
- Lab 与 e2e：结构操作的规则是纯 TS，由单测覆盖；Lab 的 `GridStructureScene` 只用按比例分的叶、只用 `splitLeaf`、`removeLeaf`、`moveLeaf`，新规则对它的呈现不变（审查第 13 条），回归跑 `lab-grid-structure.e2e.ts` 一遍确认。

## Spec 与文档改动

- `ui/nested-grid`：新增输出 153（增删移动与 `resize` 不压固定栏、份额规则、跨方向失败）、154（`setSize`），planned、实现后去掉；失败 5 的码表加 `wrong-sizing`，参数表加三种新形状。
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
- 风险：按比例分的兄弟不再被改，新叶的份额取决于它与兄弟意图的比值（例如兄弟 600、新叶给 400，得 40%），不再是“拿到它要的像素”（第 2 轮第 7 条实测：以前 674.7，现在 404.8）。仓库里没有这样的调用方；`grid.md` 与 README 写清单位。

## 修订记录

- 第 2 稿（两份审查，重要共 16 条）：
  - 去掉展平与拆分继承尺寸规则（设计第 1、2、5 条，API 第 1 到 5 条：快照、分轴约束、收起策略的身份），改成“已知限制”写进 `grid.md`。
  - `moveLeaf`：按比例分的节点跨分支取目标分支的平均份额（设计第 3 条、API 第 6 条）；保留像素的节点跨方向缺意图时失败，不改成按比例分（设计第 4 条）。
  - `resize` 的候选同样不含固定与收起中的兄弟（设计第 9 条）。
  - 去掉 `host.update`、开发检查（设计第 7、8 条，API 第 8、9 条）与 `createGrid` 的缺意图核对（设计第 6 条、API 第 11 条）。
  - `setSize` 的细节：不夹约束、`restoreSize` 下限、返回值、码表形状、分支也可以（设计第 10 条、API 第 10 条）。
  - 平均份额的候选写成谓词（设计第 11 条；第 3 稿改了谓词）。
  - 只有保留像素兄弟的分支写进已知限制（设计第 12 条）；`maximumSize` 的 0 写进 README（API 第 10 条）。
  - 工作台投影里自己的展平（设计第 14 条）：不受本 Task 影响，不动。
- 第 3 稿（第 2 轮审查，重要 4、建议 4）：
  - 第 1、2 条：平均份额的候选是所有不是保留像素的兄弟（收起的也算）；全 0 时新叶取 0；没有候选才取 1。
  - 第 3 条：`resize` 拖保留像素的节点只改它自己；按比例分的照旧，写进已知限制。
  - 第 4 条：新参数形状用新的 `field` 名（`px`、`px-negative`、`fixed-cross-axis`），`GridFailureCode` 加 `wrong-sizing`。
  - 第 5 条：保留像素的节点不能移到方向不同的分支（失败），写明出路与判定的先后。
  - 第 6 条：已知限制补症状与实测数、跨分支 `moveLeaf` 也会展平、`maximumSize` 写 `Infinity`；“拆保留像素的叶要不要失败”交开发者。
  - 第 7 条：风险条改正方向。第 1 轮没采纳的写明理由：API 第 7 条（`addLeaf` 收 `ratio`）—— 省略意图取平均已覆盖“等分”这个常见情形，仓库里没有要自定份额的调用方，加一个参数要再定它与 `size` 的关系；自定份额按兄弟意图的单位给，写进 `grid.md`，有调用方要时另立 Task。API 第 12 条（`resize` 按像素夹）—— 见第 3 条，写进已知限制。设计第 13 条、API 第 13 条（测试）—— 测试一节已补，本 Task 删掉的机制（展平继承、`host.update`、开发检查）的用例不再需要。
  - 第 8 条：`setSize` 夹进自己的约束、返回存下的 `size`、`changed` 含 `restoreSize`、检查先后、三个入口怎么选，见第三节。
