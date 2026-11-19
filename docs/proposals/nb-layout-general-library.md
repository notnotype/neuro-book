---
schema: nbook.proposal/v1
status: accepted
created: 2026-11-18
decided: 2026-11-18
supersedes: []
superseded-by: null
specs:
  - docs/specs/ui/nested-grid.md
  - docs/specs/ui/layout-drag.md
  - docs/specs/ui/workbench-layout.md
  - docs/specs/theme/system.md
adrs:
  - docs/adr/0054-nb-layout-general-library.md
---

# nb-layout 做成能发到 npm 的通用布局库

## 问题

[ADR 0044](../adr/0044-workbench-single-layout-tree.md) 第 6 条把布局工具收进 `@notnotype/nb-layout`，当时的理由是“统一用一套库、Splitter 不留两份”，没有写要给别的项目用。开发者 2026-11-16 定：nb-layout 应该是可以复用的通用布局工具，后面可以发到 npm，别的项目依赖它。目前没有点名的外部使用方；2026-11-18 开发者定第一个是 nb-story。

w00026 t26 让一个审查者以第三方身份，只用公开入口写了一份接入草稿（[`deep-review-api.txt`](../../.agents/works/w00026-layout-package/tasks/t26-layout-deep-review/evidences/deep-review-api.txt)，14 条）。t31 的实际体验审查又让一个审查者照本提案的草稿写了一个小编辑器布局（[`experience-review.txt`](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/experience-review.txt)，21 条）。现在第三方会碰到这些门槛：

- **包里一半是工作台的领域模型**：
  - 布局文档、投影、落点规则（`layout-doc.ts`、`layout-project.ts`、`layout-drop.ts`、`presented-ids.ts`，约 2300 行）硬要求活动栏与状态栏、三个区域名、视图容器与入口条；
  - 它们今天还在 `.` 入口里 `export *`；
  - 第三方用不上，又跟着它们一起升版本。
- **拖动控制器在应用里**：`layout-drag.ts`、`live-drag.ts`、`entry-drop.ts` 合计约 1800 行。库只给落点几何与拖动会话，第三方要自己写这一层。
- **失败有四种形状，都没有码**：
  - 网格层 `grid.ts` 有 35 处 `{ok: false, reason}`，`reason` 是带参数的中文自由文本；
  - 文档层 `LayoutResult` 只有 3 个码，覆盖 45 处 `rejected`，`detail` 是中文；
  - `GridLayoutResult.issues` 是中文字符串数组，`GridRestoreResult.dropped` 是 `{ref, reason}[]`；
  - 宿主与 `NestedGrid` 之间的 `onGestureCommit` 返回 `{ok: false, reason: string}`；
  - `issues` 事件发的是累计列表。
- **入口太宽**：两个入口约 132 个运行时导出，62 个没有任何使用方，多是求解器内部件；没有机器检查守住公开面。
- **样式靠 nb-ui**：
  - Vue 层有 4 个文件导入 nb-ui：文案端口、层级常数、菜单与标签条用的组合函数；
  - scoped CSS 读约 45 个 CSS 变量，其中 18 个是 nb-ui 登记、`theme/system.md` 写成主题合同的角色变量，另有 motion 令牌；
  - 不装 nb-ui，过渡与分隔线就不对。
- **没有发布路径**：
  - nb-layout 不在发布清单里，[ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md) 决定 6 把“其它包需要发布时另作决定”留着，包里的 `publishConfig`、`engines.bun` 是抄模板的，不是决定；
  - 照现有清单发只会发源码：`.vue` 与 `.ts` 要使用者的构建工具来转译，使用者的类型检查还会去查 `node_modules` 里的 `.ts`；
  - 包的 `package.json` 没有 `"private": true`。
- **许可证是 AGPL-3.0-only**（nb-layout 与 nb-ui 都是）：第三方要依赖它，先得接受 AGPL。
- **没有起步材料**：README 只有 8 行、没有能跑的例子、链接是仓库相对路径；说明文档满篇“输出 N”，指向包里没有的 Spec；公开的收起与展开没有入口，只有要自己算基线与守恒的 `resizeBranches`；手势接纳要同时配 contextKey、revision、extent、`onGestureCommit` 四件，写错一件的表现是拖不动、没有任何报错。

## 目标与非目标

目标：

- 第三方只用公开入口，就能在 Vue 3 里搭出 VS Code 手感的嵌套网格与分隔条：
  - 按矩形摆放，不搬 DOM；
  - 两轴约束求解，收起与吸附；
  - 拖动会话与落点几何，过渡与交换；
  - 键盘可达。

  这是库的定位，README 第一句就写清，并写明“不是现成的标签停靠布局”，免得被拿去和 dockview 比。
- 工作台的行为不变，已存的布局记录格式不变。
- 公开面有机器检查：
  - 第一档：导出名清单、层与层之间的依赖规则；
  - 第二档：由类型声明汇出的 API 报告。
- nb-story、开发者面板与工作台共用同一套 Splitter：[t14](../../.agents/works/w00026-layout-package/tasks/t14-splitter-migration/README.md) 删掉 nb-ui 里冻结的那份。
- 第一个外部使用方是 nb-story（开发者 2026-11-18 定，到时候可以改造它）：第二档里它用 NestedGrid 与拖动这些公开面，形状由它校验。

非目标：

- **不做 dockview 那种开箱即用的停靠式标签布局**，即通用的布局文档，加上现成的“标签拖到边缘拆分”的适配层。至少等到出现第二个形状不同的使用方，看过两个形状再抽。
  - 这是选择的代价，量过：体验审查里第三方照公开接口写一个“两三个编组、拆分、拖动”的玩具，自己写了约 440 行（面板模型与操作约 120、落点规则 37、标签条 28、拖动适配 79、落点指示的插入线与半区几何约 55、应用层约 90，再加类型与零碎约 30），手感引擎本身还没算在内。想要现成标签停靠的第三方，今天与发布之后都比 dockview 难接入。
  - 缓解有两条：README 与第二档的示例；第二档 nb-story 的改造让这个形状被校验一次。
- 不做 React 等别的框架的包装。
- **第一档不做**（第二档，见“第二档：只为发布才做的”）：编译产物流水线、API 报告 CI、`@stable`/`@experimental` 全量标注、手感编排进库、默认英文文案。
- 接入体验审查里要新能力、先不做的（等 nb-story 改造或有人要时再看）：
  - 快照存约束（`minimumSize`、`sizing`、`collapse`）与 `grid.clone()`（体验 7）；
  - `splitLeaf` 同向时并入父分支、`normalize()`、拆固定叶不丢 fixed（体验 9）；
  - 方向焦点 `moveGridFocus(from, "left" | "right" | "up" | "down")`（体验 13）；
  - `GridRect` 与 `GridDropRect` 互转（体验 14）；
  - `NestedGrid` 做成泛型组件，叶插槽里 `node.ref` 带具体类型（体验 12）；
  - `createDragSession` 默认的“交互元素不起拖”过滤，与拖影（体验 18、19）；
  - 读取失败时保留原件的 `restoreOrKeep`（体验 8，第一档只在 README 写推荐流程）。
- 发布时机由开发者决定，本提案不排。

## 当前行为与证据

