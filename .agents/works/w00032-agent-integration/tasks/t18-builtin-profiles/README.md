---
schema: nbook.task/v2
taskId: t18-builtin-profiles
status: planned
updated: 2026-10-30
---

# 内置 Profile、提示词规范与评测

## 目标与范围

定第一批内置 Profile 与 Skill、提示词写作规范与评测方法（含真实模型的预算与授权）。

来源：需求 19；清单外第 10 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 第一批：建议很少几个（一个主创，加一个生成会话标题的摘要）。
- 提示词写作规范：结构、版本、语言（ADR 0034）。
- 评测方法、真实模型的预算与授权（nb-story 的经验：推理档影响大、渠道不稳）。
- 旧应用的资产（14 个 Profile、17 个 Skill、53 个文风预设）怎样取舍。

## 材料

- [`story/qa.md`](../../../../../docs/specs/story/qa.md)；w00024 t05 的评测
- 旧应用 `packages/neuro-book-legacy/assets/workspace/.nbook/agent/`

## 前置

t05、t12、t15。

## 决定（开发者 2026-10-30）

调研：[旧应用的 Agent 资产、评测做法与临时代理](../../research/2026-10-30-builtin-profiles-survey.md)。

1. 第一批内置 Profile 三个：
   - **主创**：通用写作助手，在项目文件上工作，可以派子代理；保留旧应用“结果导向、不写冗长固定流程”的经验，提示词重写，不搬旧的约 2 万字版本。
   - **会话标题**：tiny 角色，只有收尾工具，第一轮结束后一起生成标题与一句说明（会话列表第二行与顶栏悬停要用，t17 第 3 条随之改）；每次压缩后更新说明（怎样取在实施时定）；用户改过标题后标题不再自动改，说明照常更新。
   - **adhoc（临时代理）**：父 Agent 用初始输入定义角色，任务经 `agent_spawn` 的 `prompt` 传入。工具由 Profile 定义：read、write、edit、grep、glob、shell，不带 todo 与子代理工具。不给 adhoc 指定工具，也不给 `agent_spawn` 加通用的 `tools` 参数。
2. 暂不搬：写手与 53 个文风预设（等设置表单）、研究员（等网页工具插件）、行内编辑（等 w00025 t12）、导演、世界引擎、跑团、模拟、记忆整理（等对应的领域模型）。nb-story 的问答 Profile 由它的插件贡献。
3. 第一版不带内置 Skill：9 个小说写作 Skill 列为候选，有评测后再挑；skill-creator 与 Profile 编写指南在支持用户写 Profile、Skill 时重写为 `docs://` 文档（旧的按 `defineAgentProfile` 写，形状已变）；llmlint 准备退役，不内置。
4. 提示词写作规范写进 `docs/standards/prompts.md`：中文（ADR 0034）；结构用 t20 的模板 helper、分节；写结果与约束，不写冗长的固定流程；不重复工具说明；例子短；改提示词升 Profile 版本；改动行为的提示词附评测结果（评测建起来之后）。
5. 评测优先级不高，以后有时间再做。第一版只做不调模型的结构测试（渲染提示词，断言该有的节与工具绑定）；真实模型 smoke 与质量评测、预算与授权到时再定，做法参照调研第 3 节（固定题集、多次重复、模型裁判看原文、整数门槛、按模型分开报、推理档写死）。
6. adhoc 的结果 schema（推荐，待确认）：放在初始输入里，初始输入为 `{role?, outputSchema?}`；不给 `agent_spawn` 加 `outputSchema`。“结果 schema 是初始输入的函数”作为 `defineProfile` 的通用能力（旧应用的 `dataSchemaFromInitial`），不是 adhoc 的特例，与 t14 决定 20“结果模式由 Profile 声明”一致；schema 随会话头保存，每次 `agent_send` 都认；不合法报 `initial-invalid`。没给 schema 时是自由结果。
7. Workflow 多代理编排可能要自定义工具：开发者的初步方案是 Agent 能定义临时 Profile，记进 [t24](../t24-workflow-integration/README.md)，到 Workflow 的 Work 再讨论。

## 当前状态

讨论完成（开发者 2026-10-30），第 6 条待确认。

## 下一步

实施时按 implementation-planning 写计划：三个 Profile、`prompts.md`、结构测试；`defineProfile` 的“结果 schema 取自初始输入”随 t05 的实现。
