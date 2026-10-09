# t67 实施计划：外壳三：拖放

## Context

- **为什么做**：外壳二（t66）交付了容器与视图、两个实例层与“移动到”菜单，但只能移进已有容器：单个视图分离出来、整个容器换区域或换序、整组并入、半区按来源比例分配都还没有（t66 待确认清单的“不提供新建容器”一项就等外壳三）。按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节，外壳三做拖放：视图与容器两类拖动源、三类落点、自建容器 `custom:<UUID>`、整组并入、半区来源比例、键盘拖放、拖影与落点反馈。之后是第 6 步 Files。
- **依据**：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三输出 19–23 与验收 19–25、“副作用与数据”的自建容器与视图尺寸两条、“失败与恢复”的拖放失败；设计稿第 3 节（三类容器身份、标题回落）、第 6 节（记录）；nb-ui [`ui-development-spec.md` 拖放反馈](../../../../../packages/nb-ui/docs/ui-development-spec.md) 与 `layout/grid-drop.ts`（`resolveGridInsertion`、`resolveListInsertion`）、`DropFeedbackOverlay`。
- **已定的**：拖放行为表、方向与命中、半区分配公式、拖影与反馈、键盘拖放的按键都已在 Spec 定稿（2026-09-20、09-22 开发者确认，v2 改写时保留）。旧应用的拖放经开发者 2026-10-08 人工验证，可以参照：落点判定纯函数 `packages/neuro-book-legacy/app/utils/workbench/workbench-drop.ts`（1021 行）与 `workbench-drop-dom.ts`（命中检测）、拖动会话 `app/composables/useWorkbenchDrag.ts`、`useWorkbenchDrop.ts`（dnd-kit 会话、每帧同步求命中与判定、松手只提交已显示过的动作）、`app/components/workbench/` 的 `WorkbenchDragOverlay`、`WorkbenchDropOverlay`、`WorkbenchActivityContainerEntry`、`WorkbenchActivitySwitcherBand`、`WorkbenchContainerTab`；落位里的自建容器、整组并入与半区分配在 `view-placements.ts` 的 `detach-view`、`merge-container`、`resolveSplitSizes`。
- **需要先定的一项（按推荐写，记入待确认清单）**：拖动手势自写指针会话，不引入 `@dnd-kit`。原计划沿用旧应用的 `@dnd-kit/vue` 0.5；S4a 实现时（2026-10-09）读旧会话层改判：命中与判定每帧同步自算、键盘拖放的键表按 Spec 自写，库只剩指针激活门槛一项，旧代码还要用 Proxy 改写库在微任务里才更新的坐标；0.5 是预发布版本线。
- **推进方式**：按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)，与 t65、t66 相同（worktree 逐片提交并 push；真实内核、Storage、nb-ui 与本机 Chrome；不用 mock、spy、假计时器、固定等待；变异检查；三个 omp 审查计划与实现）。不修改 `packages/neuro-book-legacy`。
- **现状**：t66 的纯模型（`web/views/{placement,presentation,intents}.ts`）只认隐式容器；`intents.ts` 有 `move-view`（追加到末尾）与 `reset-view`；记录 `views-customizations` 的 `containers` 项必有默认指纹；Switcher 用 nb-ui `Tabs`（不能当拖动源）；“移动到”菜单一层平铺。

## 关键设计

### 1. 自建容器与记录（`web/views/placement.ts`、`web/state/records.ts`）

- 第三类容器身份 `custom:<UUID>`：发起这次动作（拖放松手、菜单或命令选定目标）时生成一次（`crypto.randomUUID()`），保存冲突重放复用同一 id。记录 `containers[custom:…]` 存 `{location, order, origin}`（`origin` 是创建时被拖出的视图，作为标题回落第 3 级）；隐式容器项仍是 `{location, order, fingerprint}`。schema 改为 `fingerprint`、`origin` 都可选，“隐式容器必有指纹、自建容器必有 origin”由落位模型校验（记录版本不变，旧记录仍合法）。
- 自建容器存在需要记录项且有实际成员。只有成员没有记录项时成员回各自默认位置并诊断。
- 落位：容器顺序与位置的覆盖对三类容器同一种写法；隐式容器的覆盖仍带指纹。

### 2. 补丁与保存边界（`web/views/intents.ts` 的 `applyPatch`）

