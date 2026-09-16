---
schema: nbook.task/v2
taskId: t37-grid-geometry
role: tasker
---

# 嵌套 grid 的两轴几何与快照

**最终状态：** 实现及留白/类型补修已完成，[t41最终复核](../t41-grid-consumer-review/walkthroughs/review-final.md) 建议合并。下面带时间的反馈均已处理，保留作为历史恢复记录；最新验证以 [核心收口验证](../../storage-core-validation.md) 为准。仅公开API可达的隐藏editor口径差异列为后续集成前需处理项，不影响当前主页的titlebar/left/right切换路径。

**当前唯一未完成项（12:50 Leader核实）：** 最新implementation虽声明完成，但 [消费者最终反馈](walkthroughs/leader-consumer-final-followup.md) 第2项未处理：WorkbenchBranch根仍w-full/h-full且没有layout.sizes对应style，max总量小于父容器时仍被拉满。请只修复此项及回归、更新报告。第1项active传递已完成，不重做数学或其余消费者。当前Leader在运行nb-ui浏览器门禁和主应用typecheck，不要并行运行全包命令。完成后明确这条两叶max100/容器500的呈现尺寸证据。

**正式类型检查反馈（12:53）：** workbench-grid-consumers.test.ts:49/57/58/97/99/105/106/107有TS2532/TS18048，字典尺寸或children索引可能undefined。请在本轮测试修正中处理，运行时断言/明确fixture helper，不用忽略诊断或双重断言。storage-context.test.ts的另一类型错误由Leader机械修复，勿编辑它。产品源码本轮无其它类型诊断。

**恢复入口：** 先读 [最终五项修复](walkthroughs/leader-final-repair.md)。上一轮只完成隐藏叶等部分修复，下列五项尚未闭合，不能复述旧完成报告。仍在同 Task 内修复。

**12:30追加实测：** 中间稿先min后max仍然错误，见 [分配器追加反例](walkthroughs/leader-allocation-followup.md)，available100只分到60。完成前必须验证并修复。

**当前执行交接：** OMP writer PID35152已由Leader停止、exec退出码1，未有并行业务writer。保留它的中间稿，不复原。纯原语44用例通过但漏掉上述两个确定反例；WorkbenchBranch/helper已开始切换，Shell/Spike尚未接完。当前Tasker集中完成这两处数学修复和五项原有范围，使用现有产物避免再次长时间重读。可以编辑components/index.ts机械重导出新增grid类型（t38已退出）；不改Splitter内部。已有Storage核心新提交7a5d04de，不要将HEAD变化当意外冲突。聚焦通过后写实际结果，不运行全包门禁，Leader负责。所有命令绝对worktree cwd。实现报告既有段落为中间稿，完成时重写为最终合同。

**消费者接线复核：** 当前接线新稿的两个缺口见 [消费者最终反馈](walkthroughs/leader-consumer-final-followup.md)，请在最终报告前处理。数值算法已由Leader另跑10000布局+3000合法手势全部通过，无需重复扩大数值审查。

Work：[w00003](../../README.md)；[计划](../../storage-implementation-plan.md)切片3。
合同：[ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)。前两片已提交，浏览器适配为 `70c7168d`。

## 结果与范围

让 nb-ui grid 正确区分分支的外部分配与内部横纵布局，并提供原子、受限的快照恢复。
Task拥有 `packages/nb-ui/src/components/layout/grid*.ts` 及同目录 grid 文档、所有直接受影响的主应用几何/类型消费者与测试。
可以同步修改 WorkbenchBranch 的两轴类型消费，手势接线留下一增量。
可以在 nested-grid Spec 的实现合同节记录新版格式/兼容事实，但保持 capability planned，不能改行为合同。
Splitter.vue、其测试/手势helper/同名文档、组件barrel、UI规范由并行 t38 独占，不编辑。
用户既有 dirty `app/utils/workbench/descriptors{,.test}.ts` 完全排除。主页面 Storage、迁移、标题栏、插件样例留后续。
使用当前 worktree。不开新代理、不联网、不提交/push，不操作真实用户数据。
用户的 `http://localhost:3001/` 已运行，禁止占用、复用、重启或关闭该服务。
若需启动验收宿主，先核对当前 State Root 合同，在系统Temp分配独立State Root/Workspace Root，使用其它空闲端口及隔离浏览器数据目录。

## 实现边界

1. 核对全部 createGrid/GridNode/GridSnapshot 消费者后再改类型。领域无关原语保持无 Vue、浏览器存储、Part 名依赖。
2. 以宽高表达节点与当前约束，分支也有外部分配；主轴约束按和传播、交叉轴按共享空间传播。
   容器分配必须包含实际 sash 占用；兄弟含 branch，触界只吸收可用空间。不可满足约束返回诊断且几何有限非负，总量不溢出。
   容器重排只改变呈现，保留可恢复的用户分配意图；不能因 viewport 夹取而把偏好序列化成新值。
3. API 提供一次分支调整的原子入口，或明确只接受主动节点，避免 Splitter 所有面板差分逐项触发多次兄弟补偿。
   保持现有结构操作的明确支持边界；无效操作不能先移除再失败。不要借此新增任意跨分支布局编辑产品。
4. 新快照格式仅保存稳定结构/引用及用户尺寸意图，不保存运行期约束。恢复以当前宿主约束为准；可通过当前树/宿主解析器提供。
   完整校验后一次发布，限制节点数/深度，拒绝重复 id、非法 children/方向/数值和高版本；未知引用过滤独立报告。
   旧v1无法可靠推导两轴时明确拒绝并由宿主保留原件，不能猜测内部高度当外部宽度。Lab旧键可安全默认但不得自动覆盖旧原件。
   未知引用保留原始快照的合成保存由下一插件宿主Task负责；原语返回足够诊断，不把过滤后的serialize视为无损替代。
5. 同步主应用 layout.ts、WorkbenchShell/Branch、workbench-spike及聚焦测试，避免主应用自己修补原语几何。
   最小可编译增量后就跑聚焦测试，不累积大段未经验证代码。

## 验证与交接

覆盖左右嵌套上下、叶与branch互相吸收、内外轴独立、约束传播、不可满足/窄容器/sash守恒、重复/非法/深层/高版本快照、当前约束恢复、失败前后树不变。
保留结构操作回归与所有受影响消费者测试。按 package.json 运行 nb-ui 聚焦测试；可运行主应用 workbench/layout 与 spike聚焦测试。
并行Task期间不跑全包typecheck/build，主Agent统一执行。最终报告列真实命令、退出码、文件数、用例数和未运行项。
先在 `walkthroughs/implementation.md` 写进行中；15分钟内留下可核查产物，不 sleep。交接须说明 API、快照格式和后续手势/宿主如何消费。