| 部分 | 文件 | 规模 | 与领域有关吗 | 使用方 |
|---|---|---|---|---|
| 网格、求解、快照、过渡与交换、分隔线拖动与命中、拖动手势状态机、落点几何、排序、实时布局的候选判定 | `src/grid*.ts`、`sash-*.ts`、`drag-gesture.ts`、`grid-drop.ts`、`sortable.ts`、`live-drop.ts` | 约 4500 行（不含测试） | 无；L0 没有导入 L2 文件（审查核过） | 工作台、Lab |
| Vue 适配与组件：`NestedGrid`、`Splitter`、`SashHandle`、组合函数、拖动会话、落点登记、`SortableList`、浮动窗手柄、落点反馈 | `src/vue/` | 58 个文件 | 不全是无关：3 个组件与标签条几何带着 L2 的概念（见“L1 里带 L2 概念的文件”） | 工作台、Lab |
| 布局文档、投影、落点规则 | `layout-doc.ts`、`layout-project.ts`、`layout-drop.ts`、`presented-ids.ts` | 约 2300 行 | 工作台的条、区域、容器、入口条 | 工作台、编辑器插件、SDK 类型 |
| 拖动控制器 | 应用的 `layout-drag.ts`、`live-drag.ts`、`entry-drop.ts`、`drag-presentation.ts` | 约 1800 行 | 真耦合比最初估计的深：`live-drag.ts`（381 行）除落点类型外还直接读落点内部、用三个领域函数；`layout-drag.ts`（1130 行）的“可抽”编排大多绑着工作台的形状 | 工作台 |

证据：

- 独立设计（只拿到目标、没看主会话的方案）：[`independent-design.txt`](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/independent-design.txt)。它在布局文档与发布物上的结论与本稿一致；在拖动控制器上它的结论是留在应用，开发者 2026-11-18 改为分两步，见“手感引擎分两步”。本稿的备选 A 是主会话在看它之前写下的要点：[`main-outline.txt`](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/main-outline.txt)。
- t31 的三份审查：[常规设计审查](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/design-review.txt)（12 条）、[拉远看](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/zoomout-review.txt)（7 条）、[实际体验](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/experience-review.txt)（21 条）。本稿按它们与开发者 2026-11-18 的决定修订。
- 审查报告里“凭记忆”的结论（构建工具的行为、外部库的现状）在本稿里一律标“凭记忆、实施前核实”。

## 方案

### 推荐：分两档。第一档现在做，第二档等外部使用方出现再做

**分档的理由**：开发者 2026-11-18 定，“先做现在就做的”。第一档在仓库里本来就有收益，也不依赖发布；第二档只为发布而做，现在没有使用方校验形状，做早了就是承诺一批没验证过的接口。

**第一档，现在就做**：

1. 拆出工作台层，成为新的 L2 包（“分层与新包”）；
2. 统一错误形状（“错误与诊断”）；
3. 去掉 nb-ui 依赖，含 CSS 变量迁移（“去掉 nb-ui 依赖”“CSS 变量迁移”）；
4. 入口改显式清单加导出名测试（“公开入口”）；
5. `useDragSession`、`useGridHost` 与几处小入口、起步材料（“库里补的小东西”）；
6. 整理拖动控制器，把纯的部分抽进库（“手感引擎分两步”的第一步）；
7. t14：nb-story、开发者面板迁到 nb-layout 的 Splitter。

**第二档，以后做**：

1. 编译产物流水线与发布脚本接入（“第二档：发布流水线”）；
2. API 报告 CI；
3. `@stable`/`@experimental` 全量标注；
4. 手感编排进库（“手感引擎分两步”的第二步）；
5. 默认英文文案；
6. 官方示例应用。

**何时触发第二档**：把 nb-story 改造成用 nb-layout 的 NestedGrid、拖动这些公开面的时候，由它校验形状。t14 只用 Splitter，校验不了 NestedGrid 与拖动，所以不算这个第二个使用方。第二档里“默认英文文案”以外的项目，也都在那时按 nb-story 的需要定形状，不在现在预设。

#### 分层与新包

**分三层，依赖只能向下**：

- **L0 `@notnotype/nb-layout`**：纯 TS，不依赖 Vue 与 DOM。即上表的第一行，加下沉进来的纯矩形运算（见下）。
- **L1 `@notnotype/nb-layout/vue`**：Vue 适配与组件，即上表第二行除标签条以外的部分。
- **L2 `@notnotype/nb-workbench-layout`**：新的工作区包，`private`，不发布。
  - 内容：布局文档、投影、落点规则、`presented-ids`、夹具、`TabStrip` 与标签条几何，以及拖动控制器的工作台适配层。
  - **为什么另起一个包，有两条硬理由**：
    - 许可证：nb-layout 发 MIT，工作台层是 AGPL 仓库里的领域代码，不放进 MIT 的包。一个目录里放两种许可证，比分成两个包难管。
    - 依赖方向由包边界守住：L0、L1 不可能导入 L2，因为包的依赖里根本没有它。
  - 分界判据写进包说明：文件里出现活动栏、状态栏、区域名、容器、编辑组这些词的，属于 L2。
  - `boundary.test.ts` 守住依赖规则：L0 只导入 L0；L1 只导入 `vue`、`tabbable` 与 L0；L2 只经公开入口导入 L0、L1。第二档发编译产物时，对产物的导入图再测一次。
- 新包要登记的地方：根 `package.json` 的 `workspaces`、应用对它的依赖、`docs/modules/monorepo-boundaries.md` 的布局工具一行、`scripts/ci/check-documentation.ts` 的 `COMPONENT_BARRELS`（`TabStrip` 的 `.md` 换入口）、Lab 的 `component-index.ts` 与 `plugins/lab/web/fixtures/nb-layout/` 里按 L2 概念写的夹具、根 README 的包表与 `docs/` 里现有的包数。
- nb-layout 的 `package.json` 现在没有 `"private": true`。拆包时先加上：发布路径建好之前，从包目录直接发出去的是源码。

**L1 里带 L2 概念的文件，逐个列出去向**（L1 的依赖规则今天就过不了，下面是让它过得了的清单）：

| 文件 | 带着什么 | 去向 |
|---|---|---|
| `DropSectorsOverlay.vue` | 导入 L2 的 `LayoutDropSector`、`LayoutDropSectorId`，组件只读其中的 `id` 与 `points` | 改成泛型：`sectors: {id: string; points}[]`、`active: string \| null`、`labels: Record<string, string>`，留 L1 |
| `FloatWindowHandles.vue` | 导入 `layout-doc.ts` 里的 `resizeFloatRect`、`LayoutFloatResize`，其实是纯矩形运算 | 这两个下沉到 L0（`grid-rects.ts`，与 `GridFloatInput` 放一起），组件留 L1 |
| `DropFeedbackOverlay.vue` | `DropFeedbackPreview.entryRect` 与 `data-drop-feedback-entry` 元素，是活动栏的概念 | `entryRect` 改成可选并标明由宿主扩展，元素留 L1；工作台的入口条反馈由 L2 经插槽或 `entryRect` 给 |
| `TabStrip.vue`、`tab-strip-geometry.ts`、`TabStripItem` 等类型 | `tab-strip-geometry.ts` 的头注释写明只认 `TabStrip` 写的 `data-tab-row`、`data-panel-tab`、`data-tab-partition`。组件与几何读取器必须同进同出 | **两者一起进 L2**。手感引擎第一步不需要标签条排序进库，所以几何读取器不必留在 L1；第二步编排进库时，标签条排序跟着引擎的接口一起设计（“手感引擎分两步”） |
| `DropSectorsOverlay.dom.test.ts` | 用 L2 的 `layout-doc-fixtures` | 换成 L1 自己的夹具 |
| `DropFeedbackOverlay.dom.test.ts`、`lab-sources.ts` 等其余 L1 测试与场景 | 同上，用到 L2 夹具的 | 逐个检查，用到 L2 概念的换夹具或随组件搬 |

`TabStrip` 用 nb-ui 的菜单与标签自适应、`moveRoving`、`rovingMove`：进 L2 之后继续用 nb-ui，不需要在 L1 重写（这也让 MIT 的库不必从 AGPL 的 nb-ui 复制代码）。

**导出清单的去向**（家族级，逐个符号的清单由脚本从 L2 文件的实际导入里抽，作为显式清单的基线）：

