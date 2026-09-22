---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.nested-grid
owners:
  - ui
---

# 工作台与插件的嵌套 grid

## 目标与非目标

主工作台和插件能复用与领域无关的 grid，构造左右分栏中嵌套上下分栏的布局，独立调整、恢复和保存自己的尺寸。
本能力补齐最小嵌套样例暴露的尺寸与恢复边界，不提前重构 World Engine 页面。
任意跨窗口移动、多编辑组的产品能力（组会话与布局存储）、第三方插件运行时及任意结构编辑不在本期范围。

## 术语与参与者

- grid 实例：一个宿主持有的布局树；其节点身份在该实例内唯一。
- 分支：沿横向或纵向分配空间的一组子节点；分支在父布局中的分配尺寸与内部子布局尺寸分别表达。
- 叶：一个内容槽位，具有当前宿主声明的尺寸约束和稳定引用。
- sash：可通过鼠标或键盘操作的分隔条。
- 原语：拥有几何与快照解析的 nb-ui 能力；宿主负责节点引用、持久化地址、版本兼容和恢复投影。

## 输入与前置条件

输入为当前容器宽高、分支方向、叶与分支约束、稳定节点引用及可选版本化快照。
持久化能力由宿主显式传入，依赖 [storage.persistence](../storage/persistence.md)；原语本身不读文件或浏览器存储。
同一插件有多个 grid 时，宿主明确它们共享或独立的恢复地址，不能根据叶子名称隐式合并。

## 输出与可观察行为

- 外层左右分栏的分配不使用内层上下叶的高度总和作为该列宽度；每一轴分别计算尺寸和约束。
- 调整叶与分支相邻的 sash 时，可调整分支的外部分配尺寸；兄弟吸收相应空间，容器总尺寸守恒，包含实际分隔条占用。
- 内层上下调整不改变外层列宽；外层变窄后内部布局按当前约束重算。
- 尺寸触界时只消耗可用空间，不制造负值、非有限数值或超出父容器的累积尺寸；约束无法同时满足时返回可诊断降级结果。
- 鼠标和键盘调整具有开始、更新和结束边界；结束携带主动改变的节点/字段。按键连发不逐帧持久化，释放结束；失焦、Escape、pointercancel、卸载和上下文失效取消。
- 测量、挂载、视口变化、快照恢复与临时显隐不被报告为用户提交；取消手势不提交新的保存意图。
- 逻辑sash保持1 CSS px，fine/coarse热区边距5/15；可见线为居中3px覆盖层，不挤压内容。有效悬停立即显示width→ew-resize、height→ns-resize、同scope双轴→move；连续命中同一获胜scope满250ms后opacity渐显，交汇增减命中不重置计时、不闪烁。
- pointerdown成功和键盘focus-visible立即全亮，active离开线盒仍保持。reduced-motion取消渐变但保留hover延迟。非active仅buttons=0可占hover/cursor，拖View/Editor Tab/选择文本经过热区不得抢光标；退出/失焦/禁用/卸载清临时document cursor与timer。
- pointer按原始baselineBoundary+累计delta求绝对边界；收起/展开只改约束，不以记忆尺寸重锚。低于min−24收起，回到max(min,collapsedSize+24)且容量允许时展开；可行展开区线与指针减grabOffset误差≤1 CSS px。按钮/Enter显式恢复才用restoreSize。
- 每个公共GridRenderer独占scope；hover/capture按composedPath由内向外共用有效命中赢家。最内无命中或禁用才让外层；同scope最多双轴一场，不跨独立scope拼事务。

## 状态与转换

