---
schema: nbook.task/v2
taskId: t55-code-simplify
status: done
updated: 2026-11-23
---

# w00026 的代码深度理顺与简化

## 目标与范围

t49 做完后，用 /simplify 把 w00026 期间 nb-layout、nb-workbench-layout 与应用里布局、拖动相关代码里没用的逻辑、重复与多余的中间状态理顺并简化，顺便审查；行为不变，代码量大时派 Sonnet 子代理分片简化，主会话审 diff、跑验证

合同：行为合同不变（Spec 不改）。公开面（`packages/nb-layout/api/*.api.txt`、插件 SDK 转出的名字）默认冻结，值得改名、删导出的另列交开发者；持久化格式（`GridSnapshot`、`LAYOUT_DOC_VERSION`、布局记录）不动。

## 当前状态

2026-11-23 开工。做法照 `/simplify` 的四个角度（复用、简化、效率、层次），范围是整个 Work 的代码（约 3 万行含测试），一个审查者读不完，改成按模块派：

1. 只读调研（Claude Sonnet，五个模块并行）：nb-layout 核心、nb-layout 的 Vue 层、nb-workbench-layout、工作台的布局与拖动、宿主（Lab 的 nb-layout 场景、nb-story 的 BookFrame 与 book-grid）。每个模块出候选清单（位置、改法、省多少、风险、碰没碰公开面与持久化、守着它的测试）。宿主那一份顺带做 t49 切片 4 到 6 的实现审查（[待确认清单](../../pending-confirmations.md)）。
2. 主会话分拣：过度防御、收益小的不改；写 `plan.md`，交一次计划审查（Claude Sonnet）。
3. 按模块派 Sonnet 在各自的 worktree 里改，现有测试就是判据；主会话审 diff、跑受影响的测试与 e2e（改前先在 master 上跑一份基线）。

五份调研已交回（[`evidences/survey-*.txt`](evidences/)）：真正没有调用方的代码不多，生产代码约 300 到 400 行可删或可合并；更大的收益是同一规则写了几份、热路径上的重复量取和 `NestedGrid.vue` 按层拆开。分拣结果与切片见 [`plan.md`](plan.md)。

开发者 2026-11-23 定（plan 的“公开面与待定”）：nb-layout 那几个没有使用方的公开名字在发布前删掉（切片 S7），0.1.0 等 t55 合入后再发；nb-workbench-layout 的 `showPanelAndInsert`、`splitIntoSections` 删掉；工作台接网格诊断另开 Task。

## 结果

2026-11-23 完成，合入 master（`a11a86cf0`）。七片都由 Claude Sonnet 在各自的 worktree 里改（报告 [`evidences/code-s1.txt`](evidences/code-s1.txt) 到 `code-s7.txt`），主会话审 diff、跑验证；生产代码加测试合计约 100 个文件，净删约 250 行。

- S1 nb-layout 核心：删无调用方的函数与导出，树查找与克隆、矩形工具、分隔条键各只留一份，`moveLeaf` 补规模守卫（Spec 失败 5）并直接在活树上改。
- S2 两个手势会话：试抽公共核心只净省 10 行，按止损整段回退；`resizeBranches` 改成规划通过后整棵换候选树。
- S3 Vue 层：`NestedGrid.vue` 拆出 `useHeldLifted`、`useSashPresentation`、`useGridSwap` 与开发检查（1004 行到 850 行），分隔线的宿主回调每次重算只问一次；删多余的卸载收尾与未用导出，开了 `noUnusedLocals`。
- S4 nb-workbench-layout：标签条整条只读一遍 DOM、键盘停靠点一次快照；删 `showPanelAndInsert`、`splitIntoSections`；入口改显式清单。
- S5 工作台：一次判定只量一次几何；落点键、“已独占一个窗”、视图标签键各一处出处。“区域空了时用哪个容器”改调 `soleContainerOf` 没做：两者对“区域外带容器的记录”结果不同。
- S6 宿主：Lab 验收场景的记录收成对象，nb-story 换边拖动搬成 `detail-swap-drag.ts`。
- S7 公开面（开发者定）：删 `Grid.resize`、`resizeBranch`、`GridGestureSession.setCollapsed`，`live(source)` 去掉恒假的 `keyboard`，`useLiveDragSession` 不再返回 `session`、`live`，根入口不再导出低层积木；`resolveGridInsertion` 随之没有调用方，一并删除。SDK 快照不变。
- 实现审查（S2、S3，Claude Sonnet，[`evidences/impl-review-s23.txt`](evidences/impl-review-s23.txt)）：阻断 0、重要 0、建议 3。改了 `NestedGrid.md` 的措辞；修了 Lab 卡片互拖场景拖完分隔线不重读树（改前就有，补 e2e，变异后失败）；重复 id 那条不改（初始树有重复 id 才出现）。
- Spec：`ui/nested-grid` 输出 153 去掉 `resize`；`ui/layout-drag` 的跟手卡片与帧循环写成包内零件，`live(source)`。

验证：
- 改前基线（master）：应用 20 个 e2e 文件 385 条，加 nb-story 换边 19 条，全过（`lab-tab-strip:41` 单独重跑过）。
- 改后两轮集成 e2e 与 S7 的 6 个文件（95 条）都对照基线：没过的都单独重跑通过；只有 `workbench-float:316` 在 master 上 `--repeat-each=8` 也失败 1 次，算原有偶发。
- 各包单元与 dom 测试、类型检查、`api:check` 在合入后的 master 上重跑通过。

发布：0.1.0 在 t55 合入之前已从 `85e34f4f5` 发出（带 `resize`、`resizeBranch`、`live(source, keyboard)` 等），所以 S7 的删除对已发版本是不兼容的改动，提成 0.2.0（`9df83e25a`，变更记录定稿）。开发者推 master、在 npm 网页认证后本机发布 `@notnotype/nb-layout@0.2.0`；应用与 SDK 的 0.16.0 由 v0.16.0 的标签流水线发，本机发布等它发完才跑，只发了 nb-layout。registry 冒烟通过（[`evidences/registry-smoke-0.2.0.txt`](evidences/registry-smoke-0.2.0.txt)）。nb-story 的网页包随 nb-layout 变了字节，没提版本，留到它下次发布。