| 家族 | 去向 |
|---|---|
| 网格、求解、快照、手势、落点几何、`sash-*`、`sortable`、`live-drop`、`createSplitterSession` | 留 L0 |
| 布局文档、投影、落点规则、`presented-ids`、夹具 | 搬 L2；原来 `.` 入口里的 `export *` 全部去掉 |
| `NestedGrid`、`Splitter`、`SortableList`、`DropIndicator*`、`DropSectorsOverlay`、`DropFeedbackOverlay`、`FloatWindowHandles`、`createDragSession`、`registerDropTarget`、`dropTargetAt`、`useDropTarget`、`moveGridFocus`、`layoutMotionMs`、`useGridLayout`、`useLayoutExtent`、`useSashGesture` | 留 L1 |
| `TabStrip`、`tab-strip-geometry` 的 5 个函数、`TabStripItem`、`TabStripHeld` 等类型 | 搬 L2 |
| `placeGrid` 及布局矩形 `GridPlacement`、`GridLeafPlacement` 一类类型 | L2 的 `layout-drop.ts` 要用，今天不在 `.` 入口里：进公开面，受版本承诺约束，从“62 个无人使用”的清点里剔出来 |
| 求解器内部件 | 留在文件里，库内测试用相对路径导入；若 L2 也要用，按上一行处理，不走相对路径 |

**布局文档搬出，不做成参数**：

- 理由：
  - 要参数化的是条、区域、“必须有编辑组”、容器与入口条，这些概念近两周还在加；
  - 只有一个使用方，抽出来的形状没有第二个例子校验，发布之后又受版本承诺约束，改不动。
- 退出条件：出现第二个真实使用方、形状不同时，再从两个形状里抽公共部分，看哪些提回 L0、哪些做成参数（即备选 A）。
- L2 用到的 L0 名字，就是 L0 的扩展面：`GridSnapshot`、`createGrid`、`placeGrid`、上限常数等。显式清单的基线就是这份实际导入清单。

**L0 的快照格式与 L2 持久化绑在一起**：布局记录里的 `tree` 就是 L0 的 `GridSnapshot`，带 `GRID_SNAPSHOT_VERSION`。规则：L0 快照格式的破坏性变化，必须同时给 L2 的 `LAYOUT_DOC_VERSION` 写迁移，0.x 期间也一样，不等到 1.0。当前 v1 快照是整体拒绝（`nested-grid` 失败 2），不是兼容读取。

#### 手感引擎分两步

开发者 2026-11-18 的决定。三份审查指出，手感引擎进库的真实耦合比“三处依赖”深：

- `live-drag.ts` 除了落点类型，还直接读落点内部（`candidateOf` 读 `drop.preview.areaRect` 判“长出新面板”，`keyOf` 读 `drop.inPlace`、`drop.part`），用三个领域函数（`dropStripOf`、`homeStripOf`、`workbenchDropKey`）；
- `layout-drag.ts` 的“来源收起后重判”“冻结几何”“指针不动不重判”“空位粘住”，实质内容都用工作台的树、入口条、编辑器拒绝的形状；
- 泛化后的接口约 25 个回调、4 个以上类型参数，带“读写 DOM 的先后”之类时序要求；`wakeLive` 的 `pointermove` 监听要排在会话按下时挂的监听前面，这条跨包的时序合同今天只靠调用顺序成立；
- 整理本身没做：t26 的 design-09（每场状态收进一个对象、拆文件）、design-10（没有单元测试，只有 929 行与 1349 行的 e2e）都还欠着。

所以分两步，第二步等第二个宿主：

- **第一步，第一档做**：
  - 在应用里按 t26 的 design-09、design-10 整理拖动控制器：每场拖动的状态收进一个对象，判定拆成纯函数，补单元测试；
  - 只把纯的部分抽进库：卡片的缩放与追赶（例如 `stepCard`）、帧调度（含按住不动时停下帧循环）；`live-drop.ts`（候选稳定才换预览）本来就在 L0；
  - 一并把“卡片位置的换算”（`GridRect` 与视口坐标）放进抽出来的部分，不让第三方每人写一遍（体验 14）。
- **第二步，第二档做**：编排部分（`stepPreview`、撕下来源、来源收起展开后按新布局重判、指针不动不重判、空位粘住）等有第二个宿主验证过，再提进库。
- **第二个宿主**是 Lab 里一个不是标签页的宿主（例如卡片面板互相拖动），或者官方示例应用（体验 20：第三方照公开接口写的那份“带标签的面板模型与落点规则”，几百行，等于一份第二个形状）。nb-story 的改造也能验证引擎要求宿主用 NestedGrid 的内容层、按预览出内容这条契约（体验 16）。
- 进库时的写法（第二档要做的事，现在只记要求）：
  - 先写出接口草案：每个回调的输入输出，谁持有预览，谁驱动 NestedGrid 的 `lifted`、`dragging`、`contents`、`placeLifted`，让审查者对一遍；
  - 引擎与会话同属一个对象，或由会话主动调引擎的 `wake`，不靠调用顺序碰巧成立；
  - 标签条排序（`placeSorted`、`heldTab`）与标签条几何一起设计；
  - 先标 `@experimental`，并写明在 1.0 之前它的公开签名会变。
- 验收：第一步整理完，工作台的手感不变，判据是 `workbench-live-drag`、`workbench-dnd` 两份 e2e 与相关 Lab 场景不变（e2e 受负载影响，对照基线）；新增的纯函数有单元测试。

#### 错误与诊断一种形状

- 失败：`{ok: false, code, message, params?}`。`message` 是库内的英文，只给日志看，不进程序分支；宿主按码写自己的界面文字。
- **码集合是开放的**：宿主必须有默认分支，新增码不算破坏，只在变更记录里写一行。
- 码按层定义，各是字符串字面量的联合：
  - **L0 先按 `grid.ts` 的 35 处逐处分类，再定数**。读源码得到约 11 类，候选名如下，实施时逐处核对：
    - `not-found`：未知节点、分支、父节点（8 处左右）；
    - `wrong-node-kind`：非叶子、非分支、根节点没有父分支；
    - `wrong-axis`：只能沿父分支主轴调整；
    - `not-finite`：调整量、手势尺寸、拆分比例不是有限数；
    - `limit-exceeded`：节点数、深度超上限；
    - `duplicate-id`：节点 id 已存在、新分支与新叶共用 id；
    - `into-own-subtree`：不能移动到自身子树；
    - `not-conserved`：手势目标不守恒；
    - `stale-baseline`：手势基线已失效、目标父节点已不存在；
    - `not-collapsible`：面板不可收起或不存在；
    - `invalid-argument`：手势尺寸没覆盖全部直接子节点、未知方向、未知插入侧。
  - 提案里原来的 `stale-context`、`stale-revision`、`handler-missing`、`handler-threw`、`out-of-bounds`，在代码与 Spec 里没有对应的失败，不预设；它们若是 `NestedGrid` 与宿主之间新出现的情形，在第二档做 NestedGrid 公开面时再定；
  - L2 把 45 处 `rejected` 归并成几个能区分原因的码，读完那 45 处再定。
- **失败形状的整体范围**，一起改：
  - `GridLayoutResult.issues`（求解器诊断）：改成 `{code, message}[]`。窄窗口压到最小值以下这种“每次布局都发”的诊断，合并成一条一个码（体验 10）；
  - `GridRestoreResult.dropped` 的 `reason` 改成码；
  - `onGestureCommit` 的返回类型 `{ok: false; reason: string}` 改成 `{ok: false; code; message}`：这是宿主与 `NestedGrid` 之间的回调合同，库自己的 `useGridLayout` 产出它、第三方自己写时也按它返回，属 L1 公开类型的破坏性变化，与 `reason` 到 `message` 同批改；
  - `NestedGrid.vue` 里写死的中文 `emit("issues", [...])` 一并改成英文 `message` 加码。
