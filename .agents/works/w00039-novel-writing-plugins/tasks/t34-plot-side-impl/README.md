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

2026-11-05 经 nbdev 新建；写好 [`plan.md`](plan.md)（总的 6 个阶段，阶段 A 分 8 片写细），开发者同意按它自主推进。下一步：计划审查（快速审查：Claude Opus 为 P1，omp 为 P2 在后台）。

技术选型的初步结论（写进计划前再核实）：
- 标注载荷的校验用 TypeBox 1.x 的 `typebox/schema`（`Check`、`Errors` 直接校验 JSON Schema），nb-canon 已经依赖 TypeBox，不另加库；
- 摘要用内核现有的、由宿主注入的 `digest` 端口（同步 SHA-256），规范的 JSON 用现有的 `stableStringify`（与 RFC 8785 的键序和数的写法一致）。

## 下一步

1. 计划审查，处理后开工 A1。
