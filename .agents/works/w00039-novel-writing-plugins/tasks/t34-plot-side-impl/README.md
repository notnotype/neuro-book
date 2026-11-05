---
schema: nbook.task/v2
taskId: t34-plot-side-impl
status: active
updated: 2026-11-05
---

# 剧情侧的实现

## 目标与范围

按开发者 2026-11-05 批准的剧情侧 Spec（[t33](../t33-plot-side-spec/README.md)）实现内核的新机制与剧情插件，在内核分支 `feat/w00039-t29-canon-kernel` 上，开发者允许前不合并进 master。先写实施计划（`plan.md`），开发者确认后分阶段交付。阶段的先后按[剧情侧提案](../../../../../docs/proposals/world-engine-plot-side.md)的待定项 2：条目引用、讲述的位置与标注、在场（后面都依赖）→ 知情与伏笔 → `nb-time` 与时间说法 → 世界线 → 目标与态度、决策与守卫 → 诊断与窄问题的完整一套。

合同：要实现的 Spec（都在分支上，`status: planned`）：

- 内核：`docs/specs/canon/model.md`、`components.md`、`revisions.md`、`project.md` 的新条目，新建的 `worldlines.md`、`time.md`；
- 剧情插件：`docs/specs/plot/knowledge.md`、`foreshadowing.md`、`goals.md`、`decisions.md`、`brief.md`、`checks.md`。

依据：ADR 0041（`docs/adr/0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md`）、0042、0043；t33 的三轮审查证据。

## 已定

| 日期 | 决定 |
|---|---|
| 2026-11-05 | 开发者看过计划要点（“可以，使用 /autonomous-delivery 推进”）：照 [`plan.md`](plan.md) 推进；阶段 A 的 8 片与实现审查一路做完，本该开发者确认的点记进 Work 的[待确认清单](../../pending-confirmations.md)；后续阶段开工前补细计划并审查；主会话写代码；审查在 omp 额度恢复前派 Claude Opus 子代理；在内核分支上，不合并、不 push |
| 2026-11-05 | 开发者：omp 有回退链，可以继续用；本次计划审查用快速审查：Claude Opus 的结论处理完就开工，omp 在后台继续，它的报告回来后单独处理 |

## 当前状态

2026-11-05：
- 计划第二版（处理计划审查 P1 的 17 条，[`evidences/plan-review-P1-resolution.txt`](evidences/plan-review-P1-resolution.txt)）；P2（omp）在后台。
- 阶段 A：
  - A1 已提交（分支 26e40e341）：日志格式 2；未决问题改成决策；讲述的 id（程序发、全局不复用）与按来源的形状校验，只查新写或改过的讲述；修订里按路径声明哪些数组按 id 拆；列表末尾的追加互不依赖。nb-canon 248 个测试、canon 插件 8 个测试通过，两个包类型检查通过。
  - A2 已提交（e2bb03c3e）：服务持有正文快照（打开时读一次，`textChanged` 只重读那一章，canon 插件在章节文件变化时调它）；读取结果带世界版本、正文快照与读取输入的摘要，游标绑定读取输入；`canonicalJson`（RFC 8785，遇到非法值抛错）。nb-canon 257 个测试、canon 插件 8 个测试通过。章节文件的监视在 A9 补一条插件层的测试。

## 下一步

1. A3：引用与替换（两份清单、修订存 `refs`）。