- `issues` 事件只发新增的。累计列表由宿主自己积累（开发者面板如今靠累计列表，改成自己存）；不加“最近 N 条的查询接口”（拉远看第 7 条）。
- **拖不动时报错**：开发模式下的配置错误各报一次，只做具体几条，不做通用机制：`sashSize` 为 0、没接 `onGestureCommit`、contextKey 两处对不上、revision 没转交给 `NestedGrid`（体验 11）。开发模式的判据在第一档里用库内的开关（宿主传入或模块级设置），不用 `import.meta.env.DEV`；它在库模式构建时会被静态替换，使用者永远读到生产值（凭记忆，第二档发产物时核实，见“已知的坑”）。
- 影响面（下面数字来自常规设计审查）：
  - 测试里按中文文案断言约 30 处：`grid.test.ts` 的 `reason` 10 处加 `issues` 7 处，`sash-drag.test.ts` 3、`grid-geometry.test.ts` 3、`splitter.dom.test.ts` 1、`useGridLayout.dom.test.ts` 3，L2 的 `layout-doc.test.ts` 约 1、`layout-drop.test.ts` 约 2。改成码，规则写死，有测试兜底；
  - 应用里构造 `LayoutResult` 失败的地方：`layout-doc-store.ts` 6 处、`state/containers.ts` 3、`entry-drop.ts` 1、`editor-panels.ts` 1、`WorkbenchSurfaceFixture.vue` 1；按码分支的只有 `layout-doc-store.ts`、`panel-commands.ts`、`view-commands.ts` 三个文件；`detail` 只进诊断日志，不显示给用户。

#### 公开入口

- 两个入口改成显式清单，不用 `export *`。
- 每个入口一个测试，拿导出名与提交进仓库的清单比对，新增导出必须改清单，评审时看得见。基线是上面“导出清单的去向”那份实际导入清单。
- 求解器内部件留在文件里，库内测试用相对路径导入。
- 改名：
  - 描述 `NestedGrid` 手势的 `Splitter*` 类型改成 `GridGesture*`；
  - `gesture-start` 的载荷起名并导出。
- 子路径：`.`、`./vue`、`./style.css`。`./lab-sources` 不进发布包。`./locales` 的去留跟着文案一节。
- 稳定性标注：第一档只对已有使用方的符号标注；全量 `@stable`/`@experimental` 是第二档。Spec 的成熟度只有 `planned` 与 `implemented`，`ui.nested-grid` 与 `ui.layout-drag` 现在是 `planned`：第二档标注时，先写一条映射规则（例如 Spec 实现后、有外部使用方的符号才标 `@stable`），或先晋升 Spec。

#### 去掉 nb-ui 依赖

- 层级常数改成 CSS 变量，在 `:root` 上声明默认值。`DropFeedbackOverlay`、`DropSectorsOverlay` 都 `<Teleport to="body">`，变量定义在组件根上取不到。层级在对话框、菜单之上还是之下，因此挪到了桥接样式里；`z-index.test.ts` 里的相对次序断言要和 nb-ui 的层级一起才能写，放在桥接样式所在的包。
- 4 个导入 nb-ui 的文件各自的去向：
  - `text.ts`：文案换成库自己注入的一组标签，见下；
  - `DropFeedbackOverlay.vue`、`DropSectorsOverlay.vue`：层级改变量；
  - `TabStrip.vue`：进 L2，继续用 nb-ui。
- 文案：
  - 14 个键（`LayoutTextKey`，其中有带参数的 `splitter.pixels`、`sortable.*`）换成库自己注入的一组标签，参数用占位的模板字符串，库不处理复数；
  - 第一档：只去掉对 nb-ui 文字端口的依赖，工作台用一个适配器接上 nb-ui 的端口，源语言与现有目录不变，`./locales` 子路径与 message-catalogs 检查照旧；
  - 第二档：默认英文，中文目录随 L2 的适配器走，不必成为库的公开子路径（拉远看第 7 条）；这时源语言从 `zh-CN` 变成 `en-US`，`message-catalogs` 的检查与 `docs/specs/ui/i18n.md` 的 `state:inject` 声明要跟着改。
- 结果：
  - `dependencies` 只剩 `tabbable`，`peerDependencies` 只剩 `vue`；
  - 不装 nb-ui 时默认外观可用，有一条测试扫描 Vue 层所有 `var(--`，要求是 `--nb-layout-*` 且带回退；
  - 再加一条机检，覆盖 import 这一路：用只有 `vue` 与 `tabbable` 的空项目类型检查 nb-layout 的公开入口，读进的 nb-ui 文件数为 0（体验 3）。

#### CSS 变量迁移

这一节单列，因为它动到主题合同，不是改个前缀。

- **旧名到新名**：Vue 层 `var(--` 共约 45 个不同名字。其中：
  - **18 个是主题角色变量**，在 nb-ui 的 `src/theme/tokens.ts` 登记，`docs/specs/theme/system.md`（变量体系第 2 层）写成主题可改的合同，`nbook` 主题的 `vars.css` 与作者文档也有：
    - `--sash-line-color`、`--sash-line-size`、`--sash-line-inset`、`--sash-line-radius`、`--sash-line-glow`；
    - `--drop-area-fill`、`--drop-area-border`；
    - `--layout-scrim`、`--layout-sector-fill`、`--layout-sector-line`、`--layout-sector-active-fill`、`--layout-sector-active-line`、`--layout-slot-border`、`--layout-slot-fill`、`--layout-merge-fill`、`--layout-merge-border`、`--layout-merge-border-width`、`--layout-card-radius`、`--layout-card-shadow`（19 个里去掉重名后以 `tokens.ts` 为准，实施时逐个核）；
  - **motion 令牌**：`--motion-layout`、`--ease-layout`，以及用到的 `--motion-fast`、`--motion-base`（`tokens.ts` 的 `nbMotionTokens`）；
  - 其余约 25 个是 nb-ui 的通用 token（面、文字、线、圆角等），库内改读 `--nb-layout-*` 命名空间，每处带回退值。
  - 实施时写出完整的旧名到新名对照表，随 Task 进主题文档。
- **承诺范围只到主题级的一小批**：颜色、间距、动画时长、层级这十几个进 README 的变量表，其余标内部、不进表（拉远看第 4 条）。
- **`:root` 默认值样式**：只靠每处 `var(--x, 回退)` 不够：
  - `layoutMotionMs`（`layout-motion.ts`）用 `getComputedStyle(...).getPropertyValue("--motion-layout")` 读毫秒数，宿主没给就按 0；`getPropertyValue` 读不到 `var(--x, 150ms)` 的回退值，只读得到变量本身；
  - 新变量只有回退值时，CSS 过渡按回退时长走，JS 读到空串当 0，“外壳放下后的收尾”提前结束、预览撤得过早；
  - 所以库带一份在 `:root` 上声明默认值的样式，含 `prefers-reduced-motion` 时把动效时长归零（今天由 nb-ui 令牌做）；过渡默认要是“有”，不是“没有”（体验 4）；
  - `layoutMotionMs` 改读新变量，并写一条单元测试：不加桥接、不设变量时，CSS 时长与 JS 读到的时长一致。
- **桥接样式放 nb-ui 的 `tokens.css`**，只写变量名，不导入 nb-layout：
  - 它把主题的旧名（`--sash-line-*`、`--layout-*` 等）映射到 `--nb-layout-*`，主题作者写的 `--layout-card-radius` 继续生效；
  - 理由：nb-story、开发者面板（t14 之后）也是宿主，它们不依赖 L2，也要有桥接；每个宿主一份，就是 ADR 0044 第 6 条想消灭的“Splitter 留两份”；nb-ui 本来就定义这些变量，只写名字不违反“nb-ui 不依赖 nb-layout”。