| 状态 | 事件 | 结果 |
|---|---|---|
| 未挂载 / 无快照 | 获得容器尺寸 | 默认布局；不保存 |
| 静止布局 | 用户开始调整 | 捕获当前实例、节点与基线；进入调整中 |
| 调整中 | 用户继续调整 | 更新内存几何与主动改变字段，未结束不持久化 |
| 调整中 | 正常结束 | 提交一次最终意图；保存由宿主负责 |
| 调整中 | 取消、节点撤销或上下文失效 | 停止手势；已产生的提交由原宿主收口，不改写新实例 |
| 任意布局 | 容器 resize / 临时隐藏 | 重新呈现，保留用户已保存的尺寸与偏好 |
| 静止布局 | 恢复兼容快照 | 校验完成后一次发布有效布局；失败不留下半棵树 |
| 键盘Enter按下 | 显式折叠/恢复 | 一次求解、keyup一次commit；重复Enter忽略，本场不混方向/Home/End |
| 键盘方向/Home/End | 同场连续调整 | 冻结baseline，未结束不混Enter；Escape回滚，下一场从发布几何开始 |

## 副作用与数据

原语只改变所属实例的内存状态并报告交互意图，无网络、文件或跨实例副作用。
快照包含恢复所需的稳定引用、结构和用户分配意图，不包含组件实例、DOM、运行代次或存储句柄。
运行期约束来自当前宿主；旧快照中的 min/max 不能覆盖新版宿主约束。
两轴格式的版本与兼容迁移在对应原语实现切片中固定，升级必须保留旧原件；主侧栏的简单尺寸记录不直接依赖整棵树序列化格式。
- 原始baseline在当前bounds内逐兄弟夹取，再按两侧目标总量补偿，整体守恒；显式折叠只改目标兄弟collapsed，其他保持原状态。收起结束不把0/32写成展开意图，主动合法展开尺寸可更新意图。
- `useLayoutExtent`共享clientWidth/clientHeight与ResizeObserver，null表示未挂载、0是真实零；Grid承载盒无padding/border。命中用client rect，pointer delta按冻结的根rect/layout比例转换CSS布局px，不乘DPR；中途scale/extent/结构/context变化取消。
- `useGridLayout`消费grid/extent/contextKey，发布node/layout/revision，结构API后invalidate；同步验证手势后一次resizeBranches，成功再onApplied。通知异常只报issues不反悔几何，自身提交不造成preview自取消；缺grid/extent不接受commit。原语不创建业务树、不保存。
- `resolveGridInsertion`按显式轴/给定成员顺序计算beforeId与指示线；`resolveGridEdgeDrop`保持Editor20%边缘与left/right优先。非有限/零矩形/越界拒绝，不引入DOM/dnd-kit依赖。

## 失败与恢复

畸形 children、重复节点身份、非法方向与非有限尺寸必须返回诊断，不抛出未处理异常或污染已发布布局。
未知高版本拒绝恢复并保留原布局/安全默认；宿主禁止普通保存覆盖原件。
暂时缺少引用时可过滤当前呈现，但宿主保留原始记录，后续调整已知节点不能抹掉未知部分。
部分引用过滤与整体格式非法分别报告；重复身份无法可靠定位时整体拒绝，不任意覆盖同名节点。

## 边界与兼容

本能力补充 [Workbench 外壳](workbench-shell.md) 的布局消费合同。
nb-ui 拥有领域无关的类型、算法和交互边界；主应用/插件拥有约束、快照解释与 Storage 地址。
原语不引用主工作台 Part 名，不依赖 Pinia，不开启 Splitter `autoSaveId` 旁路。
嵌套 sash 的旧限制由本能力覆盖的场景逐项解除；其它未覆盖结构操作继续保留已有限制，不能据一个样例宣称任意布局均已支持。

## 验收与 Smoke