t66 的补丁是“发起时算好、保存冲突时原样作用在最新值上”的字段操作。拖放引入两件发起时定不下来的事，放到唯一的补丁应用边界（每次保存都对最新值跑一遍）做（审查 M01、M02、D03）：

- **字段粒度**：容器项拆成位置（`location`、`order`）与身份（指纹或 `origin`）两类字段，视图的归属与顺序分开（t66 已为重排加了只改顺序的 `reorder`）；补丁只含主动字段，创建自建容器时带上完整身份。
- **自建容器的确保与收口**：先应用主动字段；再对本次涉及的自建容器（发起时的来源与目标、最新值里被本次移走的视图原来所在的容器）按最新值求实际成员：本次目标的身份在最新值里没有了（另一个窗口刚把它搬空清掉），按补丁带的身份重建；涉及的自建容器在最新值里真的没有成员了才删它的记录项与指向它的选中项。不做全局清扫，未知项不动。
- **几何并入的前提**（审查 M03）：带半区的并入在应用边界核对最新值里目标容器仍在同一 Part（同一轴）、命中叶仍是它的成员；不成立时整条补丁不写（这次保存返回最新值不变，记诊断），不留下只改了归属或只改了尺寸的半更新。普通移动仍按“同字段后保存胜出”。
- 这条冲突政策（普通移动重建被清掉的目标、几何并入整条不写）记入待确认清单，Spec“状态与转换”写明。

### 3. 意图（`web/views/intents.ts`）

全部整批拒绝、只改主动字段：

- `move-view` 加可选 `beforeViewId`（插入位）与 `split`（命中叶、侧向）。半区按 Spec 输出 21 在**尺寸意图单位**里分（审查 M04、D04）：命中叶的意图 S 取记录值（没记录过取默认 240），命中叶保留 S/2，拖入的可见成员合计 S/2 按来源相对比例分（来源比例来自释放时的实测几何或保存的当前轴意图，只当比例用）；补丁只写命中叶与拖入成员的当前轴，其它目标成员、收起成员的展开意图、另一轴都不动；min/max 由网格在布局时夹取，不夹反解的意图。同一容器内的边缘落点只改顺序，不产生尺寸字段。
- `detach-view {viewId, sourceContainerId, containerId, targetPart, beforeContainerId?}`：建自建容器、搬入视图、选中目标，同一个补丁。
- `move-container {containerId, sourcePart, targetPart, beforeContainerId?}`：整容器换序或迁区，原位为无变化；迁到另一个 Part 时选中它。
- `merge-container {sourceContainerId, targetContainerId, sourceViewIds, split?, beforeViewId?}`：全部实际成员（含隐藏与收起）按冻结顺序并入；有 `split` 时可见成员按来源比例分半区。
- **全收起时的剩余区**（审查 M05）：落点是细条之后的剩余区时，`move-view`/`merge-container` 带 `expand: viewIds`（拖入的可见成员），同一补丁清掉它们的收起；原有细条保持收起，隐藏成员不动。
- 插入位求解搬旧应用的 `resolveInsertion`（中点、越界时只重排目标集合，重排只改顺序）。

### 4. “移动到”与命令（审查 D01）

- `nbook.view.move-view` 加与 `targetContainerId` 互斥的 `newContainerIn: "sidebar" | "auxiliarybar" | "panel"`：命令处理函数把它翻成 `detach-view`，UUID 在这次执行接纳时生成。菜单与无参命令面板共用一份目标表：每个 Part 末尾一项“新建容器（在 X）”。拖放仍直接提交结构化意图（经布局 store）。
- t66 待确认清单里“不提供新建容器”一项由本 Task 解决。

### 5. 落点判定（`web/views/drop.ts`，纯 TS）

- 从旧 `workbench-drop.ts` 改写：输入是拖动源（视图或容器，发起时冻结来源、成员快照与布局代次）、命中目标（Switcher 插入位、容器内容、空 Part 三类）、几何（client 像素）与呈现模型；输出 `{kind: "commit", intent, preview} | {kind: "noop", preview?} | {kind: "rejected", reason}`，预览与将要提交的意图同源。
- 规则按 Spec 输出 19–21：内容区用 nb-ui `resolveGridInsertion` 前后各 50%、中点归后半；Switcher 用 `resolveListInsertion({edgeGap: 4})` 只有插入位；侧栏只接上下、Panel 只接左右；全收起时落点是剩余区；空 Part 整区一个落点；量不出半区比例时整条拒绝，不降级成追加。
- 旧口径换成 v2：位置就是 ToolPart id，容器身份三类，意图换成第 3 节的形状；旧的静态容器抑制标记、工作面代际不搬。

