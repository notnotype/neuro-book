# t67 实施计划：外壳三：拖放

## Context

- **为什么做**：外壳二（t66）交付了容器与视图、两个实例层与“移动到”菜单，但只能移进已有容器：单个视图分离出来、整个容器换区域或换序、整组并入、半区按来源比例分配都还没有（t66 待确认清单的“不提供新建容器”一项就等外壳三）。按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节，外壳三做拖放：视图与容器两类拖动源、三类落点、自建容器 `custom:<UUID>`、整组并入、半区来源比例、键盘拖放、拖影与落点反馈。之后是第 6 步 Files。
- **依据**：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三输出 19–23 与验收 19–25、“副作用与数据”的自建容器与视图尺寸两条、“失败与恢复”的拖放失败；设计稿第 3 节（三类容器身份、标题回落）、第 6 节（记录）；nb-ui [`ui-development-spec.md` 拖放反馈](../../../../../packages/nb-ui/docs/ui-development-spec.md) 与 `layout/grid-drop.ts`（`resolveGridInsertion`、`resolveListInsertion`）、`DropFeedbackOverlay`。
- **已定的**：拖放行为表、方向与命中、半区分配公式、拖影与反馈、键盘拖放的按键都已在 Spec 定稿（2026-09-20、09-22 开发者确认，v2 改写时保留）。旧应用的拖放经开发者 2026-10-08 人工验证，可以参照：落点判定纯函数 `packages/neuro-book-legacy/app/utils/workbench/workbench-drop.ts`（1021 行）与 `workbench-drop-dom.ts`（命中检测）、拖动会话 `app/composables/useWorkbenchDrag.ts`、`useWorkbenchDrop.ts`（dnd-kit 会话、每帧同步求命中与判定、松手只提交已显示过的动作）、`app/components/workbench/` 的 `WorkbenchDragOverlay`、`WorkbenchDropOverlay`、`WorkbenchActivityContainerEntry`、`WorkbenchActivitySwitcherBand`、`WorkbenchContainerTab`；落位里的自建容器、整组并入与半区分配在 `view-placements.ts` 的 `detach-view`、`merge-container`、`resolveSplitSizes`。
- **需要先定的一项（按推荐写，记入待确认清单）**：拖动手势用旧应用同一个库 `@dnd-kit/vue`（`^0.5.0`，含指针与键盘传感器、碰撞检测扩展点），而不是自写指针会话。理由：旧应用的拖放已经人工验证，其会话层的难点（每帧同步求命中、键盘拖动的坐标、取消条件）都建在这个库上；自写要重做这些且没有已验证的参照。代价是新应用多一个运行时依赖（体积在 S8 量）。
- **推进方式**：按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)，与 t65、t66 相同（worktree 逐片提交并 push；真实内核、Storage、nb-ui 与本机 Chrome；不用 mock、spy、假计时器、固定等待；变异检查；三个 omp 审查计划与实现）。不修改 `packages/neuro-book-legacy`。
- **现状**：t66 的纯模型（`web/views/{placement,presentation,intents}.ts`）只认隐式容器；`intents.ts` 有 `move-view`（追加到末尾）与 `reset-view`；记录 `views-customizations` 的 `containers` 项必有默认指纹；Switcher 用 nb-ui `Tabs`（不能当拖动源）；“移动到”菜单一层平铺。

## 关键设计

### 1. 自建容器与记录（`web/views/placement.ts`、`web/state/records.ts`）

- 第三类容器身份 `custom:<UUID>`：由拖放会话在发起时生成一次（`crypto.randomUUID()`），冲突重放复用同一 id。记录 `containers[custom:…]` 存 `{location, order, origin}`（`origin` 是创建时被拖出的视图，作为标题回落的第 3 级）；隐式容器项仍是 `{location, order, fingerprint}`。schema 改为 `fingerprint` 与 `origin` 都可选、两者恰有其一由落位模型校验（记录版本不变，旧记录仍合法）。
- 自建容器存在需要记录项且有实际成员；实际成员归零的那次意图同时删掉它的记录项（Spec“副作用与数据”）。只有成员没有记录项（记录被别处删了）时，成员回到各自默认位置并诊断。
- 落位：容器顺序与位置的覆盖对三类容器同一种写法；隐式容器的覆盖仍带指纹。标题回落第 3 级对自建容器取 `origin` 的声明。

### 2. 意图（`web/views/intents.ts`）

