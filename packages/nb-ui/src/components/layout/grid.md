# 嵌套 grid

`createGrid` 管理领域无关的两轴布局树。节点 `size` 是分配意图，分支的外部分配与内部子布局各自独立；`layout({width, height})` 只计算呈现，不回写快照。

## 几何与手势

`layout` 返回每个节点的 `sizes`、有效交互 `constraints`、每条分隔条的 `sashSizes` 和 `issues`。Renderer 同时消费这三份几何数据；不可满足的窄容器已经降级，不能再用原始 min/max 把面板夹回溢出。

`resizeBranch(branchId, axis, baseline, target)` 一次提交同一分支全部直接子节点的当前呈现 px。基线和目标均不包含 sash；两者必须覆盖相同子节点、有限非负、总量相等，基线必须符合当前树，目标必须符合当前约束。过期基线、越界目标或无法反解时返回失败且树不变。

原语按未触界节点的呈现比例反解尺寸意图。当前 min/max 约束呈现像素，不能直接夹取反解后的比例权重；仍能呈现目标的兄弟保留原意图。无变化的手势保持快照逐值不变。所有节点都触界或权重为零时以现有总量选择权重单位，再重新布局验证目标后一次发布。

`resize(id, axis, delta)` 保留为意图单位的单节点入口，兄弟共同吸收可用增量。用户手势携带的是当前呈现 px，应使用 `resizeBranch`，不能逐个面板调用 `resize`。
恢复的意图可能超出当前约束；旧单节点 `resize` 会向当前范围归一，意图总量可能下调，不能把它用于需要保留越界偏好的呈现手势。`resizeBranch` 的 no-op 则保留原意图。

宿主保存手势开始时的布局；上下文或容器变化后应取消旧手势。`Splitter` 的结束事件提供完整百分比尺寸及主动节点列表，宿主把完整尺寸换成 px 提交一次，再按自身产品规则保存主动偏好。取消、挂载、测量和窗口变化不保存意图。

拖动求解（`sash-drag`）只读冻结的按下基线：指针位移是**相对按下位置的绝对总量**，理想边界 = `baselineBoundary + deltaPx`，吸附与展开只改约束状态、不用记忆尺寸重锚几何，因此同一个指针位置永远对应同一个状态，过冲不会留下永久偏移。分配前先把每个兄弟夹进它当前的 bounds 再按两侧目标总量补偿，结果逐叶合法且全分支守恒；约束装不下总量时给诊断并保持基线，不产出半更新。收起判定同样只看理想尺寸：低于 `minimum − collapseThreshold` 吸附到 `collapsedSize`，回到 `max(minimum, collapsedSize + expandThreshold)` 且容量允许时展开（用理想边界）；记忆的 `restoreSize` 只服务按钮 / `Enter` 的显式恢复。会话提交的就是最后发布的那份几何，`finish` 不拿最后一次位移重解。

## 拆分叶

`splitLeaf(targetId, split)` 把一个叶原位拆成新分支：新分支继承目标叶的外部分配意图，目标叶与新叶按 `ratio` 分掉**目标在新轴上的意图**——新轴意图为 0 时两端取同一正权重，均分不会塌成 0。参数只有 `ratio`，不开放 `size`：否则初始意图会有两个 authority，测得的 px 还会被当成权重。

`split` 用几何词汇表达位置与方向：`orientation` 是分配轴，`side` 是 `before`（左/上）或 `after`（右/下）；`left/top → before`、`right/bottom → after` 的宿主词汇映射留在交互层。新分支与新叶的 id 由宿主保证唯一；未知目标、非叶目标、重复 id、非法比例、超过 256 节点或 16 层深度都失败且不改树。删除与移动继续复用 `removeLeaf` / `moveLeaf`，手势提交继续复用 `resizeBranch`。

## 渲染与投影

`GridRenderer` 把树递归渲染成 `Splitter`：每个分支一个 Splitter、叶交给 `leaf` 插槽。几何只有 px 一种口径——`gridBranchSizesPx` 取布局呈现、`buildGridBranchPanels` 把呈现与有效约束投影成面板配置，两者都只是薄投影，数值算法在 `grid-geometry` / `sash-drag`。`GridRenderer` 独占一份 `useSashGesture` 会话：拖动中发布 `preview`（渲染层整棵子树跟随父盒），松手把一次 `GridGestureCommit` 交给宿主的 `onGestureCommit`，由宿主用 `resizeBranches` 原子落账。

## 快照与引用

v2 快照只保存结构、方向、稳定 id/ref 和两轴尺寸意图，不保存运行约束。恢复先完整校验，再一次发布；当前树或 `resolveRef` 提供当前约束。未知引用过滤结果单独报告，宿主保留原记录；过滤后的 `serialize()` 不是无损替代。

字符串 ref 默认原样编码；对象等非字符串 ref 必须在 `createGrid` options 中提供 `encodeRef: (ref) => string`，并由恢复解析器把该稳定 key 还原为对象。编码器须给不同身份分配稳定且可区分的非空 key；原语不使用 `String(object)` 推测身份。

v1 无法可靠推导两轴意图，明确拒绝；未知高版本、重复 id、非法方向/尺寸/children、超过 256 节点或 16 层深度也整体拒绝。宿主保留原件并禁止自动保存默认布局覆盖它。

结构操作：`addLeaf` / `removeLeaf` / `moveLeaf` / `splitLeaf`；同分支重排不触发塌陷，跨分支操作先在候选树中完成再发布。失败不留下被移除的半棵树，也不改快照。

`find(id)` 是只读查找（宿主读身份与意图用）；改动仍走结构操作，直接改写节点会绕过守恒与规模判定。

行为目标见 [ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)，当前能力仍为 planned，产品持久化宿主和完整浏览器验收另行闭合。
