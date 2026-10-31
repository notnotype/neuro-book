---
schema: nbook.work/v1
workId: w00039-novel-writing-plugins
issueId: null
status: active
updated: 2026-10-31
---

# 小说创作插件

## 目标

设计小说创作方面的插件：把 nb-story（读者视角）、旧应用 WorldEngine 与剧情工坊（作者视角）合成一套故事模型，定项目文件结构与模板、可视化设定表单；先发现问题、按先后关系建 Task 逐项讨论，定稿后再实施。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-10-31 | 开发者：nb-story（读者视角）与 WorldEngine、剧情工坊（作者视角）原打算做两套系统，同意尝试合成一套故事模型（t02） |
| 2026-10-31 | 开发者：先做问题发现，像 w00032 一样把讨论项建成 Task，按先后关系逐项讨论（t01） |
| 2026-10-31 | 开发者：一次讨论能一起定下来的 Task 合并成一个；25 个合成 12 个（见讨论顺序） |

## 调研

- [仓库内的现状](research/2026-10-31-repo-survey.md)：nb-story 的两条轴与回档时的表现、旧 WorldEngine 与剧情工坊、旧版设定与人物、旧设计的痛点、新应用的项目与表单现状。

## 讨论顺序

| Task | 讨论什么 | 前置 |
|---|---|---|
| [t02](tasks/t02-story-model/README.md) | 统一故事模型：两个视角、来源层与记录类型（含对象与身份、伏笔与悬念） | — |
| [t26](tasks/t26-evaluation/README.md) | 评测与样本书（回档、平行宇宙题材的样本要在 t04 实验前备好） | t02 |
| [t04](tasks/t04-time-worldlines/README.md) | 故事时间、世界线与随剧情变化的状态（Issue #144） | t02 |
| [t09](tasks/t09-storage/README.md) | 真相源、存储形态与项目文件结构（含系列作品共享世界观） | t02 |
| [t10](tasks/t10-setting-schema/README.md) | 设定类型、schema 与设定表单 | t09 |
| [t06](tasks/t06-knowledge-reveal/README.md) | 揭示计划、一致性检查与试读者 | t02、t04 |
| [t14](tasks/t14-plugin-split/README.md) | 插件切分、包边界与工作台里的形态（含 nb-memory 去留） | t02、t09 |
| [t12](tasks/t12-project-templates/README.md) | 作品的来路：模板新建、旧项目迁移与导入已有作品 | t09、t10 |
| [t16](tasks/t16-plot-workbench-ui/README.md) | 剧情工坊界面与可视化 | t02、t04、t09 |
| [t22](tasks/t22-incremental-extraction/README.md) | 改稿后的增量抽取 | t09 |
| [t19](tasks/t19-writing-workflow/README.md) | 写作流程与内置 Profile | t02、t06 |
| [t20](tasks/t20-agent-tools/README.md) | Agent 工具与写手的上下文 | t04、t10、t14、t19 |

讨论顺序就是依赖顺序。讨论定的事写进各 Task 的 README，实施的切片与分支在讨论完后另定。

2026-10-31 按开发者要求，把一次讨论能一起定下来的 Task 合并，25 个合成 12 个；并入的 Task 搁置，原列的问题原样搬进合并后的 Task，标着原编号：t03、t07 并入 t02；t05 并入 t04；t08 并入 t06；t11、t24 并入 t09；t15 并入 t10；t13、t25 并入 t12；t17 并入 t16；t23 并入 t19；t21 并入 t20；t18 拆开，查看器进工作台的形态并入 t14、试读者并入 t06、抽取触发并入 t22。

## 相关 Work

- [w00024](../w00024-nb-story/README.md)：nb-story，读者视角的来源。
- [w00032](../w00032-agent-integration/README.md)：Agent 底座；工具原则（t04、t14）、Profile（t05）、审批（t06）、History（t13）、Skill（t15）、内置 Profile（t18）都是本 Work 的前提。
- [w00027](../w00027-plugin-platform/README.md)：插件平台与 nb-form。
- [w00025](../w00025-editor/README.md)：编辑器，正文编辑与行内 AI。
- [w00038](../w00038-plugin-distribution/README.md)：插件分发，以后模板经市场分发时用。

## 不在本 Work

- 角色扮演与模拟（旧应用的 simulation、`variable-sdk` 里的好感度一类运行时变量）。
- 导出与排版发布。
- 正文编辑器本身（w00025）与 Agent 底座（w00032）。
