---
schema: nbook.task/v2
taskId: t09-storage
status: planned
updated: 2026-10-31
---

# 真相源与存储形态

## 目标与范围

定设定、剧情、抽取图各自的真相源是文件还是数据库，派生数据放哪、能否重建，以及规模与性能的上限。

合同：讨论 Task，只定设计，行为合同未变；定稿后的 Spec 改动在实施时另定。

前置：t02。

## 要讨论的问题

1. 设定：文件（一条一个 Markdown，字段在 frontmatter）还是数据库。倾向文件：本地优先、可审查、Agent 能 grep、History 能记录。
2. 剧情（场景、剧情线、伏笔、决策）：[项目文件底座](../../../../../docs/proposals/project-file-foundation.md) 定了 `plot://` 虚拟型、数据在数据库，依据是旧 Plot 的形态；设定改文件后这一条要不要改。旧版 World、Plot 选 SQLite 的理由没有查到记录，要先查。
3. 状态变动、知情、揭示计划这类细粒度、量大的记录：文件里怎么放（一个对象一个文件、一章一个文件、一个日志文件），并发写与合并冲突。
4. nb-story 抽取的图：派生数据，放项目里（`.nbook/`）还是插件数据目录；要不要进 Git；能否从正文完全重建（重建要花模型费用）。
5. 规模：百万字、几千条设定、几万条状态变动时打开、查询、对齐的速度；要不要索引、索引放哪。
6. 与 History、外部编辑（bash、文件管理器）、同步的关系：外部改了文件后派生数据怎么失效。

材料：[调研：二、三、六节](../../research/2026-10-31-repo-survey.md)；[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)；[`storage/boundaries.md`](../../../../../docs/specs/storage/boundaries.md)。

## 当前状态

2026-10-31 由 t01 问题发现建为草稿，尚未讨论。

## 下一步

按 Work README 的讨论顺序轮到时讨论；讨论定的事写进本 README 的“当前状态”。