1. Given 左列与右侧上下分栏，When 调整外层 sash，Then 分支和叶均可吸收空间，外层总宽守恒；调整内层 sash 不改变外层宽度。
2. Given 两轴约束与窄容器，When 拖过边界、缩放容器并恢复，Then 几何有限、符合约束或报告明确降级；视口夹取不写回。
3. Given 同名叶分别位于主 grid 与插件 grid，When 调整其中一个并重新挂载，Then 两份记录和恢复尺寸互不影响。
4. Given 鼠标、键盘连发、失焦与取消，When 完成或取消调整，Then 主动提交次数和字段符合合同，程序布局不产生提交。
5. Given 畸形/高版本快照、未知引用、重复身份，When 恢复再保存合法修改，Then 无未捕获异常，当前布局不半更新，原件与未涉及未知部分保留。
6. Given 同项目双标签订阅，When 一个窗口拖动而另一个保存，Then 当前手势不断开，冲突由宿主处理。
7. Given 任一侧的叶，When 按方向拆分并调整新 sash，Then 新分支继承原外部分配、两个子叶按比例分掉原意图，外层另一侧尺寸不变；重复身份、非法比例与节点/深度上限被拒绝且树不变。

本轮 Workbench 容器层另以 `Component Lab --suite workbench-shell` 验证跨 Part Teleport、空 Part 落点与内容/切换器拖放；该验证不把业务主页或 Project 数据当作原语证据。

## 实现合同

当前原语增量采用快照 v2：结构、稳定 id/ref 与叶/分支的两轴意图；运行约束由当前树或宿主引用解析器提供。v1 缺少可靠的两轴信息，整体拒绝且由宿主保留原件。非字符串引用要求显式稳定编码器；未知引用过滤与非法格式分别报告。

分支手势使用完整当前呈现基线与目标的原子入口，Renderer 消费原语给出的有效交互约束及实际 sash。公开消费细节见 [grid API](../../../packages/nb-ui/src/components/layout/grid.md)。原语与 Shell/Spike 的聚焦验证不代表 Storage 插件宿主、未知引用合成保存及真实浏览器验收已闭合；本 capability 保持 planned。

结构操作补齐**拆分叶**：`splitLeaf(targetId, {branchId, orientation, side, leaf, ratio})` 把一个叶原位换成新分支——新分支继承目标的外部分配意图，两个子叶按 `ratio` 分掉目标在新轴上的意图（新轴意图为 0 时两端取统一正权重，均分不塌成 0）。只开放比例、不开放 `size`：否则初始意图会出现两个 authority。`left/top → before`、`right/bottom → after` 的宿主词汇映射留在交互层。节点数与嵌套深度上限由结构操作与快照恢复共用同一判定，拆分失败不改树。

渲染层是 nb-ui 的 `GridRenderer`：每个分支一个 `Splitter`、叶交给插槽，几何只有 CSS px 一种口径（`gridBranchSizesPx` / `buildGridBranchPanels` 只是把布局投影成面板配置）。`GridRenderer` 独占一份 `useSashGesture` 会话：一次按下命中的最多两根轴属于同一场手势，拖动中发布预览布局（子树随父盒实时变化），松手把一次 `GridGestureCommit` 交给宿主的 `onGestureCommit`，由宿主用 `grid.resizeBranches(changes)` 一次原子落账；不再有百分比换算、`resizeBranch` 逐分支提交或 Reka 拖动通道。主工作台宿主与编辑器工作区宿主共用同一份实现。编辑器工作区当前只消费单组（一个叶）路径；真实产品的多编辑组及其会话、存储合同是后续独立能力，不因共用渲染层而成立。

## 证据

- 2026-09-16 开发者在计划审查后回复“可以，优化补充”，同意纳入最小嵌套验证及必要原语修复。
- [ADR 0021](../../../packages/neuro-book/docs/adr/0021-local-storage-persistence.md)。
- [审查记录](../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t21-storage-design-review/walkthroughs/002-plan-completion.md) 包含旧实现的内存探针结果，不是本目标已实现证据。
- 2026-09-20开发者批准共享测量/宿主/落点几何、3px线/250ms显现、scope仲裁与无重锚pointer路径；产品容器固定单轴不削弱通用二维能力。新行为证据尚待实施，不复用历史通过数宣布完成。
