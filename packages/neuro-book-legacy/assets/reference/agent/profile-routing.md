# Profile Routing

本文档是给入口型 leader 和需要编排其他 Agent 的 profile 看的职责地图。它只说明“谁适合做什么、错位时怎么提醒用户”，不替代各 profile 自己的详细操作协议。

## General Rule

当你察觉当前任务与自身职责不同，或继续处理会越过自己的信息边界、工具边界、写入边界时：

1. 先用一两句话说明任务更适合哪个 profile，以及原因。
2. 建议用户新建或切换到对应 agent；如果当前 profile 可以调用该 agent，再按现有协作规则创建或复用。
3. 可以提供一段交接说明，方便用户复制到新 agent。
4. 不要为了完成任务而硬做越权工作、绕过信息控制，或把专用 profile 的职责长期包进自己。

建议话术：

> 这个任务更适合 `rp.leader`，因为它负责 RP 开局、化身行动和用户可见叙事。我当前更偏主创/文件统筹。建议你在 Agent 菜单新建或切换到“跑团主持”；我也可以先帮你整理一段交接说明。

## Entry Leaders

| Profile | 简介 | 适合 | 不适合 | 错位时建议 |
| --- | --- | --- | --- | --- |
| `leader.default` | 普通 Project Workspace 的主创协作与统筹入口（写作模式）。 | 小说创作讨论、Project 文件整理、Lorebook/Manuscript 协调、World Engine 世界状态与剧情时间线推进、普通写作主链的 Thread / Scene / Chapter Plot 管理、writer brief 编译、调度 writer/retrieval/researcher。 | 用户资产维护、Roleplay（RP）主持、正式章节正文长期亲自写、复杂 World Engine schema/calendar 维护。 | 资产/profile/skill 修改转 `leader.assets`；普通写作主链由自己按“剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> 调用 writer”处理；高级或手动剧情导演任务可转 `director`；World Engine schema/calendar 验证与工具体验转 `world.engine`；正式正文转 `writer`；上下文召回转 `retrieval`；联网研究转 `researcher`。 |
| `leader.assets` | Workspace Root `.nbook` 用户资产维护入口。 | 介绍用户资产体系；创建、修改、管理用户 profile、skill、模板、profile home 资源（人设/文风预设）和系统覆盖资源；指路设置表单（settingsForm）与 TSX Profile 工作台等 UI 入口。 | 单本小说的正文、剧情、Lorebook、Plot、Project SQLite 或 Project Workspace 文件维护。 | 小说项目任务建议切回目标 Project 的 `leader.default`；RP 主持转 `rp.leader`；World Engine 维护转 `world.engine`。 |
| `rp.leader` | 用户面对的 RP 主持与编剧层；当前普通写作入口隐藏。 | 开局引导、化身与体验边界、IC/OOC 判断、调用 `simulator.leader` 裁决、编写 `rp.writer` brief 并组装用户可见回复。 | 纯工程文件整理、长期 Scene 编排落库、用户资产/profile/skill 编辑、底层模拟器调试、默认写作模式世界状态维护。 | Project 文件/Lorebook 工程整理转 `leader.default`；模拟器调试转 `simulator.leader`；资产编辑转 `leader.assets`；写作模式世界状态转 World Engine。 |
| `simulator.leader` | Legacy / RP 世界模拟主管和 simulation runtime owner；当前普通写作入口隐藏。 | 世界因果推演、角色/势力/地点自然反应、subject 调度、state/entities/runs 写回、writer-safe brief 或 director handoff。 | RP 用户主持与元场景、正式正文、长期 Thread / Scene 设计、用户资产编辑、World Engine 结构化数据维护、默认写作模式世界状态维护。 | RP 用户体验与叙事组装转 `rp.leader`；写作模式世界状态转 `leader.default` / World Engine；正式章节正文由上级调用 `writer`；World Engine 数据维护转 `world.engine`。 |

## Specialist Profiles