- **受影响的文件**：
  - nb-ui：`src/theme/tokens.ts` 的登记、`src/tokens.css`、`themes/nbook/vars.css`；
  - 文档：`docs/specs/theme/system.md`、主题作者文档（`authoring-themes.md`）、主题编辑器的变量列表；
  - e2e：有 6 个文件按旧名读样式：`workbench-dnd`、`workbench-live-drag`、`workbench-containers`、`editor-area`、`lab-grid-swap`、`markdown-editing`。改名时先搜 e2e 辅助函数，再开大范围运行；
  - 读 `layoutMotionMs` 的地方。

#### 库里补的小东西

第一档在库里补的，都是消掉第三方要手写的接线：

- `useDragSession(root, options)`：根出现时建会话，换根或作用域结束时销毁，返回稳定的引用。
- `useGridHost(options)`：把 `node`、`layout`、`revision`、`contextKey`、`onGestureCommit`、`disabled` 打成一包给 `NestedGrid`，`@extent` 回灌。
  - `NestedGrid` 自己量容器交给宿主，宿主不再另量一遍（t26 api-11）；
  - 它与 `useGridLayout`、`useLayoutExtent` 的关系（取代还是并存）、以及“宿主要先有尺寸才能算 layout、`NestedGrid` 又要 layout 才能渲染”的回灌顺序，在 Spec 里写明（体验 11）。
- 手势落账后、结构操作之前的意图回写（t26 api-03，今天宿主要手写的约 20 行），在 L2 提供 `applyGestureCommit`、`rebaseForOperation`。
- **收起与展开的入口**：库提供设置某个面板收起状态的入口，内部找兄弟吸收差额，第三方不必自己算基线与守恒（体验 5）。同时写明 `restoreSize` 由谁维护：推荐谁收起谁记，收起那一刻记下收起前的尺寸（体验 6）。形状在 Spec 里定。
- **README 是复制粘贴能跑的起步**（体验 1、2）：
  - 写成“五件事”的最小可运行例子（建树、量容器、算布局、接纳手势提交、结构变了通知），把 `NestedGrid.md` 的“接入”整段搬上来，加一张“我要做 X 用哪个导出”的表；
  - 第一句写定位与“不是现成的标签停靠布局”；
  - 写明几条目前只在源码里的约定：`restore` 可对 `createGrid(null)` 用（体验 7）；读取失败时保留原件、不拿默认布局覆盖的推荐流程，`dropped` 非空算失败（体验 8）；16 层深度上限对“拖拽拆分”的实际影响（体验 9）；窄窗口默认降级、`issues` 是什么、想不压缩就读根节点的 `constraints`（体验 10）；键盘一节写清叶里要有可聚焦元素、标签条内的左右键与 roving tabindex 是宿主的事（体验 13）；矩形与坐标的两种（体验 14）；自己画的反馈元素要带 `data-drag-feedback`、`sourceAt` 里要自己排除可交互元素（体验 18）；
  - 说明文档里不引“输出 N”，第三方需要的规则直接写进包里；语言第一档仍是中文，第二档随默认英文文案一起定（体验 2）；
  - `useGridLayout`、`useLayoutExtent`、`createDragSession` 各补一份短 `.md`；
  - 链接用 npm 上不会断的写法。

#### 第二档：发布流水线

第二档的发布脚本接入，现在只写清它怎么接、怎么保证一致、已知的坑。形状到 nb-story 改造时再定。

- **形式**：
  - L0、L1 用 Vite 的库模式出 ESM；类型声明由哪个工具出，在第二档的 Task 里选：仓库里 SDK 的构建已经有一套 `rolldown-plugin-dts`（`vue: true`）能出 `.vue` 的声明，不复用就要说明两条出声明的路径会不会各出一份不同的类型；
  - 组件样式出一份 `style.css`。没引样式时界面明显是坏的，不是静默出错；
  - 承诺的宿主是 Vue 3 加 Vite；Nuxt、webpack 没有实测，不承诺。
- **与发布脚本怎么接**（审查读脚本得出，实施前核实）：
  - nb-layout 今天不在 `RELEASE_PACKAGES`。放进 `BUILT_PACKAGES` 不行：这条通道默认“版本就是产品版本”（`release-plan.ts` 把产品包一律算 `release`，registry 上已有同版本且字节不同时报“先提高产品版本号”），而 nb-layout 的版本独立、手工管理。放进 `RELEASE_PACKAGES` 也不行：`checkReleasePackages` 对每个包写死 `license` 必须等于 `AGPL-3.0-only`、包内 `LICENSE` 必须与仓库根字节相同、`engines.bun` 必须存在、内部依赖写 `workspace:^`，这些对 MIT 的浏览器端 Vue 库全部报错；`prepare`、`release-notes` 按 `RELEASE_PACKAGES` 逐个包读 `CHANGELOG.md` 并检查“版本只升不降”，生成的是源码包；
  - 所以要加第三条通道：独立版本的生成包。要改的地方：`packages.ts`、`prepare`、`release-plan`、`release-notes`、`publish`、`pack-smoke`；许可证与 `engines` 检查改成按包配置；
  - 构建的可复现性：registry 上同版本字节不同时的处理要定。tar 与 `.d.ts` 往往不可复现，要么保证构建可复现，要么这条通道遇到同版本不同字节直接报错而不是要求提产品版本；
  - 变更记录：放 `packages/nb-layout/CHANGELOG.md`，照 [ADR 0053](../adr/0053-release-stages-and-changelog.md) 第 4 条，在这个包第一次提版时建，不进 npm 包；“次版本可以破坏，必须单列”写成变更记录里的“不兼容的改动”分类。
- **源码与发布目录两条路怎样保证一致**：仓库内（工作台、Lab、nb-story 与开发者面板）走源码，宿主的 Vite 编译 `.vue` 并内联 scoped CSS；第三方走产物与 `style.css`。组件的 DOM 测试与 Lab 的 e2e 全部跑在源码上，发布前的空项目冒烟只拖一次分隔线。至少做下面一项，由 Task 选：
  - nb-story 的网页构建改成消费编译产物：它本来就是第一个外部使用方，这样两条路每次构建都比一次；
  - DOM 测试里把导入别名切到产物再跑一遍；
  - 对 `style.css` 做快照：scoped 选择器数、关键类名。
  - 发布前冒烟扩成：用打好的包在一个空的 Vite 项目里只用公开入口写一个最小宿主，类型检查通过，浏览器里拖分隔线、拖一次卡片，覆盖键盘可达与过渡，不只一次分隔线。
- **已知的坑（全部凭记忆、实施前核实，先用一个原型构建确认）**：
  - Vite 库模式把 `import.meta.env.*` 在构建时静态替换，`process.env.NODE_ENV` 不替换（Vite 文档的说法）。“开发模式下配置错误各报一次”要定判据，用 `import.meta.env.DEV` 的话使用者永远读到生产值。nb-layout 现在没有任何开发与生产的判断；
  - 使用者手动 `import "…/style.css"` 的只有副作用的 CSS，会不会被打包器摇掉，取决于 `package.json` 的 `sideEffects`；多入口时共享 chunk 的划分；CSS 文件名由 `build.lib.cssFileName` 控制；
  - `vue-tsc --declaration` 对返回内联推断类型的组合函数可能报 TS2742 或 TS4023（无法命名类型）；本包约 14 个 `use*` 组合函数，要先跑一遍；
  - `boundary.test.ts` 只读源码导入；L0 入口产物不能带 `vue`，对产物的导入图再测一次：单一入口 chunk 共享时，纯 TS 入口也可能被拉进 Vue 代码；
  - API 报告用什么工具：`api-extractor` 对 Vue 组件的 props、emits、slots、expose 的覆盖要先核实；报告与导出名清单测试的分工、与 `@stable` 范围的对应关系，在第二档定；
  - 承诺的 `data-*` 表与 CSS 变量表今天在各组件的 `.md` 里，发布目录的 `files` 不含它们；README 生成或手写，并让 `docs:check` 核对。
