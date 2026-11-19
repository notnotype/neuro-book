---
schema: nbook.work/v1
workId: w00026-layout-package
issueId: null
status: active
updated: 2026-11-05
---

# 布局工具独立成包

## 目标

把 Grid、Splitter 与拖放落点这类布局工具从 nb-ui 拆成单独的包 `@notnotype/nb-layout`，并用它重做工作台的布局：外壳、视图容器和编辑组合成一棵树，内容改成按矩形摆放在同一层，拖动同时支持落点指示和实时布局两种手感，支持浮动 View 与编辑器标签（应用内做完，操作系统级先验证），并做竖屏手机呈现（验证级）。决定与调研见 [t01](tasks/t01-requirements/README.md)

## 推进顺序

开发者 2026-11-06 要求按 [autonomous-delivery](../../skills/autonomous-delivery/SKILL.md) 推进其余 Task，本该开发者决定的记在[待确认清单](pending-confirmations.md)：

[t07](tasks/t07-single-tree/README.md) 片 7c、片 8 → [t16 统一标签条](tasks/t16-tab-strip/README.md) → [t17 每标签一实例](tasks/t17-per-tab-instance/README.md) → [t19 落点分区](tasks/t19-drop-zones/README.md) → [t08 实时布局](tasks/t08-live-drag/README.md) → [t09 应用内浮动](tasks/t09-in-app-float/README.md) → [t10 资源树拖动](tasks/t10-explorer-drag/README.md) → [t18 动效曲线](tasks/t18-motion-curve/README.md)。

2026-11-07：这条路径走完，都已合入。手感与待确认清单等开发者。

2026-11-07 开发者试用后：[t22 拖动重整](tasks/t22-drag-frame/README.md)（跟手的东西不走渲染，标签条都能实时布局）→ [t21 划过界面 CPU 高](tasks/t21-hover-cpu/README.md)。两个 Task 改同几个文件，t21 排在 t22 切片 1 之后，不并行。

2026-11-09 开发者试用后：[t23 拖动判定照 Trellis](tasks/t23-drop-base/README.md)（来源收起一次、按收起后的布局判，不分的边没有落点，标签条限位排序）。

2026-11-16 开发者同意 t27 计划第 2 稿与 t26 第 2 到 4 件，要求按 autonomous-delivery 推进：[t27 区域入口条与切换动画](tasks/t27-region-entry-strips/README.md) → [t26 深入审查的修复](tasks/t26-layout-deep-review/README.md)（含 `ui/nested-grid` 重写、`ui/workbench-layout` 晋升；nb-layout 做成通用库要先写提案、交开发者看）→ [t14 Splitter 迁移](tasks/t14-splitter-migration/README.md)。

2026-11-17：t27 拆成两个（[待确认清单](pending-confirmations.md)）：[t27](tasks/t27-region-entry-strips/README.md) 留一个容器一张卡片与侧栏切换容器的滚动，右栏与底部面板的入口条拆到 [t28](tasks/t28-panel-entry-strips/README.md)。顺序 t27 → t28 → t26 → t14。

2026-11-17：开发者要求重新设计面板头与分节全部收起的样子，新建 [t29](tasks/t29-panel-head-redesign/README.md)（评审板逐轮定稿）。t28 并成一行的头就是这个面板头，所以 t28 的 nb-layout 两片照常先做，画出入口条的那一片排在 t29 定稿之后；t29 定稿后的实现和 t28 那一片前后挨着做。

2026-11-17：t27 合入 master（`bcc1d3528`），实现审查在后台。

2026-11-18：t28 合入 master（`f8e7bcdaa`），实现审查在后台。t26 拆成三个（[待确认清单](pending-confirmations.md)）：[t26](tasks/t26-layout-deep-review/README.md) 留性能基线与代码修复；Spec 的晋升与重写拆到 [t30](tasks/t30-layout-specs-rewrite/README.md)；通用库的提案拆到 [t31](tasks/t31-general-layout-library/README.md)（交开发者看）。顺序 t26 与 t30 交错（t30 只改文档，在 t26 等 e2e 时做）→ t31 提案 → t14。

2026-11-18：t26 合入 master（`aa8de685e`），实现审查在后台。

