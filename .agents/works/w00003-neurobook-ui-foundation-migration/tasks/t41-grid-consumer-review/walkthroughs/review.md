# t41 首轮独立复核：两轴 grid 与真实消费者

结论：**需要修复**（阻断项 3 条，均在下面固定的 revision 上复现；复核期间作者仍在改同一批文件，收口后需追加确认）。

只读被审源码；未修改任何被审文件、未启动产品服务、未访问 3001、未提交。

## 1. 被审 revision

HEAD `70c7168d2913cb3bf69174e8e6721d548174c6e0` + 当前未提交改动。报告写成时的文件 sha1（探针运行前打印，见 evidences）：

| 文件 | sha1 |
|---|---|
| `packages/nb-ui/src/components/layout/grid.ts` | `33e8a277` |
| `packages/nb-ui/src/components/layout/grid-geometry.ts` | `aeefb49b` |
| `packages/nb-ui/src/components/layout/grid-types.ts` | `e87f2a05` |
| `packages/nb-ui/src/components/layout/grid-snapshot.ts` | `84c38943` |
| `packages/nb-ui/src/components/layout/grid.test.ts` | `8bb9c4b6` |
| `packages/neuro-book/app/utils/workbench/layout.ts` | `01275cb1` |
| `packages/neuro-book/app/components/workbench/WorkbenchBranch.vue` | `680d4b1c` |
| `packages/neuro-book/app/components/workbench/WorkbenchShell.vue` | `27bcd974` |

**目标在复核期间变动**：`grid.ts` 11:35:45、`grid-geometry.ts` 11:35:32、`grid-types.ts` 11:34:37、`grid.test.ts` 11:36:04、`WorkbenchShell.vue` 11:36:33、`layout.ts` 11:37:15 与 11:38:24 都被作者再次写入（期间一次读取撞上 `layout.ts` 未写完的注释，vite 报 `Unterminated multiline comment`）。最终 hash 上重跑探针，三条阻断项全部复现；结论对**该 hash 集合**成立，不对后续 revision 自动成立。

## 2. 阻断项

### F1 交叉轴的 `0` 上限把整棵外壳树的呈现宽度压到叶最小合计，编辑器呈现 0 宽

**现象**（真实函数、真实树，`hidden=[]`）：

```
模型  = {activity:60, left:340, right:400, editor:478, titlebar:36}
树意图 = [60, 340, 478, 400]
layout.sizes = {titlebar:0, activity:60, left:280, editor:0, right:320, main:662, root:662}
root 约束 = {minimum:{width:662,height:36}, maximum:{width:662,height:36}}
issues = ["节点 root 的 width 约束不相容：下限 662 高于上限 0，已以下限优先降级",
          "分支 root 的可用空间 900 有 864 未被任何子节点吸收"]
```

**成因链**（全部在当前源码里可指认）：

1. `app/utils/workbench/layout.ts:283-284` 给 titlebar 叶写 `maximumSize: {width: 0, height: 36}`；`layout.ts:296-297` 给四个宽度叶写 `maximumSize: {width: <min/max>, height: 0}`。
2. `packages/nb-ui/src/components/layout/grid-geometry.ts:113-117`：交叉轴 `max` 取子节点最严（最小）者，并成为该分支自己的交叉轴上限。
3. root 是垂直分支 → 它的交叉轴是 `width`；titlebar 的 `width.max = 0` ⇒ root 的 `width.high = 0` < `width.low = 60+280+0+320+2 sash = 662` ⇒ 诊断后按 `low` 降级，root 与 main 呈现宽 662。
4. main（横向）的交叉轴是 `height`，四个叶 `height.max = 0` ⇒ main 呈现高 0（`"可用空间 900 有 864 未被吸收"`）。
5. 662 装不下四个叶的最小合计 660 + 2px sash 之外的意图 ⇒ `allocateAxis` 走"最小值比例降级" ⇒ `editor` 呈现 0。

**影响**：`WorkbenchBranch.buildPanels`（`WorkbenchBranch.vue:31-42`）现在按 `layout.sizes` 归一化成 reka 百分比，于是主页面 activity 116 / left 542 / **editor 0** / right 619（见 `evidences/t41-probe-hide.md` 的"渲染像素"行）。HEAD 版本传的是 `:sizes`（外壳模型）而不是 `layout`，所以这是 t37 这次消费者接线新引入的主页面几何回归。

**对照证据**：只把"该节点不在被管理的那根轴"的上限改成不限（其余 min/max、意图、拓扑、sash resolver 全部保持原样），呈现立刻与模型逐项相等（`activity 60 / left 340 / editor 478 / right 400`，rendered 60/339.7/477.6/399.7，±0.3 为 sash 舍入）。同一文件里 `grid.test.ts` 的 `leaf()` 与 `spike layout.ts` 的 `leaf()` 都把交叉轴写成 `MAX_SAFE_INTEGER`，只有 `createShellGrid` 写了 0。

