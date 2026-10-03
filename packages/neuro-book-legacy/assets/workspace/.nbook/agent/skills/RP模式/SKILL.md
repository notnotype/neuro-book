---
name: RP模式
description: 用于用户想进入 NeuroBook RP 模式、启动 rp.leader、理解 rp.leader / simulator.leader / simulator.actor / rp.writer Tick 流程，或让当前 session 临时按 RP 协议工作。
when_to_use:
  - 用户说进入 RP、开始 roleplay、跑角色扮演、用引导者带剧情、和角色互动
  - 用户询问 rp.leader、simulator.leader、simulator.actor、rp.writer、simulation、subject memory 或 RP 模式怎么用
---

# RP模式

用于把当前 Project Workspace 切到 RP 优先的运行方式。普通用户入口优先使用 `rp.leader`；`simulator.leader` 是世界模拟和裁决内核，不直接承担用户交流入口。

## 前置检查

- 当前 Project Workspace 必须存在 `project.yaml`。
- 当前 Project Workspace 应存在 `manual/README.md`、`manual/player-guide/README.md`、`manual/player-guide/character-creation.md`、`manual/gm-guide.md`、`agents/rp.leader/context.md`、`agents/simulator.leader/context.md` 与 `simulation/subjects/*`；`agents/rp.writer/context.md` 可作为上级构造 writer brief 时读取的写作偏好，不是 `rp.writer` 的 profile input。
- `simulation/` 只保存 runtime state：`subjects/`、`entities/`、`runs/`。profile 专用说明放在 `agents/{profile}/context.md`，不要再创建或依赖旧 `simulation/config.yaml`、`simulation/cast.yaml`、`simulation/simulator.md`、`simulation/writer.md`。
- 如果缺少 `manual/`、`simulation/` 或 `agents/` 默认文件，重新用默认 Project 模板创建项目，或手工从 `assets/workspace/.nbook/templates/project-directory-templates/` 补齐缺失文件。
- 如果用户要从 SillyTavern 卡进入 RP，先使用 `novel-import-silly-tavern-card` 完成 `inspect -> unpack -> import`。动态机制归档在 `reference/silly-tavern/...`，后续再人工迁移到 `manual/`、`agents/` 或 `simulation/`（legacy emulation skill 已归档到仓库 `docs/archived/skills/`，需要时按其文档手动执行）。

## 启动方式

优先选择以下入口：

1. 新建或切换到 `rp.leader` 会话。它读取 `manual/` 与 `agents/rp.leader/`，负责开局引导、体验边界、陪伴交流、化身创建和用户可见回复。
2. 如果当前 session 暂时不能切换 profile，可就地按本 skill 的 RP 协议工作。第一版只通过 prompt/skill 约束当前 session，不修改 session `profileKey`。
3. 调试世界模拟时才直接进入 `simulator.leader`。普通开局和继续体验不要绕过 `rp.leader`。

## rp.leader 流程

1. 读取 Project `AGENTS.md`、`manual/README.md`、`manual/player-guide/README.md`、`manual/player-guide/character-creation.md`、`manual/gm-guide.md`、`agents/rp.leader/context.md` 与 `agents/rp.leader/memory.md`。
2. 确认用户要使用默认化身、调整默认化身，还是自定义化身。用户已明确选择时直接推进。
3. 默认化身开局：跳过创建阶段的额外世界观披露，读取 `manual/player-guide/playable-characters/` 的当前入口并准备第一幕。
4. 自定义化身开局：按 `manual/player-guide/character-creation.md` 引导身份、外观、来历、能力表现、随身物、初始关系、已知信息和第一幕氛围；只披露创建所需信息。
5. 第一个 Tick 前写开场白：具体地点、可感知环境、迫近问题、相关人物和自然选择点。
6. 需要建立 run、subject、位置、物品、隐藏状态或裁决世界变化时，创建或复用 `simulator.leader`。

## Tick 流程

Tick 是 RP 的最小推进单位，采用 5e 式基础循环的领域化建模：

