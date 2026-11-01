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
| 2026-10-31 | 开发者：合并 nb-story 与 WorldEngine 暂不定，合起来会非常复杂。先从作者视角、借鉴 nb-story 的经验重新设计一个 WorldEngine，做出来后再考虑合并；先列作者与 Agent 写作时需要哪些能力（从“设定存哪里”开始）。前面“同意尝试合成一套”一条就此搁置 |
| 2026-11-01 | 开发者：没有无限上下文，结构化数据仍然需要；即使上下文无限，作者记不住全书，也需要整理好的视图 |
| 2026-11-01 | 开发者：骨架用事件溯源（回到 WorldEngine 的思路，范围扩大），把设定、剧情、情节统一成一个系统：剧情变更日志的每条是一个 diff 加描述（凭证），计划是还没写的变更 |
| 2026-11-01 | 开发者：作者通过 NeuroBook 界面操作，不直接编辑 lorebook 文件夹；直接读写文件暂时只留给 Agent。Agent 可以写作者的文件，作者自己的修改也记 diff，不限制死 |
| 2026-11-01 | 开发者：条目由主 MDX 加一份随剧情变化的状态数据组成（不一定用 JSON 存，数据多可以用数据库）；Component 在状态里申请命名空间；主 MDX 也能打补丁；不用 Component 的条目（例如灵魂宝石）只有主 MDX。经历不进主 MDX，用检索查 |
| 2026-11-01 | 开发者：Component 不提供插进别的 MDX 的视图，各自的界面放在自己的 Tab 里，用 Vue 写；作者也能直接看 MDX 渲染出的文字。以后有实际需求再考虑嵌入 |
| 2026-11-01 | 开发者：Component 的用法说明不随每次查询重复给出，改为首次出现、隔一定 token 或压缩之后以提醒的方式给 |
| 2026-11-01 | 开发者：地图拆成地点 Component（挂在英国、房间这类条目上，带 `place.within`）与地图 Component（从所有地点条目收集，带地图图片），即分布式数据加集中视图；Agent 怎么读地图暂不细化 |
| 2026-11-01 | 开发者：给 Agent 的渲染用 `{路径 = 值}` 的带值写法，认可；能不能做好在实现审查时专门查 |
| 2026-11-01 | 开发者：关系的方向没有问题（多值、各有状态的存成集中的边，单值的存成字段；知情参考 nb-story），具体怎么做、怎么存以后再定，这里只用来验证内核架构。关系、地图两个 Component 第一版不做，先做核心内核 |

## 调研

- [仓库内的现状](research/2026-10-31-repo-survey.md)：nb-story 的两条轴与回档时的表现、旧 WorldEngine 与剧情工坊、旧版设定与人物、旧设计的痛点、新应用的项目与表单现状。
- [作者视角的领域分析（第一轮）](research/2026-11-01-author-domain-analysis.md)：术语与三条时间轴、创作由哪些操作组成、设定怎么变、作者维护什么、作者的话拆成哪些维度、故事种子与手记、第一章大纲的分发、跑团的启示、文件引用状态的问题。

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