**最小修复方向**：在 `createShellGrid` 里让未被管理的轴声明为不限（省略该轴的 `minimumSize`/`maximumSize`，或写 `GRID_UNBOUNDED`），与既有 fixture/spike 口径一致。备选是改原语规则（"叶的交叉轴上限不参与父分支交叉尺寸上限"）——那属于合同变更，要先改 [ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md) 的交叉轴条款，不建议在 t37 内顺手改。

**归属**：t37 声明范围（`app/utils/workbench/layout.ts` 是 t37 owner 文件）。

### F2 隐藏叶的意图被夹到 min 后仍参与比例分配，可见叶渲染偏离尺寸模型

**现象**（对照树 = F1 修好后的形状，`hidden=["right"]`；数字取 `layout.sizes`）：

```
模型      = {activity:60, left:340, right:0(隐藏), editor:879}
树意图    = [60, 340, 879, 320]      ← 隐藏的 right 被 clampLeafSize(0, 320..576) 抬到 320
layout    = {activity:60, left:280, editor:618, right:320}
渲染(可见归一化) = {activity:80, left:373.5, editor:824.4}
```

`hidden=["left","right"]` 时：模型 `{activity:60, editor:1220}`，树意图 `[60, 280, 1220, 320]`，渲染 `{activity:113.2, editor:1165.8}` —— **刚性 60/60 的活动栏叶被渲染成约 113px**。

**成因**：`recalcShellSizes`（`layout.ts` 的 `distributeShellSizes`）对隐藏叶给 0，但 `createShellGrid`（`layout.ts:295`）又用 `clampLeafSize(sizes[id] ?? 0, limits[id])` 把它抬回 min，于是隐藏叶以 320/280px 的意图进入 `shareAxis`；而 `WorkbenchBranch.buildPanels`（`WorkbenchBranch.vue:33-35`）只对**可见** children 归一化。模型、树、渲染三份口径在这里分叉。

**影响**：开关左右栏会连带改变可见列宽（左栏 340 → 373.5），刚性活动栏被放大；`hidden` 也是主页面常规操作（`index.vue` 的 `setLeafVisible`）。副作用还包括：`onLeafResize` 把**呈现像素**增量当**意图**增量写入 store（`WorkbenchShell.vue:151-164` + `WorkbenchBranch.vue:67-70`），树/容器不一致时二者不等价，用户拖 100px 落进 store 的数字不是 100px。

**最小修复方向**：让"不参与排布"的叶在树里以 0 意图 + 0 约束（或直接从树里摘掉）表达——即把 `hidden` 传进 `createShellGrid`，或在建树后按隐藏集合把该叶的意图与上下限一起清零。**不要**在 `WorkbenchBranch` 里对隐藏叶做补偿，那会把产品规则塞回渲染器。

### F3 `editor~right` 手势落到编辑器，Shell 不写 store，下一次重挂回弹

**现象**：右栏 sass 拖动不保存；左栏正常。

**证据**：

- 手势 tracker（真实 `splitter-gesture.ts`，纯内存探针 `evidences/probe-active.ts`）：`editor~right` → `active = ["editor","right"]`；`left~editor` → `active = ["left","editor"]`。
- `WorkbenchBranch.vue:63` 取 `children.findIndex(child => state.active.includes(child.id))` ⇒ 前者选中 `editor`（第一个命中），后者选中 `left`。
- `WorkbenchShell.vue:160-164` 只对 `left`/`right` 写 store，其余落账后立刻 `recalcSizes(false)` 按 store 重建模型与树 ⇒ 拖后模型与树意图都回到拖前（探针：模型拖前 = 拖后 = `{60,340,400,478}`，树意图 `[60,340,478,400]`，store 未变）。
- `state.sash` 已经给出 `editor~right`，信息足够；现在是选集规则丢了它。
- 表现层回弹：reka 在 DOM 里保留已拖动的百分比，任何一次重挂（显隐、视口变化、store 外部改写 → `epoch++`）都会按重建后的树回弹。

**归属**：t37 README 写"手势接线留下一增量"，但当前代码已经把 `@gesture-end` 接了一半——呈现给用户的是"能拖但不落账"。要么先不订阅 `gesture-end`（保持明确的未接线），要么按 sash 侧/`store` backed 叶选集落账。

## 3. 风险与证据缺口（不阻断本轮，但收口前要有结论）

