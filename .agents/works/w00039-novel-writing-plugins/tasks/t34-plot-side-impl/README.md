---
schema: nbook.task/v2
taskId: t34-plot-side-impl
status: planned
updated: 2026-11-05
---

# 剧情侧的实现

## 目标与范围

按开发者 2026-11-05 批准的剧情侧 Spec（[t33](../t33-plot-side-spec/README.md)）实现内核的新机制与剧情插件，在内核分支 `feat/w00039-t29-canon-kernel` 上，开发者允许前不合并进 master。先写实施计划（`plan.md`），开发者确认后分阶段交付。阶段的先后按[剧情侧提案](../../../../../docs/proposals/world-engine-plot-side.md)的待定项 2：条目引用、讲述的位置与标注、在场（后面都依赖）→ 知情与伏笔 → `nb-time` 与时间说法 → 世界线 → 目标与态度、决策与守卫 → 诊断与窄问题的完整一套。

合同：要实现的 Spec（都在分支上，`status: planned`）：

- 内核：`docs/specs/canon/model.md`、`components.md`、`revisions.md`、`project.md` 的新条目，新建的 `worldlines.md`、`time.md`；
- 剧情插件：`docs/specs/plot/knowledge.md`、`foreshadowing.md`、`goals.md`、`decisions.md`、`brief.md`、`checks.md`。

依据：ADR 0041（`docs/adr/0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md`）、0042、0043；t33 的三轮审查证据。

## 当前状态

2026-11-05 经 nbdev 新建。在写实施计划：先由一个只读子代理整理 nb-canon 与 canon 插件的代码地图。

技术选型的初步结论（写进计划前再核实）：
- 标注载荷的校验用 TypeBox 1.x 的 `typebox/schema`（`Check`、`Errors` 直接校验 JSON Schema），nb-canon 已经依赖 TypeBox，不另加库；
- 摘要用内核现有的、由宿主注入的 `digest` 端口（同步 SHA-256），规范的 JSON 用现有的 `stableStringify`（与 RFC 8785 的键序和数的写法一致）。

## 下一步

1. 写 `plan.md`：总的阶段划分，第一阶段（内核的引用、讲述、标注、在场、叙述、决策与作者授权、诊断贡献点、读取输入、格式 2、视图）写到能照着实施；后面各阶段开工前再细化。交开发者确认。
