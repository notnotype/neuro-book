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
| 2026-11-05 | 开发者（“按你推荐的来”）：还原照 11-02 的“有后续依赖时不单独还原”，跨线也一样（连同依赖一起还原，或不还原）；提案第 7 小节说的“保留并进待处理”，由撤销那条剧情变更来做：撤销不挡写入，子线上因此算不出来的记录各成待处理。写进 `canon/worldlines.md` 输出 11 与场景 8（分支 519d65056） |

## 当前状态

2026-11-05：
- 两批 Spec 已写完并提交在分支上：内核 055c39223，剧情插件 3cc57998e（顺带让内核的标注可以挂在剧情变更上）。
- 第一轮审查两路 omp 并行：S1（内核）18 条，阻断 3；S2（剧情插件）17 条，阻断 2。核实下来都成立（2 条部分成立），已全部改进 5b2d368a0。报告与逐条归类：
  - [`evidences/spec-review-round1-S1-omp.txt`](evidences/spec-review-round1-S1-omp.txt)
  - [`evidences/spec-review-round1-S2-omp.txt`](evidences/spec-review-round1-S2-omp.txt)
  - [`evidences/spec-review-round1-resolution.txt`](evidences/spec-review-round1-resolution.txt)
- 第二轮：S1b（内核，omp）核完第一轮 18 条、写出 19、20 后因上游额度用完退出，剩下的改派 Claude Opus（S1c，21 到 41）；S2b（剧情插件，omp）有效 8 条。共 31 条，阻断 2（19、S2b 23），都成立，已改进 2a8a2a99d。报告与归类：`evidences/spec-review-round2-*`（[归类](evidences/spec-review-round2-resolution.txt)）。
- 第三轮（最后一轮，两个 Claude Opus 子代理）：S3a（内核）15 条、S3b（剧情插件）12 条，没有阻断，都成立，已改进 ad3d802c1。报告与归类：`evidences/spec-review-round3-*`（[归类](evidences/spec-review-round3-resolution.txt)）。三轮已满，本轮修正没有再经独立审查；等开发者批准 Spec。


## 下一步

1. 开发者看过以后批准 Spec（分支上，`planned`）。
2. 接着写实施计划（另开 Task）：按提案的实施先后分阶段；计划审查与合同测试兜底本轮没有再审的修正。