在 t66 的意图上补齐拖放要的几种，全部整批拒绝、只改主动字段：

- `move-view` 加可选 `beforeViewId`（插入位）与 `split`（边缘并入的半区：命中叶、侧向、轴、目标与来源两张尺寸表），半区按 Spec 输出 21 的公式在合成时算出新尺寸意图；同一容器内的边缘落点只改顺序。
- `detach-view {viewId, sourceContainerId, containerId, targetPart, beforeContainerId?}`：建自建容器、搬入视图、选中目标、源自建容器归零时删记录，同一个补丁。
- `move-container {containerId, sourcePart, targetPart, beforeContainerId?}`：整容器换序或迁区，原位（锚点就在自己前后）为无变化；迁到另一个 Part 时选中它。
- `merge-container {sourceContainerId, targetContainerId, sourceViewIds, split?, beforeViewId?}`：全部实际成员（含隐藏）按冻结顺序并入，源自建容器删记录；有 `split` 时可见成员按来源比例分半区。
- 插入位求解搬旧应用的 `resolveInsertion`（中点、越界时只重排目标集合）；t66 的“追加到末尾、越界重排”并入它。
- “移动到”菜单加“新建容器（在 X）”：走 `detach-view`（菜单与拖放同一意图），解决 t66 待确认清单里推迟的单视图分离与移到空区域。

### 3. 落点判定（`web/views/drop.ts`，纯 TS）

- 从旧 `workbench-drop.ts` 改写：输入是拖动源（视图或容器，发起时冻结来源与成员快照、布局代次）、命中目标（Switcher 插入位、容器内容、空 Part 三类）、几何（client 像素的内容盒、叶盒、条目盒）与呈现模型；输出 `{kind: "commit", intent, preview} | {kind: "noop", preview?} | {kind: "rejected", reason}`。预览与将要提交的意图同源。
- 规则全部按 Spec 输出 19–21：内容区用 nb-ui `resolveGridInsertion` 前后各 50%、中点归后半；Switcher 用 `resolveListInsertion({edgeGap: 4})` 只有插入位；侧栏只接上下、Panel 只接左右；全收起时落点是细条之后的剩余区；空 Part 整区一个落点；量不出半区尺寸时整条拒绝，不降级成追加。
- 改写时把旧口径换成 v2：位置就是 ToolPart id，容器身份三类，意图换成第 2 节的形状。

### 4. 拖动会话（`web/views/drag-session.ts` 与组件里的接线）

- 依赖 `@dnd-kit/vue`（待确认）。会话在 `WorkbenchShell` 一级提供：拖动源与落点各自登记（落点的 `data` 就是命中目标声明，几何读法随落点登记）；每个显示帧用当下坐标同步求一次命中与判定（不读库在 microtask 里更新的 `operation.target`）；松手只提交最后一次已经显示过的动作（`isSameDropAction` 比较）；Escape、`pointercancel`、失焦、页面隐藏、布局代次变化都取消且不提交。
- 激活门槛同旧应用：鼠标与笔移动 6px、触摸按住 200ms；标题里的动作区、菜单、表单控件与 `data-no-drag` 区域不起拖。
- 键盘拖放（Spec 输出 23）：空格在拖动源上拿起，方向键沿目标轴移动、Tab 换目标区域、Enter 放下、Escape 取消；与指针同一份判定，成员、轴、活动内容变化时取消。
- 拖影 `WorkbenchDragOverlay`（图标加文字，两类源同一种）；落点反馈用 nb-ui `DropFeedbackOverlay`（插入线、半区、整区与提示文案）。源标题、标签与活动条目保持原样，不插占位。

### 5. 组件

- 拖动源：`WorkbenchViewSection` 的标题行（multiple）、Sidebar single 的容器标题行（`WorkbenchToolPartHost`）、Switcher 的容器标签、ActivityBar 的容器项。
- Switcher：AuxiliaryBar 与 Panel 的标签带从 nb-ui `Tabs` 换成自己的 `WorkbenchSwitcherTabs`（标签既是可选中的 tab、又是拖动源与插入位的几何；键盘合同照搬 `Tabs`：roving tabindex、方向键自动激活）。
- 落点：标签带与 ActivityBar 条目带（插入位）、`WorkbenchViewContainerHost` 的内容盒（边缘并入）、`WorkbenchToolPartHost` 的空区（整区，显示“将视图拖动到此处显示”）。
- Lab：外壳的 `views` 系列场景接上拖放（场景用局部状态与同一份纯模型）；新零件各有场景。