2026-11-18：t30 完成（两份布局 Spec 晋升与重写，实现审查处理完）。t31 的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../docs/proposals/nb-layout-general-library.md) 开发者接受，写 [ADR 0054](../../../docs/adr/0054-nb-layout-general-library.md)：分两档做，先做第一档，第二档等改造 nb-story（第一个外部使用方）时做。第一档的顺序：[t33 拆出工作台层](tasks/t33-workbench-layer-split/README.md) → [t34 统一错误](tasks/t34-unified-errors/README.md) → [t35 去掉 nb-ui](tasks/t35-drop-nb-ui/README.md) → [t36 显式入口与小组合函数](tasks/t36-explicit-exports-and-helpers/README.md) → [t37 整理拖动控制器](tasks/t37-drag-controller-tidy/README.md) → [t32 入口菜单的“移到”](tasks/t32-entry-menu-move-to/README.md) → [t14 Splitter 迁移](tasks/t14-splitter-migration/README.md)（在 t35 之后，提案里的第一档第 7 项）。

2026-11-18：[t33](tasks/t33-workbench-layer-split/README.md) 完成：工作台层拆进新包 nb-workbench-layout，合入 master（`f0f1a3bdd`），实现审查 7 条处理完（修正 `246ac1cb8`）。[t34](tasks/t34-unified-errors/README.md) 停下等开发者：计划三轮设计审查后仍有 6 条重要问题，推荐拆成“失败的形状”与“诊断”两个 Task、L2 拆码延后；开发者定之前不推进 t35 及以后。

2026-11-19：开发者同意 t34 的推荐：t34 只做失败的形状，诊断拆到 [t38 诊断的形状、码与只发新增](tasks/t38-grid-diagnostics/README.md)，L2 拆码延后（[待确认清单](pending-confirmations.md)）。第一档的顺序改为 t34 → t38 → t35 → t36 → t37 → t32 → t14。2026-11-19：t36 拆成 t36（显式入口与导出名测试）与 [t39](tasks/t39-layout-helpers-and-starter/README.md)（小组合函数与起步材料），顺序 t35 → t36 → t39 → t37 → t32 → t14（[待确认清单](pending-confirmations.md)）。同日 t39 再拆成 t39（宿主接线）、[t40](tasks/t40-collapse-and-intent-writeback/README.md)（收起展开与意图回写）、[t41](tasks/t41-config-error-reporting/README.md)（拖不动时报错）、[t42](tasks/t42-readme-starter/README.md)（README 起步），顺序 t39 → t40 → t41 → t42 → t37 → t32 → t14。

2026-11-19：[t35](tasks/t35-drop-nb-ui/README.md) 完成：nb-layout 不再依赖 nb-ui，读 `--nb-layout-*` 变量（nb-ui 的 `tokens.css` 桥接主题旧名）、文字经自己的注入点 `@notnotype/nb-layout/text`；合入 master（`fa44828b3`），两轮设计审查与一次实现审查处理完，Spec 晋升前换模型逐句核过。开发服务要重启才读得到新子路径。

2026-11-19：[t36](tasks/t36-explicit-exports-and-helpers/README.md) 完成：nb-layout 四个入口改成一行一个名字的显式清单（根 111、`./vue` 28、`./text` 4、`./locales` 3），内部件不再导出；共用的手势类型改名 `SashGesture*`，SDK 留两个弃用别名；合入 master（`adf6779dd`），设计审查与实现审查处理完，Spec 晋升前换模型核过。

2026-11-19：[t39](tasks/t39-layout-helpers-and-starter/README.md) 完成：`NestedGrid` 发 `extent`，宿主用 `useGridHost` 整包绑上去（`useGridLayout` 降为内部），`useDragSession` 管组件里的拖动会话；工作台与 Lab 的五个网格宿主、三个拖动会话改用它们。合入 master（`a5de33888`，审查修正 `640226453`，晋升补测 `ff277aec6`），两轮设计审查与一次实现审查处理完，Spec 晋升前换模型逐句核过。下一个是 [t40](tasks/t40-collapse-and-intent-writeback/README.md)。