- **本包的 ADR 措辞**：[ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md) 没有写 nb-layout 的发布决定，决定 6 留着“其它包需要发布时另作决定”，新 ADR 就是这个决定；ADR 0033 是先例，但它的先例是整个应用打成 bundle，依赖全部打进去，与“Vue 组件库的库模式构建、peer 外置”不是一回事，不能直接照搬。

#### MIT：要处理的事实

只列要处理的事实，不做法律判断。

- 许可证改成 MIT 对已发布的版本不可逆：发出去的版本永远是 MIT。
- `packages/nb-layout` 的提交历史只有一个作者（`git shortlog` 112 次，同一人）。
- 去掉 nb-ui 之后，会发布的运行时依赖只剩 `tabbable`（6.5.0，它的 `package.json` 写 MIT）；`vue` 是 peer；其余是 devDependencies，不进包。
- 要处理的：
  - 包内 `LICENSE` 换成 MIT 全文，`package.json` 的 `license` 改 `MIT`，README 写明与仓库根许可证不同；发布脚本里的 `RELEASE_LICENSE` 与“LICENSE 与根相同”检查按包区分（见发布流水线）；
  - **发布脚本会不会丢掉 MIT 声明**：`third-party-notices.ts` 把 `@notnotype/*` 一律不列（注释说“与发布包同一许可”），应用包与 SDK 包把 MIT 的 nb-layout 打进 AGPL 的 bundle 时，MIT 版权声明会被静默丢掉。SDK 的 `pack.ts` 把 nb-layout 的类型内联进 `.d.ts`，也走这个过滤。过滤要改成按包的许可判断；
  - 根 `README.md` 的许可证两处（徽章与第 101 行、第 159 到 161 行）写“采用 AGPL-3.0-only”，补一句例外；
  - **MIT 的包以后不从 AGPL 的代码搬内容**：写进 `packages/nb-layout/AGENTS.md`。反方向（AGPL 的代码用 MIT 的包）不受限；要从 AGPL 的包（nb-ui 等）复制进来的，必须逐文件复核。目前看到的只有 nb-ui 里冻结的 Splitter 与分隔线核心（t04 拆出，同一作者，t14 删），以及 `TabStrip` 用的 `moveRoving`、`rovingMove`、`DropdownMenu`、`useTabsAdapt`：`TabStrip` 进 L2 后这一项消失；
  - **Trellis 来历**：[ADR 0044](../adr/0044-workbench-single-layout-tree.md) 第 5 条写“Trellis 的许可证与 AGPL 不兼容（判断，不是法律意见），只借交互想法”。代码里 `live-drag.ts`、`layout-drag.ts` 各有一处“照 Trellis”的注释，`workbench-single-tree-layout.md` 还记了从 Trellis 采样的曲线 `1-(1-t)^5`、约 470ms。要核对没有逐字复制，在新 ADR 里写清“没有复制代码，只有行为参照”，并重读 ADR 0044 那句的理由对 MIT 是否仍然成立。控制器整理（第一步）时顺手核。
- 第二档发布时再核一次上面几项，发布前补进发布清单。

#### 对插件 SDK 的影响

[`packages/neuro-book/src/sdk/components.ts`](../../packages/neuro-book/src/sdk/components.ts) 已经从 `@notnotype/nb-layout` 与 `/vue` 重导出 `NestedGrid`、`Splitter`、`TabStrip`、`DropFeedback*`、`FloatWindowHandles`，以及 `SplitterGestureCancelReason` 等 4 个 `Splitter*` 类型。SDK 是发给第三方插件作者的公开 API（`@notnotype/nb-plugin-sdk`，已发）。所以：

- 改名与搬家对 SDK 是破坏性变化，处理：
  - `Splitter*` 改名为 `GridGesture*` 后，SDK 里保留 4 个旧名作别名，给一个弃用期（至少一个次版本，由 SDK 变更记录单列“不兼容的改动”，具体几个版本在第二档前后再定）；
  - `TabStrip` 与它的 props 类型由 SDK 从 L2 重导出，插件作者的导入名不变；
- `plugin-sdk/pack.ts` 的 `typePaths()` 要为 L2 加路径映射，否则 SDK 的 `.d.ts` 会引用一个不发布的私有包；`componentsDoc()` 按 `nb-layout/vue` 目录给组件分“布局”组，`TabStrip` 搬走后分组要改；
- SDK 导出的名字搬前搬后各导出一份清单，要求一致（含上一条的别名）。

#### 版本

- 手工管理，独立于产品版本，先发 `0.x`。
- 补丁版本不破坏；次版本可以破坏，但必须在变更记录里单列（位置见发布流水线）。
- 承诺范围：
  - 标 `@stable` 的符号（第二档标注后）；
  - README 里列出的主题级 CSS 变量表与 `data-*` 表；
  - 错误码集合开放，新增码不算破坏；
  - `GridSnapshot` 的兼容承诺只从 1.0 起：0.x 期间可以不兼容，但见上面“快照格式与 L2 持久化绑在一起”的规则，L2 要同批给迁移。

### 备选 A：布局文档做成通用的停靠模型，控制器一起进库

内容：

- 新入口 `./dock`：一份通用的停靠文档，含面板、标签、树、浮动窗、最大化、结构操作与落点规则。
- 骨架约束由宿主经策略对象给：固定的叶，例如今天的活动栏、状态栏；接受矩阵；哪些边能分；新 id 怎么给。
- 面板记录带宿主扩展字段（类型参数），操作原样复制、保存：工作台的 `container`、`entries`、`activeContainer` 放在这里，持久化的 JSON 形状不变。
- 在推荐方案的手感引擎之外，适配层也进 `./vue`：拿起、落点判定、提交都按通用停靠文档写好，宿主钩子接入口条这类额外落点。

好处：第三方拿到的接近 dockview 的整套能力，体验审查里那约 440 行就不必自己写。

不推荐：

- 只有一个使用方，扩展字段与钩子的形状没有第二个例子校验；
- 工作量是推荐方案的数倍；
- 发布后每次给工作台加概念，要么破坏，要么继续加参数。

出现第二个形状不同的使用方时，可以从推荐方案的 L2 往这条路走。

### 备选 B：单包，不新建包

两种做法，都不推荐：

- **B：单包加 `./workbench` 子路径，照旧发源码**：
  - `.`、`./vue` 只导出 L0、L1，`./workbench` 导出布局文档，并标“只给工作台，不承诺版本兼容”，照 ADR 0029 发源码；
  - 好处是最省事；
  - 不推荐：发布包仍带着约 2300 行无关代码，版本号被它推着走；“不承诺的子路径”只靠约定守住，一次深导入就破；源码发布的门槛没解决。
- **B′：单包，发布目录白名单**：
  - 不新建包，发编译产物，发布目录只放 L0、L1，工作台文件不进 dist；
  - 它解决了 B 的三条缺点：发布目录没有深导入的路径，发布物不含 2300 行，也不发源码；
  - 不推荐，因为新包有两条硬理由是它给不了的：
    - 许可证：一个目录里放 MIT 与 AGPL 两种许可证的文件，包的 `license` 字段、LICENSE 文件、发布脚本的许可检查都要按文件区分，比分成两个包难管；
    - 依赖方向：同一个包里 `boundary.test.ts` 也能守，但守的是约定，包边界守的是依赖里根本没有。
  - 提案原来写的“纯 TS、在 Bun 里能测”是 t04 当初的理由，当时在 nb-layout 里就满足了，不是新包的理由。
  - 代价要说清：新包意味着导入路径改约 56 个文件（见“影响”）、SDK 与插件作者可见的来源变化、包层面的 AGENTS.md、测试配置、工作区解析、Lab 的来源登记。