### 6. 拖动会话（`web/views/drag-session.ts`、`web/views/drop-dom.ts` 与组件接线）

- 自写（2026-10-09 改判，见 Context）。组件只加 DOM 标记：拖动源 `data-drag-view` / `data-drag-container`，Switcher 带 `data-switcher-band` 与其中的条目 `data-switcher-entry`，容器内容 `data-container-host` 与其中的分节 `data-view-section`，空 Part `data-empty-part`，不拖的区域 `data-no-drag`。会话装在外壳根上：按下时找拖动源，过门槛后冻结源与布局代次；每个显示帧用当下坐标经 `elementsFromPoint` 求命中（最上层的业务元素决定落点，被浮层挡住的不接收），按标记读可见几何（祖先裁剪后的矩形），交给 `resolveDrop`；松手只提交最后一次已显示过的动作；Escape、`pointercancel`、失焦、页面隐藏、布局代次变化都取消且不提交；拖动结束后吞掉同一手势末尾的 click。
- 激活门槛同旧应用：鼠标与笔移动 6px、触摸按住 200ms；动作区、菜单、表单控件与 `data-no-drag` 不起拖。拖动手势与网格 sash 手势互斥（sash 在自己的命中带里起手势，标题行不是 sash）。
- **键盘适配**（审查 D02、I-02，Spec 输出 23）：同一个会话里显式写键表：Space 在拖动源上拿起，Enter 放下，Escape 取消；Tab / Shift+Tab 在已登记且可见的目标区域间循环，方向键只沿当前区域的轴移动插入位；之后都走同一份纯判定。拖动进行中这些键由会话独占：标签带的方向键自动激活、收起开关的点击、选择保存都不发生；结束后焦点回到拿起时的源。multiple 的视图标题、Sidebar single 的容器标题行、标签、活动条目各有一个可聚焦的拖动源（可访问名称写明“拖动 X”）。
- 拖影 `WorkbenchDragOverlay`（图标加文字，两类源同一种）；落点反馈用 nb-ui `DropFeedbackOverlay`。源标题、标签与活动条目保持原样，不插占位。

### 7. 组件