2026-11-19：[t40](tasks/t40-collapse-and-intent-writeback/README.md) 完成：
- 库里加了收起与展开的入口：`Grid.setCollapsed` 只翻收起标记、按分配重排，`useGridHost` 的 `setCollapsed` 会重发布局。
- `restoreSize` 谁收起谁记。
- 分隔条上按 Enter、另一侧吸收不了时不再收起。
- `onApplied` 交出提交之前的布局。
- nb-workbench-layout 的意图回写只留 `applyGestureCommit`、`rebaseForOperation` 两个入口，工作台与三个 Lab 夹具改用它们；Lab 夹具不再写坏被压缩的保留像素节点。
- 合入 master（`4fd43c057`，审查修正 `69debb464`，晋升补测 `169618e8c`）。两轮设计审查（第二轮有 1 条阻断，范围收窄后解决）与一次实现审查都处理完，Spec 晋升前换模型逐句核过。
- 发现了两个别处的问题：
  - 分支之前就有：L1 落账会把被压缩的保留像素节点写坏，修法要改 Enter 的语义，交开发者（[待确认清单](pending-confirmations.md)）；
  - 别的 Work 带进来的：排除 `nbook.agent` 的四个工作台 e2e 因为 `nbook.bots` 起不来，已在本分支修。

下一个是 [t41](tasks/t41-config-error-reporting/README.md)。

2026-11-19：[t41](tasks/t41-config-error-reporting/README.md) 完成：
- nb-layout 加了开发模式开关 `setLayoutDevChecks`（缺省关），应用在只于开发模式加载的模块里打开。
- 打开后检查这些接线错误，每个网格每种警告一次：能拖的边界全是 0 宽；没接或接错提交处理；整包绑定后模板里另写了 `context-key` 或 `:revision`（在手势开始时核对）。
- 合入 master（`5bb0dca27`，审查修正 `e3f183d36`，晋升补测 `3f52c9923`）。设计审查一轮（第 2 稿把检查挪到手势开始处）与实现审查都处理完，Spec 晋升前换模型逐句核过。
- 开发服务里用临时探针走了工作台与 Lab 的网格，零警告。

下一个是 [t42](tasks/t42-readme-starter/README.md)。

2026-11-19：[t42](tasks/t42-readme-starter/README.md) 完成：
- nb-layout 的 README 写成起步：安装、能直接用的例子（与 Lab 的 `starter` 场景同一份，测试核对一字不差）、导出对照表（测试核对名字与入口）、约定七条。
- 新增 `useGridHost`、`useLayoutExtent`、拖动会话三份短文档。
- 随包文档不再引 Spec 的编号，指向仓库别处的链接改成 GitHub 绝对地址。
- 合入 master（`4afd9dcd4`，审查修正 `08ae058d1`）。随包源码注释里的输出编号没清，要清另起 Task。

第一档剩下 [t37](tasks/t37-drag-controller-tidy/README.md) → [t32](tasks/t32-entry-menu-move-to/README.md) → [t14](tasks/t14-splitter-migration/README.md)。

2026-11-19：[t37](tasks/t37-drag-controller-tidy/README.md) 写计划第 1 稿：应用里每场拖动的状态收进一个对象、判定几何与键盘停靠点拆成纯函数并补单元测试；卡片的逐帧步进与帧循环抽进 nb-layout（Spec `ui/layout-drag` 输出 20、21，planned）。设计审查（Claude Sonnet）一轮 8 条都成立，改成第 2 稿：每场的对象不可空、收场换成空闲的一份；卡片做成一张一个对象（`createDragCard`）；帧循环补抛错、时间戳回退与监听次序的合同。

2026-11-19：t37 四片与一处开销用例的等待修正都提交了，收口通过（8 个 e2e 文件 194 条），实现审查（Claude Sonnet）在跑、不阻塞。开始 [t32](tasks/t32-entry-menu-move-to/README.md)：入口菜单的“移到”，照“重置”加两项，底层已有，不做设计审查。