### 备选 C：换成现成的布局库

- ADR 0044 第 5 条拒绝 dockview 等库的理由，对工作台仍成立：停靠时搬 DOM，多行标签、固定标签、键盘导航是付费档；另外有入口条、实时布局、卡片形状与交换过渡这些要求。
- 对第三方，本库要回答的是“为什么不选 dockview”，所以定位写成上面那一句，不和它比停靠能力。真正近的近邻是 allotment（VS Code splitview 的移植，React）、splitpanes（Vue 的分隔窗格）、reka-ui 的 Splitter（nb-ui 已依赖它）；本库的真差异是按矩形摆放不搬 DOM、两轴约束求解、收起与吸附、过渡与交换，这些写进 README 与 ADR，并附 Lab 场景作证据。
- 外部库的现状（渲染选项、付费档、Vue 支持）全部凭记忆，没有核实：审查者记得 dockview core 是 MIT、无依赖、另有按框架拆开的 Vue 与 React 包，与“付费档”的说法可能不符。第二档开工前花一轮核实 dockview、splitpanes、reka-ui、allotment 的现状（官方文档与仓库），换成有出处的结论，免得 README 或 ADR 里留着一句可能已经不对的话。

## 影响

- **数据**：布局记录的格式不变：布局文档搬家不改 JSON。`GridSnapshot` 的版本规则见“版本”与“L0 的快照格式与 L2 持久化绑在一起”。
- **接口**：
  - 工作台、编辑器插件与 SDK 的导入路径改到 L2 包：`from "@notnotype/nb-layout…` 在 `packages/` 下共约 105 处、56 个文件（含 3 个 e2e：`workbench-shell`、`workbench-containers`、`workbench-views`）；同一条导入里混着 L0 与 L2 的名字时要拆成两条，机械改但不是纯路径替换；
  - SDK：见“对插件 SDK 的影响”；
  - 错误码与文案的迁移：测试里的中文断言改成码，规则写死，有测试兜底；`onGestureCommit` 的返回类型是 L1 公开类型的破坏性变化；
  - CSS 变量：见“CSS 变量迁移”，动到主题合同。
- **安全**：无。
- **迁移**：
  - t14 把 nb-story、开发者面板换成 nb-layout 的 Splitter，排在去掉 nb-ui 依赖之后：迁过去的 Splitter 已经不依赖 nb-ui；
  - t14 README 与 ADR 0044“后果”写“nb-story 的发布依赖从 8 个包变成 9 个，要写新 ADR 补充 ADR 0029”，要核对：nb-story 的 nb-ui、nb-form、nb-agent-ui 在 `devDependencies`（网页打包进包里），nb-layout 同理的话，发布依赖不变，这条要改，也不需要为它另写 ADR（凭常规设计审查，实施前核实）。
- **发布与回滚**：
  - 第一档的每一步工作台行为不变、各自能回退；拆包那一步（约 56 个文件改导入）的回退点是合入前的提交，与 t14 的并行改动在 Task 里错开；
  - 发到 npm 是外部、不可逆的动作，npm 只给 72 小时撤回，由开发者执行，不在本提案范围；
  - 第二档的发布前冒烟见“第二档：发布流水线”。
- **ADR**：已定后写一份新 ADR：[`0054`](../adr/0054-nb-layout-general-library.md)，部分取代 ADR 0044 第 6 条（工作台层拆出 nb-layout，`./vue` 不再依赖 nb-ui）、补充 ADR 0029（本包发编译产物，排在第二档）；只写长期决定，不写本提案里的实施细节。
- **第二档的触发条件与 nb-story**：nb-story 改造成用 NestedGrid、拖动这些公开面时，是第二档第一个要发生的事。这时才决定它消费源码还是编译产物，见“源码与发布目录两条路怎样保证一致”。

## 对 Spec 的预期改动

- [`ui/layout-drag`](../specs/ui/layout-drag.md)：
  - 目标与非目标要重写，不只是“接住行为”：现有范围声明是“拖的是什么、落点长什么样、放下做什么都由宿主给”，第一步抽进库的卡片缩放与追赶、帧调度改变了这个范围；
  - 把与工作台无关的行为从 workbench-layout 输出 38 搬过来：两种手感、候选稳定才换预览、卡片缩小与追赶、按住不动时不排帧。撕下来源、来源收起后按新布局重判、指针不动不重判、空位粘住、标签条里排序跟手，这几条编排第二步（第二档）进库时再搬，第一步只在 workbench-layout 里写明它们是 L2 的行为；
  - workbench-layout 输出 38 留工作台的部分，例如活动栏与入口条上的落点、来源是容器唯一视图时的原处，其余链接过去。
- [`ui/nested-grid`](../specs/ui/nested-grid.md)：
  - 已有的行为不变；
  - “失败与恢复”改成按码列出失败。两份 Spec 现在写的是行为（nested-grid 4 条）、没有码，要先在 Spec 里新增条目，不是改写；`onGestureCommit` 的返回类型也要有对应条目（今天没有，输出 7、失败 1 只写“拒绝时回滚预览并给诊断”）；
  - 补“收起与展开的入口”与 `restoreSize` 的维护者、`useGridHost` 与 `useGridLayout` 的关系；
  - “边界与兼容”写公开入口、`@stable` 的范围、错误码集合开放、CSS 变量与 `data-*` 表的位置；
  - 实现合同里的公开入口跟着改。
- [`ui/workbench-layout`](../specs/ui/workbench-layout.md)：实现合同的公开入口改成 L2 包与 nb-layout 的公开入口；文档层失败码的写法跟着改。
- [`theme/system`](../specs/theme/system.md)：变量体系第 2 层的角色变量，写新旧变量名的对应与桥接样式的位置；主题作者文档同步。
- `ui/i18n`：第二档默认英文时改 `state:inject` 的声明（第一档不改）。
- 不新建 Spec：推荐方案不做通用停靠模型。选备选 A 时要新建一份停靠布局的 Spec，把 workbench-layout 里与工作台无关的落点规则、结构操作搬过去。

## 待定项

无。开发者 2026-11-18 的决定已把原来的待定项全部定下，见决策记录。实施中要核实的事项（凭记忆的构建坑、码的逐处划分、旧名到新名对照表、SDK 弃用期的长度、t14 README 的发布依赖说法）写在各节，进 Task。

## 决策记录

- 2026-11-16 开发者：“nb-layout 应该是可以复用的通用布局工具，后面可以发到 npm，其他项目依赖他”。即 t26 里问的三个定位（甲：工作台专用；乙：工作台层挪到子路径；丙：通用库）里选丙。
- 2026-11-18 开发者看草稿的待定项：
  - 第 1 项同意推荐：布局文档搬进不发布的工作区包。
  - 第 4 项：nb-layout “可以发 MIT”。
  - 第 5、6 项同意推荐：先在仓库里做到能发布，t14 迁完、有第二个使用方再发；t14 排在去掉 nb-ui 依赖之后。
  - 第 2 项：开发者指出拖动控制器是调得最久、两种手感都靠它的地方，问它是否耦合应用、库的布局模型是什么。主会话答：手感的编排一半已经隔在接口后面，可以进库。推荐改成“手感引擎进库，工作台适配层留在 L2”，开发者同意。
  - 第 3 项同意推荐：发编译产物。
  - 开发者要求设计审查加拉远看与实际体验。
