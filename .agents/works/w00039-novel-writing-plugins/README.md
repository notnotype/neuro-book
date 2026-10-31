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

## 调研

- [仓库内的现状](research/2026-10-31-repo-survey.md)：nb-story 的两条轴与回档时的表现、旧 WorldEngine 与剧情工坊、旧版设定与人物、旧设计的痛点、新应用的项目与表单现状。

## 讨论顺序

| Task | 讨论什么 | 前置 |
|---|---|---|
| [t02](tasks/t02-story-model/README.md) | 统一故事模型：两个视角与三个来源层 | — |
| [t03](tasks/t03-identity-references/README.md) | 对象、身份与引用 | t02 |
| [t04](tasks/t04-time-worldlines/README.md) | 故事时间与世界线（Issue #144） | t02 |
| [t05](tasks/t05-changing-state/README.md) | 随剧情变化的状态 | t02、t04 |
| [t06](tasks/t06-knowledge-reveal/README.md) | 秘密、知情与揭示计划 | t02、t04 |
| [t07](tasks/t07-promises-questions/README.md) | 伏笔与悬念 | t02 |
| [t08](tasks/t08-alignment-checks/README.md) | 三层对齐与一致性检查 | t02 到 t07 |
| [t09](tasks/t09-storage/README.md) | 真相源与存储形态 | t02 |
| [t10](tasks/t10-setting-schema/README.md) | 设定类型与 schema 演进 | t09 |
| [t11](tasks/t11-project-layout/README.md) | 项目文件结构 | t09、t10 |
| [t12](tasks/t12-project-templates/README.md) | 项目模板 | t10、t11 |
| [t13](tasks/t13-legacy-migration/README.md) | 旧项目迁移 | t09、t11 |
| [t14](tasks/t14-plugin-split/README.md) | 插件切分、包边界与 nb-memory 去留 | t02、t09 |
| [t15](tasks/t15-setting-forms/README.md) | 设定表单与设定库界面 | t10、t11 |
| [t16](tasks/t16-plot-workbench-ui/README.md) | 剧情工坊界面 | t06、t07、t09 |
| [t17](tasks/t17-visualization/README.md) | 关系、时间线与世界线的可视化 | t04、t05 |
| [t18](tasks/t18-story-viewer-in-workbench/README.md) | 剧情图谱进工作台与试读者 | t02、t14 |
| [t19](tasks/t19-writing-workflow/README.md) | 写作流程 | t02 到 t08 |
| [t20](tasks/t20-agent-tools/README.md) | 小说创作的 Agent 工具 | t02 到 t10、t14 |
| [t21](tasks/t21-writer-context/README.md) | 写手的上下文：章级 brief 与检索 | t06、t16、t20 |
| [t22](tasks/t22-incremental-extraction/README.md) | 改稿后的增量抽取 | t09、t18 |
| [t23](tasks/t23-profiles-skills/README.md) | 小说创作的内置 Profile 与 Skill | t19、t20、t21 |
| [t24](tasks/t24-shared-world/README.md) | 系列作品与共享世界观 | t09、t11 |
| [t25](tasks/t25-import-existing/README.md) | 导入已有作品：续写与同人 | t02、t09 |
| [t26](tasks/t26-evaluation/README.md) | 评测与样本书 | t02 |

讨论顺序就是依赖顺序；t26 的样本书（回档或平行宇宙题材）要在 t04 做实验之前备好。讨论定的事写进各 Task 的 README，实施的切片与分支在讨论完后另定。

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