2026-11-19：[t37](tasks/t37-drag-controller-tidy/README.md) 完成：
- 应用里拖动控制器每场一个对象（14 个 `let` 剩 1 个），判定几何与键盘停靠点拆成纯函数、有单元测试；
- nb-layout 加 `createDragCard`、`createFrameLoop` 与短文档，实时布局改用它们，性能对照与基线一致；
- 合入 master（`6cc707752`，审查修正 `2c40fcc9b`，晋升补测 `11ce9d96c`），`ui/layout-drag` 输出 20、21 晋升。
- 顺带修了 `workbench-drag-cost.e2e.ts` 按住不动那条的等待：分支起点上就 3 次挂 2 次（过渡收尾的分隔线对齐那一帧落进了计数）。

2026-11-19：[t32](tasks/t32-entry-menu-move-to/README.md) 完成：入口右键菜单加“移到”另外两个区域（整个容器搬过去），底部面板并成一行的入口在视图菜单末尾接上容器的“移到”（实现审查第 1 条，记进待确认清单）；合入 master（`390b50d35`），Spec 输出 44、47 更新。

第一档剩下 [t14](tasks/t14-splitter-migration/README.md)。

2026-11-19：[t34](tasks/t34-unified-errors/README.md) 完成，合入 master（`6faf07664`，审查修正 `063828e6d`、`8a8407189`）。[t38](tasks/t38-grid-diagnostics/README.md) 计划第 1 稿的设计审查回来了（常规 6 条、拉远看 5 条）。

2026-11-19：[t38](tasks/t38-grid-diagnostics/README.md) 完成，合入 master（`b2a45d357`，审查修正 `c12043db5`、`7d7656755`）。下一个是 t35。

- 发版前（t34、t38 起）：插件 SDK 里 `NestedGrid` 的 `onGestureCommit` 返回类型变了（`reason` 改成 `code`、`message`），`issues` 事件与 `gesture-update` 载荷的诊断从字符串改成对象（t38），下次发布按 [发版手册](../../../docs/standards/releasing.md)第 2 步把 `PLUGIN_API_SINCE` 提到那次发布的版本（变更记录里“不兼容的改动”已写在 `[Unreleased]`：t34、t38 的两条，加 t35 的布局组件 CSS 变量改名一条）。

- [t13 条移到四边](tasks/t13-bars-move/README.md) 搁置（骨架固定之后没有必要）。
- [t11 手机呈现](tasks/t11-phone-layout/README.md)、[t12 操作系统级浮动的验证](tasks/t12-os-window-spike/README.md)、[t14 Splitter 迁移](tasks/t14-splitter-migration/README.md) 这一轮先不做（开发者 2026-11-06；t14 于 2026-11-16 排到 t26 之后）。
- 已知问题（2026-11-18，t26 片 5 验证时发现，master 的 `ba3de16c6` 上同样有）：负载 9 到 10 时，编辑器标签实时布局快速拖到正文右边缘停下，预览有时停在“来源收起”，不换成拆分，松手也没拆（`editor-area.e2e.ts:2171`、`2207`，各重复 6 次约失败 1 次）。从代码推断与“来源收起后指针再动才重判”有关：指针在收起之前就停了。没有排 Task，要修时另建。
- 已知问题（2026-11-19，t40 设计审查发现，分支之前就有）：nb-layout 的 `resizeBranches` 落账时，把被压缩、这次没动的保留像素节点的意图写成压缩值，窄窗口里经分隔条 Enter 收起一块面板，放宽后旁边那块永久少一截。工作台不受影响（回写经 L2 的 `frozen`）。修法要改 Enter 的语义，交开发者定（[待确认清单](pending-confirmations.md)），没有排 Task。
- 已知问题（2026-11-18，t30 实现审查第 10 条，分支之前就有）：nb-layout 的结构操作与快照恢复对 16 层深度的计法差一层：结构操作把根算第 1 层，恢复从 0 数起，17 层的快照能恢复、恢复后连拆分都被拒，18 层才被恢复拒绝。改恢复的阈值前要先定已能读到的 17 层快照怎么办。没有排 Task。

## 后续

- 插件 SDK 只导出 `NestedGrid` 组件，不导出 `createGrid` 与宿主工具，插件建不出网格（t39 设计审查第 9 条）。要不要给插件开放网格宿主（`createGrid`、`useGridHost` 一起，放哪个子路径、兼容承诺多大）另行决定。
