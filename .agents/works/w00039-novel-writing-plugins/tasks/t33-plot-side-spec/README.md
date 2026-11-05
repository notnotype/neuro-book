---
schema: nbook.task/v2
taskId: t33-plot-side-spec
status: active
updated: 2026-11-05
---

# 剧情侧的 Spec

## 目标与范围

把已接受的[剧情侧提案](../../../../../docs/proposals/world-engine-plot-side.md)（[ADR 0041](../../../../../docs/adr/0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md)、[ADR 0042](../../../../../docs/adr/0042-world-engine-worldlines-as-per-line-views.md)、[ADR 0043](../../../../../docs/adr/0043-world-engine-placement-and-telling-orders.md)）写成 Spec：内核 6 份、剧情插件 6 份，在内核分支 `feat/w00039-t29-canon-kernel` 上，分两批各交 omp 审。设计讨论、原型与提案的三轮审查在 [t32](../t32-plot-side/README.md)。

合同：本 Task 交付的就是这些 Spec（都在分支上，`status: planned`）：

| 能力 | Spec | 批 |
|---|---|---|
| `canon.model`（改） | `docs/specs/canon/model.md` | 内核 |
| `canon.components`（改） | `docs/specs/canon/components.md` | 内核 |
| `canon.revisions`（改） | `docs/specs/canon/revisions.md` | 内核 |
| `canon.project`（改） | `docs/specs/canon/project.md` | 内核 |
| `canon.worldlines`（新） | `docs/specs/canon/worldlines.md` | 内核 |
| `canon.time`（新） | `docs/specs/canon/time.md` | 内核 |
| `plot.knowledge` | `docs/specs/plot/knowledge.md` | 剧情插件 |
| `plot.foreshadowing` | `docs/specs/plot/foreshadowing.md` | 剧情插件 |
| `plot.goals` | `docs/specs/plot/goals.md` | 剧情插件 |
| `plot.decisions` | `docs/specs/plot/decisions.md` | 剧情插件 |
| `plot.brief` | `docs/specs/plot/brief.md` | 剧情插件 |
| `plot.checks` | `docs/specs/plot/checks.md` | 剧情插件 |

分支上还没有提案与 ADR 0040–0043（分支在它们之前开出），分支上的 Spec 引用它们时先写纯路径，它们进了分支以后改成链接。

## 已定

| 日期 | 决定 |
|---|---|
| 2026-11-05 | 开发者（t32 记录）：照 t27 的先例新开本 Task；Spec 写在内核分支上、不合并；能力地图 12 份，世界线单独一份；先写内核 6 份、再写剧情插件 6 份，每批交 omp 审；各种上限先按样例简报定缺省值、等 t26 校准；写作指示的存放随 t19、t11，Agent 工具的参数随 t20，Spec 只写剧情插件读进来的输入与对外的读取视图；剧情插件照 canon 插件做成应用里的内置插件，纯计算是否另拆包在实施计划时定 |
| 2026-11-05 | 开发者：nbdev 的操作（关 t32、建本 Task 等）主会话自己做 |

## 当前状态

2026-11-05：
- 两批 Spec 已写完并提交在分支上：内核 055c39223，剧情插件 3cc57998e（顺带让内核的标注可以挂在剧情变更上）。
- 第一轮审查两路 omp 并行：S1（内核）18 条，阻断 3；S2（剧情插件）17 条，阻断 2。核实下来都成立（2 条部分成立），已全部改进 5b2d368a0。报告与逐条归类：
  - [`evidences/spec-review-round1-S1-omp.txt`](evidences/spec-review-round1-S1-omp.txt)
  - [`evidences/spec-review-round1-S2-omp.txt`](evidences/spec-review-round1-S2-omp.txt)
  - [`evidences/spec-review-round1-resolution.txt`](evidences/spec-review-round1-resolution.txt)
- 第二轮（S1b、S2b）在跑，报告在 `.local` 的 `reports/S1b/`、`reports/S2b/`。

待开发者定：还原被子线继承的父线变更时，提案第 7 小节说作者可以“保留并进待处理”，与 11-02 的“有后续依赖时不单独还原”冲突；Spec 暂按 11-02 写（只能连同依赖一起还原，或者不还原）。

## 下一步

1. 第二轮报告回来以后归类、修正，向开发者汇报；同一对象最多三轮，之后仍有实质问题交开发者定。
2. 开发者批准以后，Spec 在分支上定稿；接着写实施计划（另开 Task）。