1. `rp.leader` 描述化身可感知处境：在哪里、周围有什么、谁在场、压力是什么、有哪些自然行动入口。
2. 用户说明化身要做什么：行动、台词、意图、试探、观察或 meta 偏好。
3. 简单且无风险的行动由 `rp.leader` 直接推进；结果不确定且失败有意义代价时，交给 `simulator.leader`。
4. `simulator.leader` 读取必要 lorebook、Plot、subject/entity state 和当前 run，过滤 actor-facing packet 后调用 `simulator.actor`。
5. `simulator.actor` 返回 subject 视角反应；旁路按需维护自己的 `events.jsonl`、`memory.jsonl` 与 `mind.md`。
6. `simulator.leader` 综合规则、环境、subject response 和 hidden state，裁决真实世界结果，并写入允许提交的 `state.md`、`simulation/entities/*` 和 `simulation/runs/*`。
7. 需要正文渲染时，`simulator.leader` 构造 writer-safe brief 并调用 `rp.writer`。
8. `rp.leader` 把裁决结果整理成用户可继续行动的回复：世界回应、后果、可感知线索和新的选择点。

如果 Tick 需要落盘，第一版优先写入 `simulation/runs/ticks/{id}-{slug}/report.md` 和 `prose.md`。`report.md` 保存后台裁决、状态提交、信息边界和 writer-safe brief；`prose.md` 保存 `rp.writer` 或 leader 输出给用户的完整正文。`input.md`、actor packets、tool log 等机械产物后续可由 workflow/runtime 自动生成，不要求手写。

## 裁决原则

- 从小范围开始：开场优先落在具体地点、当下压力、关键人物和两到四个自然入口，不要一次性展开完整世界史。
- 只在结果不确定且失败有意义代价时裁决；明显可行、无冲突、无代价的行动可以直接成功。
- 失败要改变处境：失败、部分成功和成功但有代价都应带来新的信息、时间成本、关系变化、资源压力或风险升级。
- 观察用户偏好并调整节奏：代入、探索、主动惹事、战斗、构筑优化、解谜、叙事共创和陪伴闲聊都可以成立。
- `manual/reference.md` 作为快速确认入口；需要稳定 canon 或完整规则时再追溯 `lorebook/`。

## 边界

- `rp.leader` 是用户面对的 RP 引导层；它不静默把 meta 讨论、撒娇、吐槽、创作脑洞或引导建议写成 canon、state 或 Plot。
- `simulator.leader` 是世界模拟和裁决内核，可写入 subject `state.md`、`simulation/entities/*` 和必要的 `simulation/runs/*`。
- `simulator.actor` 是 subject simulator；主扮演阶段不读取完整 `simulation/`、`lorebook/`、`reference/` 或其他 subject 文件。
- `simulator.actor` 的旁路可以维护自己的 `events.jsonl`、`memory.jsonl` 与 `mind.md`；`state.md` 与 `entities` 由 `simulator.leader` 裁决。
- `rp.writer` profile input 为空，只消费上级注入的 writer brief。若需要使用 `agents/rp.writer/context.md` 中的写作偏好，由 `rp.leader` 或 `simulator.leader` 先读取并写进 brief；`rp.writer` 自身不自主遍历 `simulation/`、`lorebook/`、`manual/` 或 `agents/`。
- 第一版不做持久化 session 记忆，不实现完整变量系统。

## 信息控制模型

- `lorebook/` 保存原型、规则和全知设定。
- `simulation/subjects/{id}/events.jsonl` 保存该 subject 怎么经历或获知信息。
- `simulation/subjects/{id}/memory.jsonl` 保存该 subject 已知、相信、误解、态度或关系判断。
- `simulation/subjects/{id}/state.md` 保存裁决后的当前状态快照。
- `simulation/subjects/{id}/mind.md` 保存当前想法、判断、犹豫、情绪或动机。
- `simulation/entities/{entity-id}/` 保存需要状态追踪的真实实例，例如被下毒的血药、世界之心碎片、门锁或唯一道具。

普通可堆叠物品不需要实例化，可以在 subject `state.md` 中用 `prototype + quantity` 记录。特殊、隐藏状态、唯一或被改造的实例才进入 `simulation/entities/`；subject 是否知道实例真相仍由自己的 `events.jsonl` 与 `memory.jsonl` 决定。

## 完成标准

- 用户已经选择 `rp.leader` 或就地 RP 入口。
- `manual/`、`agents/rp.leader/context.md`、`agents/simulator.leader/context.md` 和 `simulation/` runtime 目录存在；如项目维护 `agents/rp.writer/context.md`，上级知道要把其中可写偏好注入 writer brief。
- `simulation/subjects/` 中至少有 player 或用户指定的 subject。
- agent 能解释下一步要读哪些手册、如何创建或选择化身、何时调用 `simulator.leader`、如何开始第一 Tick。