- 拖动源：`WorkbenchViewSection` 的标题行（multiple）、`WorkbenchToolPartHost` 的 Sidebar single 容器标题行、Switcher 的标签、ActivityBar 的容器项。
- Switcher 的标签（审查 I-03）：给 nb-ui `Tabs` 加通用的逐项属性 `attrs`，拖动源与条目的标记经它写上（会话按 DOM 标记找元素，不需要元素回调）。会话进行中标签带的键盘自动激活由会话在窗口捕获阶段拦下按键门住（S4c 实现时确认够用，没有给 `Tabs` 另加开关）。
- 落点：标签带与 ActivityBar 条目带（插入位）、`WorkbenchViewContainerHost` 的内容盒（边缘并入与剩余区）、空 Part（整区，显示“将视图拖动到此处显示”）。**空标签带常驻**（审查 I-01）：AuxiliaryBar 的标签带与 Panel 导航槽在没有容器时也占着标题行里框架按钮之外的正面积，空正文填满其余区域，两块各登记一个落点。
- Lab：外壳的 `views` 系列场景接上拖放，场景扩到能摆出隐藏成员、不可移动成员、全收起与失效目标的开关（隐藏成员的产品来源要等视图的 `when`，产品 e2e 不伪造它）。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 输出 24 加“新建容器（在 X）”；“副作用与数据”写自建容器记录项的形状（`origin`）与指纹、`origin` 二选一、半区写在意图单位里只写命中叶与拖入成员；“状态与转换”写保存边界的冲突政策（普通移动重建被清掉的目标、几何并入前提不成立整条不写）；外壳三输出与验收按实现细化（键盘拖放的焦点去向、空标签带落点）；需要时追加编号 |
| `docs/specs/workbench/commands.md` | `move-view` 的 `newContainerIn` |
| `docs/proposals/workbench-shell-abstractions.md` | 只追加决策记录：拖动手势自写指针会话（待确认） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 1–3 节 | 自建容器、补丁边界的确保与收口、四种意图、半区与剩余区（纯 TS）；接入 store | `bun test`；Spec 输出 21 的两组例子按意图单位逐数核对；真实 Storage 的双窗口场景（UUID 重放不新增、目标被另一窗口清掉后重建、几何并入前提失效整条不写、顺序与归属互不覆盖） |
| S2 | 第 5 节 | 落点判定纯函数及测试 | `bun test`；行为表逐行 |
| S3 | 第 4 节、第 7 节标签与空带 | `move-view` 的 `newContainerIn` 与菜单项、`Tabs` 逐项入口、空标签带常驻 | 命令与组件测试；t66 e2e 不退化 |
| S4a | 第 6 节 | 指针会话与 DOM 适配，先接一对真实源与落点、拖影与反馈 | 本机 Chrome：源不动、预览后松手只提交一次、Escape 与失焦与卸载清理 |
| S4b | 第 6、7 节 | 产品与 Lab 的全部拖动源与三类落点、停放时的几何回退 | 组件测试；Lab 与产品页探针覆盖行为表九行 |
| S4c | 第 6 节键盘适配 | 键盘拖放 | Chrome：三个 Part 各拿起一次，Tab 换区后仍在拖动、过程中无写入，Enter 只提交一次，Escape 只取消 |
| S5 | — | `e2e/workbench-dnd.e2e.ts` 与截图；测试插件按需要加视图与尺寸约束，比例场景先实测前提再逐数断言 | 新 e2e 连跑三次 |
| S6 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正；量浏览器构建体积 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 行为表九行（Spec 输出 19）与验收 19：一次手势只接纳一次、隐藏成员不遗漏、非法成员或失效目标整组拒绝、非法方向零提交零反馈 | S2 纯模型逐行；S4b 探针；S5 指针与键盘各走一遍（隐藏成员只在纯模型与 Lab） |
| 空 Switcher 四条路径（验收 20） | S1、S2；S3 空带；S5 三个 Part × 两类源 × 两类空落点 |
| 拖影与插入线（验收 21） | S4a；S5 截图与 DOM 断言 |
| 视图投标签建新容器在同一插入位、悬停标签成员不变、源搬空消失（验收 22） | S1；S5 |
| 半区与来源比例（验收 23 的两组数）：意图单位逐数、未命中成员与另一轴不变、未记录尺寸用 240 | S1；S5 读记录与实际几何比例 |
| 换轴与禁投方向（验收 24） | S2；S5 |
| 中点归后半、全收起时落在剩余区且拖入成员展开、原有细条保持收起（验收 25） | S1、S2；S5 |
| 自建容器：生成一次的身份、冲突重放复用、目标被清掉后重建、搬空清记录、刷新一致 | S1（真实 Storage 双窗口）；S5 |
| 键盘拖放（输出 23） | S4c；S5 |
| “移动到”与命令面板的新建容器；来源过期零写入 | S3；S5 |

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
- 自写指针会话要自己处理库原本覆盖的细节：触摸的 `touch-action`、拖动中的文字选择、拖动末尾的 click；触摸只按代码推断，本机没有触屏验证。
- 把 nb-ui `Tabs` 换成自己的标签带会重做一遍键盘合同：照搬 `Tabs` 的文档与测试，避免两套行为。

## 审查处理

三份计划审查（`evidences/plan-review-{design,model,impl}.txt`）合计 14 条，都按推荐改入计划：

| 审查条目 | 处理 |
|---|---|
| M01、D03 | 自建容器的确保与收口挪到补丁应用边界，按最新值求成员；目标被清掉时重建（第 2 节，冲突政策待确认） |
| M02 | 容器项按字段补丁，视图归属与顺序分开（第 2 节） |
| M03 | 几何并入在应用边界核对前提，不成立整条不写（第 2 节） |
| M04、D04 | 半区在尺寸意图单位里分，只写命中叶与拖入成员（第 3 节） |
| M05 | 全收起剩余区的意图带 `expand`（第 3 节） |
| D01 | 新建容器经 `move-view` 的 `newContainerIn`（第 4 节） |
| D02、I-02 | 会话里显式的键盘适配与拖动中的键独占（第 6 节） |
| I-01 | 空标签带常驻并登记落点（第 7 节） |
| I-03 | 优先扩展 nb-ui `Tabs`（第 7 节） |
| I-04 | 隐藏成员只在纯模型与 Lab；比例场景先实测前提（第 7 节、S5） |
| I-05 | S4 拆为 S4a–S4c；体积统一在 S6 |
