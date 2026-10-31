---
schema: nbook.task/v2
taskId: t13-legacy-migration
status: planned
updated: 2026-10-31
---

# 旧项目迁移

## 目标与范围

定旧应用的作品（`lorebook/`、`manuscript/`、`.nbook/project.sqlite` 里的 Plot 与 World）要不要迁、怎么迁。

合同：讨论 Task，只定设计，行为合同未变；定稿后的 Spec 改动在实施时另定。

前置：t09、t11。

## 要讨论的问题

1. 迁不迁：有多少用户、多少旧作品；只迁正文与设定，还是连剧情、世界状态一起迁。
2. 怎么迁：一次性迁移脚本（项目文件底座定的做法），还是导入向导；失败与回滚（备份）。
3. 旧 frontmatter（`retrieval`、`governance`、`ext`、相对路径 `refs`）的去向。
4. 旧 World 的切面与 patch、Plot 的两棵树、伏笔与决策映射到新模型的规则；映射不了的怎么保留。

材料：[调研：二到五节](../../research/2026-10-31-repo-survey.md)。

## 当前状态

2026-10-31 由 t01 问题发现建为草稿，尚未讨论。

## 下一步

按 Work README 的讨论顺序轮到时讨论；讨论定的事写进本 README 的“当前状态”。