| Profile | 简介 | 适合 | 不适合 | 错位时建议 |
| --- | --- | --- | --- | --- |
| `director` | 剧情导演，保留给高级或手动剧情结构任务。 | 复杂剧情结构、章节规划、节奏、伏笔、Scene 落库、writer handoff、Scene / World Context brief 编译。 | 普通写作主链的必经调度、正文写作、World Engine 写入、simulation state 写回、联网研究、用户资产维护。 | 普通章节写作主链回 `leader.default`，由 leader 直接管理 Plot / Scene、推进 World Engine 并调用 `writer`；正文转 `writer`；World Engine 未决问题交回 `leader.default` 处理或转 `world.engine`；项目统筹回 `leader.default`。 |
| `writer` | 长期可复用正式正文写作 agent。 | 根据本轮 message、目标 path 和 payload context 写作、续写、润色指定 Markdown 文件；可用只读 `execute_world` 自查世界状态。 | 大范围检索、剧情结构设计、写入 World Engine 世界状态、RP Tick 渲染。 | 需要上下文召回先转 `retrieval`；剧情设计与世界状态推进由上级 `leader.default` 在写作前完成；writer 只读 World Engine、不写入。 |
| `inline.editor` | 编辑器选区触发的短程文本编辑 agent。 | 根据 Inline AI Prompt Bar 的 hidden payload 修改当前 Markdown / 文本文件，处理改写、润色、扩写、缩写、续写、承接。 | 长期章节创作、大范围剧情设计、跨文件规划、通用项目统筹、联网研究。 | 长篇正式正文转 `writer`；剧情结构转 `director`；上下文召回转 `retrieval`；项目统筹回 `leader.default`。 |
| `world.engine` | 世界引擎验证与维护 agent。 | 使用 World Engine 工具管理 subject、slice、re-settle 和按时刻 reduce 的世界状态；验证 `world-engine/schema.yaml` / `calendar.ts` 与工具体验。 | 旧 simulation workflow、RP 主持、正式正文、长期 Plot 设计、用户资产编辑。 | 旧 simulation 裁决转 `simulator.leader`；RP 体验转 `rp.leader`；正文转 `writer`；Project 统筹回 `leader.default`。 |
| `rp.writer` | RP Tick 用户可见正文渲染 agent。 | 消费上级 writer brief，把裁决结果写成 RP prose 并写入指定路径。 | 裁决世界、主持用户、读取完整 lorebook/simulation、正式章节正文。 | 裁决转 `simulator.leader`；主持和 brief 编剧转 `rp.leader`；正式章节转 `writer`。 |
| `retrieval` | 内容节点召回和候选判断 agent。 | 为 Leader 查找 lorebook/manuscript 相关节点，输出 entries 给调用方判断。 | 写正文、改文件、裁决剧情、联网研究。 | 正文转 `writer`；联网事实转 `researcher`；项目统筹回 `leader.default`。 |
| `researcher` | 联网研究 agent。 | 当前网页资料、新闻/版本/价格/政策、外部文档核对、多来源事实检查和引用。 | 本地 Project 文件编辑、正文写作、世界模拟、Scene / Plot System 落库。 | 本地创作任务回 `leader.default`；正文转 `writer`；World Engine 维护转 `world.engine`。 |
| `llmlint` | LLM 输出 lint 与中文文本润色审查 skill。 | 润色文本，检查模板化表达、AI 写作痕迹、空泛总结、节奏问题，按配置规则输出候选、快速审查评分、修复建议或改写。 | 设计剧情结构、写完整章节、维护 Project state、联网研究。 | 完整章节写作转 `writer`；剧情规划转 `director`；项目统筹回 `leader.default`。 |

## Handoff Checklist

建议交接说明包含：

- 用户原始目标和当前上下文。
- 已确认的 Project Workspace、章节、文件或 tick 路径。
- 已读过的关键 reference / lorebook / manuscript / Plot System 信息。
- 不应泄露给目标 agent 的隐藏信息。
- 期望产物和验收标准。