- **F4 验证台测试不在门禁内**：`bun run test app/components/workbench-spike` → `No test files found`（include 列表含 `app/utils/workbench/**`，不含 `app/components/workbench-spike/**`）；`bun run test app/utils/workbench/layout.test.ts app/components/workbench-spike/layout.test.ts` 只跑 1 文件 17 用例。t37/Leader 记录里的"2 文件 21 用例"在当前 run 不可复现。该文件是真实消费者回归，目前不进任何门禁。
- **F5 跨窗口会打断本窗口手势**：`WorkbenchShell.vue:216` 的 `watch([leftPanelWidth, agentPanelWidth]) → recalcSizes(true) → epoch++`，`WorkbenchBranch` 的 `splitterKey` 含 `epoch` ⇒ 重挂 ⇒ `Splitter.vue` 的 `onBeforeUnmount` 取消 pointer 手势并补发 `mouseup`。Spec 验收 6 要求"一个窗口拖动而另一个保存，当前手势不断开"。当前没有 Storage/跨窗口接线，属未验证；接线前需要区分"自己回写"与"外部改写"。
- **F6 同一规则两处维护**：`WorkbenchShell.availableWidth`（`83-91`）的 `activityAdjustment` 与 `createDefaultShellGrid` 的 `SHELL_LEAF_IDS.length - 2` 是"哪些 sash 被 CSS 隐藏"的同一份事实的两份实现，`createShellGrid` 里还有第三份（`sashSize` resolver，`301-305`）。当前 revision 三者数字一致（对照树里呈现与模型逐项相等，这是本轮少见的正面证据）；但隐藏叶组合变化后很容易再次分叉，建议由一处（原语 `sashSizes` 或宿主常量表）驱动。
- **ref 序列化**：`grid-snapshot.ts` 的 `serializeTree` 把 ref 归约为 `String(node.ref)`。当前所有消费者都是字符串 ref，未验证其它；若宿主改用对象引用，往返会塌成 `"[object Object]"`，应在 `GridRefResolver` 边上写明约束（未验证项）。

## 4. 已核对通过（真实命令与结果）

| 命令（cwd） | 结果 |
|---|---|
| `bun run test src/components/layout/grid.test.ts`（`packages/nb-ui`） | exit 0，1 文件 **38 用例** 通过 |
| `bun run test app/utils/workbench/layout.test.ts`（`packages/neuro-book`） | exit 0，1 文件 **17 用例** 通过 |
| 手势 `active` 语义（纯内存探针） | `editor~right` → `["editor","right"]`，`left~editor` → `["left","editor"]` |

下列合同点在本 revision 上按代码可核（有既有用例覆盖，未逐条独立复现）：`layout` 不写回意图（换窄容器再恢复快照不变）、`resize` 单次原子结算并做 residual 补偿、`moveLeaf` 同分支重排不塌陷源分支、失败路径不改树（`tree = originalTree`）、`removeLeaf` 拒绝根分支、交叉轴/约束不相容诊断、`Object.create(null)` 字典 + 特殊 id、v1 拒绝与高版本拒绝、超限快照不进入子树（不调用 resolver）、未知 ref 过滤且分支尺寸意图保留、重复 id 整体拒绝。

## 5. 未运行项与原因

- 不打全包 `typecheck`/build、不启动产品服务、不做浏览器/Product surface 验收：Task 明确排除（并行 t37 改动仍在进行，避免争用；不占用 3001）。
- 因此"所有直接消费者可编译"**未验证**：我只静态核对了 barrel（`src/components/index.ts:42` `export * from "./layout/grid"`、`106-112` Splitter/gesture 类型）与各消费者 import 名一致。F1 是运行时几何缺陷，不依赖 typecheck 结论。
- 真实 reka 拖动与主页面像素未做浏览器验证：F1/F2/F3 是从真实函数（`createGrid`/`createShellGrid`/`recalcShellSizes`/`distributeShellHeights`/`createSplitterGestureTracker`）与真实源码接线推导 + 内存复现；`WorkbenchBranch` 的百分比公式与 `WorkbenchShell` 的落账顺序是按源码逐行复演的（`onGestureEnd`、`availableWidth`、`onLeafResize`、`recalcSizes`），不是挂载组件得到的。这一层"复演"是 F1/F2 数字的唯一近似来源，浏览器验收应在 F1/F2 收口后由授权宿主补做。

## 6. 复现方式

- 探针：`evidences/review-probe.test.ts`（临时放入 `packages/neuro-book/app/utils/workbench/` 运行，跑完已移回本 Task，生产目录无遗留）。命令：`bun run test app/utils/workbench/review-probe.test.ts`（cwd `packages/neuro-book`）。输出：`evidences/t41-probe-hide.md`（含 hash 头）、`evidences/t41-probe-drag.md`。
- 探针自带对照：`withCrossUnbounded` 只放开交叉轴上限，用于把 F1 与 F2 分开。

## 7. 收口清单

1. F1：`createShellGrid` 交叉轴上限改不限（或给出不改原语的理由与 Spec 变更）。
2. F2：隐藏叶在建树时以 0 意图 + 0 约束表达；给出"隐藏 right 后 left 渲染 340 而非 373.5"的回归用例。
3. F3：`editor~right` 手势的落账目标（决定是否本增量接）。
4. F4：把验证台测试纳入门禁，或说明为何不纳入。
5. 收口后重跑 nb-ui 聚焦测试 + 主应用 workbench 聚焦测试，并由 Leader 统一跑全包 typecheck；我按新 hash 追加复核。