### 6. 命令

不新增命令：拖放与“移动到”经布局 store 的 `applyView`；`move-view` 命令的参数不变（菜单的“新建容器”不是命令目标，走意图）。如果审查认为“新建容器”也该经命令执行，改为给 `move-view` 加 `{viewId, sourceContainerId, newContainerIn: part}` 形式。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 输出 24 的“移动到”加“新建容器（在 X）”；“副作用与数据”写自建容器记录项的形状（`origin`）与指纹、`origin` 二选一；外壳三输出与验收按实现细化（键盘拖放的焦点去向、拖影内容、拒绝原因的提示）；需要时追加编号，不改已有编号 |
| `docs/proposals/workbench-shell-abstractions.md` | 只追加决策记录：拖动手势用 `@dnd-kit/vue`（待确认） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 1、2 节 | 自建容器、四种拖放意图、插入位与半区公式（纯 TS）及测试 | `bun test` 该目录；Spec 输出 21 的两个例子逐数核对 |
| S2 | 第 3 节 | 落点判定纯函数及测试 | `bun test`；行为表逐行 |
| S3 | 第 2 节菜单、第 5 节 Switcher | “移动到”的新建容器、`WorkbenchSwitcherTabs` 替换 `Tabs` | 组件测试；t66 e2e 不退化 |
| S4 | 第 4 节 | 依赖、拖动会话、拖动源与落点登记、拖影与反馈、键盘拖放 | 组件测试；Lab 场景本机 Chrome 探针 |
| S5 | — | `e2e/workbench-dnd.e2e.ts` 与截图 | 新 e2e 连跑三次 |
| S6 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`、体积 |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 行为表九行（Spec 输出 19）与验收 19：一次手势只接纳一次、隐藏成员不遗漏、非法成员或失效目标整组拒绝、非法方向零提交零反馈 | S2 纯模型逐行；S5 指针与键盘各走一遍 |
| 空 Switcher 四条路径（验收 20）：单视图建一个容器、整容器不嵌套、目标被选中且只提交一次、标题文字与工具区拒绝 | S1、S2；S5 |
| 拖影与插入线（验收 21） | S4 组件测试；S5 截图与 DOM 断言 |
| 视图投标签建新容器在同一插入位、悬停标签成员不变、源搬空消失（验收 22） | S1；S5 |
| 半区与来源比例（验收 23 的两组数） | S1 逐数；S5 读记录核对 |
| 换轴与禁投方向（验收 24） | S2；S5 |
| 中点归后半、全收起时落在剩余区（验收 25） | S2；S5 |
| 自建容器：生成一次的身份、冲突重放复用、搬空清记录、刷新一致 | S1；S2 的真实 Storage 场景（store 测试）；S5 |
| 键盘拖放：拿起、移动、换区域、放下、取消；成员或轴变化时取消 | S4；S5 |
| “移动到”的新建容器 | S1；S3；S5 |

## 验证

- 每片：上表的自跑验证；类型改动影响时跑三份 typecheck。
- 收口：`test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`；交付前对验收映射逐条做变异检查；量浏览器构建体积（t66 收口时 720,357 B，gzip 230,437 B）。
- 真实环境：e2e 构建的测试插件 `test.sample-views` 走全链路；开发服务下的 Lab 截图（四主题 × 双配色 × 1440×900、390×844）。
- 未验证边界：触摸拖动（本机没有触屏，只验证鼠标与键盘）；DPR（同 t65）。

## 不做

- 编辑器分组与文档标签的拖放（随编辑器插件）；跨窗口拖放；外部文件拖入。
- 声明式容器贡献点、视图的 `when`、标题动作贡献（随消费者）。

## 风险

- 旧 `workbench-drop.ts` 以旧口径（位置枚举、静态容器抑制标记）写成：只搬判定结构与几何算法，意图与容器身份按 v2 改写；改写后行为表逐行重测，不信旧测试的结论。
- `@dnd-kit/vue` 0.5 是预发布版本线：会话层只经少数扩展点（传感器、碰撞检测、拖影），升级风险集中在一处；新增依赖要过体积与许可检查。
- 把 nb-ui `Tabs` 换成自己的标签带会重做一遍键盘合同：照搬 `Tabs` 的文档与测试，避免两套行为。
