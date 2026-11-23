---
schema: nbook.task/v2
taskId: t55-code-simplify
status: active
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

## 下一步

计划审查一轮（Claude Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)）：阻断 0、重要 6、建议 9，全部成立，计划已改（见 plan 的“计划审查”）。在 master 上跑 e2e 基线；S1、S4、S6 并行开工。