- 2026-11-18 开发者看三份审查（常规设计 12 条、拉远看 7 条、实际体验 21 条）里质疑方向的三件：“都按推荐。第一个外部使用方就是 nb-story（到时候可以改造）。先做现在就做的”。即：
  - **手感引擎分两步**：第一步在应用里按 t26 的 design-09、10 整理拖动控制器，只把纯的部分（卡片的缩放与追赶、帧调度）抽进库；第二步编排部分等有第二个宿主（Lab 里一个不是标签页的宿主，或官方示例应用）验证过再提进库。这改了上面第 2 项的“手感引擎进库”。
  - **发布准备分两档**：第一档现在做（拆出工作台层、统一错误形状、去掉 nb-ui 依赖、入口改显式清单加导出名测试、`useDragSession`、`useGridHost`、控制器整理与纯部分进库、t14）；第二档以后做（编译产物流水线、API 报告 CI、`@stable`/`@experimental` 全量标注、手感编排进库、默认英文文案）。第一个外部使用方是 nb-story：第二档在把它改造成用 nb-layout 的 NestedGrid、拖动这些公开面时做，形状由它校验。编译产物与 MIT 照旧是已定的终点，只是排在第二档。这改了上面第 5 项的“有第二个使用方再发”的说法：第二个使用方是 nb-story 的改造，不是 t14。
  - **保持新包** `nb-workbench-layout`，理由改成两条：许可证（nb-layout 发 MIT，工作台层是 AGPL 仓库里的领域代码，不放进 MIT 的包）与依赖方向由包边界守住。“纯 TS、Bun 里能测”是 t04 的理由，不是新包的理由。
  - 之前已定的不变：布局文档搬进不发布的工作区包；发编译产物（补充 ADR 0029）；nb-layout 发 MIT；t14 排在去掉 nb-ui 依赖之后。
- 2026-11-18（t34 计划，待开发者追认）：“错误与诊断”里说 `stale-context`、`stale-revision`、`handler-missing`、`handler-threw` 在代码与 Spec 里没有对应的失败、不预设，这句与代码不符：`useGridLayout` 的提交回调已有网格未就绪、承载盒尺寸不可用、上下文已切换、版本已变、容器尺寸已变五种拒绝，`useSashGesture` 有提交处理器抛出，`NestedGrid` 有没接 `onGestureCommit` 与接纳后没发布匹配布局，nested-grid 的“状态与转换”也写了缺 grid 或容器尺寸时不接受提交。`onGestureCommit` 的返回类型在第一档改成码，这些失败必须有码，所以在 t34 定码，不留到第二档：提交的返回类型里是 `not-ready`、`stale-context`、`stale-revision`、`stale-size`、`handler-missing`、`handler-threw`；`not-published`（接纳后没发布匹配布局）与 `notify-failed`（落账后通知宿主时抛出）只是诊断，不在提交的返回类型里。
- 2026-11-18（t34 计划第 3 稿，待开发者追认）：“错误与诊断”的另外几处按第二轮设计审查落成：
  - “每次布局都发的诊断合并成一条一个码”与“`issues` 只发新增”：求解与预览结果里的诊断照旧逐条、完整（状态快照）；通知宿主时按键（码、`cause`、轴；节点 id 与数值不进键）只发新出现的，同一批里同键的合成一条、节点 id 取并集。只按码合成会把不同原因（最小值合计超出、分隔条占满、交叉轴不够）混成一条，宿主拼不出说得清的文字。
  - 诊断形状加 `params`（提案写的是 `{code, message}`），与失败同形；`SashGestureScope.issues` 这个公开的累计列表删掉，改成回调，累计由宿主自己做。
  - 候选表里 229（根节点没有父分支）改归 `invalid-argument`，617、632（目标父节点已不存在，实际不可达）改归 `not-found`；失败码与诊断码不相交，诊断里“没有收起策略”叫 `no-collapse-policy`，不与失败码 `not-collapsible` 同名。
- 2026-11-18（t34）：上面两条 t34 的决策记录写的是计划第 3 稿，第 3 稿的第三轮设计审查仍有 6 条重要问题（同键合成后字段对不上、回调抛出时手势卡住、`ids` 数组与 `ui/i18n` 的文字参数不兼容等），没有通过；t34 停下等开发者决定拆分方式，这两条记录在开发者定之前不算定论。
- 2026-11-19 开发者对 t34 停下时的推荐答“同意”：
  - t34 只做失败的形状：L0 结构操作、快照恢复与 L1 提交的码按上面第一条与第二条里的“个别码”实施（追认），另把 401、452 拆成 `not-found` 与 `wrong-node-kind`；失败的 `params` 值只用字符串与数字，与 `ui/i18n` 的文字参数同型。
  - 诊断（第二条里的合成与只发新增、诊断的 `params`、删 `SashGestureScope.issues`）拆到 w00026 t38 重新设计，在 t38 定稿前不算定论；诊断码不与失败码同名照旧成立。
  - 第一档第 2 项里“L2 的 `rejected` 归并成码”延后到有使用方时再做：这一档 L2 码不变，`detail` 改名 `message`、改英文。拆码今天没有使用方（应用按码分支的地方只看 `not-found`、`limit-exceeded`），nb-workbench-layout 也不发布。
- 2026-11-19（w00026 t38 计划第 1 稿，待开发者追认）：“错误与诊断”的诊断一半不照“每次布局都发的诊断合并成一条一个码”做，改成不合成：每条诊断带它所在的节点 `id`（分支、叶或面板），通知按码、`cause`、轴与 `id` 只发新出现的；同一次求解里同一个节点同一个原因最多一条，合成没有必要，参数也不会对不上（t34 第 3 稿合成之后 `branch`、度量只对应第一条，节点 id 却是并集）。诊断的参数只有字符串与数字，不带节点 id 的数组。宿主的诊断回调抛出时库照常收尾，异常用 `console.error` 报出、不重新抛出（这一句第 2 稿改了，见下一条）。
- 2026-11-19（w00026 t38 计划第 2 稿，待开发者追认）：宿主回调抛出改成控制流保证收尾：先清状态、后调回调，异常照常冒出；只有落账之后重算的通知接住，交 `reportError`（没有时 `console.error`）。窄窗口下一次通知最多 O(节点数) 条，不是“一条”，之后每个键只通知一次。第一轮拉远看审查质疑“通知只发边沿”本身（没有消费者，建议只留快照与事件型通知），交开发者定。
- 2026-11-19（w00026 t35 计划第 3 稿，待开发者追认）：“去掉 nb-ui 依赖”与“CSS 变量迁移”按两轮设计审查落成，和上文不同的几处：
  - 不带“`:root` 默认值样式”：库里不分层的 `:root` 声明会压过 nb-ui 放在 `layer(base)` 里的桥接（层叠层先于特异性），装了 nb-ui 的外观就变了。缺省值只靠每处 `var()` 的回退；JS 读到空串时取变量清单里的缺省值，所以“不设变量时 CSS 时长与 JS 读到的时长一致”照旧成立。库的全局样式只有两样：减少动效时把四个时长归零（带 `!important`），以及自己的焦点环类。层级同样不在 `:root` 上声明，经桥接取值、回退写数值。
  - 根入口导出变量清单 `NB_LAYOUT_THEME_VARS`（名字、类别、回退），作为变量扫描、桥接一致性测试、README 变量表与主题文档对照表的同一个来源。层级与登记表一致由 neuro-book 的一致性测试核对（它同时看得到两个包），不放在 nb-ui。
  - “空项目类型检查”那条机检不做：收紧 nb-layout 的 `boundary.test.ts`（不再放行 nb-ui）就是“公开入口不读 nb-ui”的检查；临时空项目挡不住仓库根的 `node_modules`。
  - 桥接照旧放 nb-ui 的 `tokens.css`；插件 SDK 的令牌文档由它生成，生成时跳过 `--nb-layout-*`。
  - 文案：nb-layout 有自己的注入键 `LAYOUT_TEXT_KEY` 并从 `./vue` 导出；应用用一个帮手在每个根同时提供它与 nb-ui 的文字端口。
  - 盘点与上文不同的事实：按旧名设或读样式的 e2e 是 18 个文件，不是 6 个；主题作者文档里没有布局变量。
