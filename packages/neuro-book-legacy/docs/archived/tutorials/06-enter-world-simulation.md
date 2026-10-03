# 进入世界模拟

> **已归档（2026-07-26）**：本篇基于旧 simulation/RP 能力，相关 profile 与 skill 已退出普通写作模式（skill 归档于 docs/archived/skills/）。普通写作模式的世界状态追踪见 World Engine（novel-setup 阶段四与 novel-writing）。RP 恢复时再重写本篇。

这一节结束后，你会知道如何从一个普通写作项目进入世界模拟 / RP 模式，并完成第一 Tick。

NeuroBook 的 RP 模式不是把用户丢进一个普通聊天角色卡。它更接近“世界模拟”：simulator leader 负责理解用户行动、调度角色、裁决世界变化，再把结果交给 writer 渲染成用户看到的文本。

> 当前限制：`simulator.actor` 能消费 `soul.md` 与本轮 actor-facing message，但不会自动检索 `events.jsonl` / `memory.jsonl`，也不会在回合后自动保存记忆。下面的第一 Tick 可以运行；长线记忆需等待后续 workflow/job 集成，或由上级流程显式准备 actor-safe context。

## 先理解 simulation

当前 Project Workspace 默认使用 `simulation/` 保存可变化的运行态：

```text
agents/
  simulator.leader/
    context.md
    memory.md
    generated.md
  rp.writer/
    context.md
    memory.md
    generated.md
simulation/
  subjects/
  entities/
  runs/
```

这些文件各有分工：

- `agents/simulator.leader/context.md`：simulator leader 的 Project 专用运行上下文。
- `agents/rp.writer/context.md`：可选的 RP 输出偏好来源；由上级读取后写入 writer brief，`rp.writer` 自己不绑定这个文件。
- `subjects/`：角色、玩家主角、势力代表等可扮演主体。
- `entities/`：需要状态追踪的物品、地点、机关或特殊对象。
- `runs/`：每次 Tick 的过程记录。

## 选择入口

使用 `RP模式` Skill 开始：

```text
请使用“RP模式”检查当前项目是否已经准备好进入世界模拟。如果缺少 simulation 文件，请先列出需要补齐的内容。
```

如果你刚导入过 SillyTavern 卡片，可以补一句：

```text
请同时参考 reference/silly-tavern 下最近导入的 simulation-migration 材料，但不要把动态机制直接复制进角色 knowledge。
```

## 最小可运行场景

第一次 RP 不需要完整世界。建议先准备最小场景：

- 一个玩家主角 subject。
- 一个会回应玩家的 NPC subject。
- 一个当前地点。
- 一个开局行动。
- 一条需要裁决的悬念或危险。

可以让 Agent 帮你补齐：

```text
请为当前项目准备一个最小 RP 场景：玩家主角、一个 NPC、一个地点和一个开局行动。只写必要文件，写入前先列路径。
```

## 三类 Agent

第一版 RP 主要由三类 profile 协作：

- `simulator.leader`：世界模拟主管，负责场景叙述、世界裁决和 actor 调度。
- `simulator.actor`：角色扮演 agent，只看到自己应该知道的信息。
- `rp.writer`：RP 文本渲染 agent，profile initial 为空，只把上级注入的 writer brief 写成用户可读 prose。

用户也是故事中的一个扮演者。不同点在于，simulator leader 不直接以内部裁决文本和用户交流，而是通过 writer 输出最终文本。

## 初始化 subject

每个重要扮演者都应该在 `simulation/subjects/` 下有自己的目录。玩家主角也应该有一个 subject。

典型 subject 文件包括：

```text
subject.md
soul.md
events.jsonl
memory.jsonl
mind.md
state.md
```

含义是：

- `subject.md`：全知秘密档，只有 `simulator.leader` 可读，含隐藏真相和调度提示；frontmatter 可记录 `id`、`name`、`kind`、`profile`、`controlledBy` 和 `canonicalSource`。
- `soul.md`：第一人称扮演手册（无 frontmatter），直接注入 actor 本人作为身份，只含角色自知信息，不含秘密。
- `events.jsonl`：这个主体经历过什么，每行一条 `{ tick?, time?, text }`。
- `memory.jsonl`：这个主体对人、地点、物品、概念或自己的当前稳定看法，每行一条 `{ topic, aliases?, view }`。
- `mind.md`：当前心理、欲望、误解和倾向。
- `state.md`：身体、位置、持有物、关系等当前状态。

不要把上帝视角 lorebook 直接复制进 `memory.jsonl`。角色只能知道它合理知道的信息。

玩家主角也需要 subject。区别是：系统不应该替玩家发明关键动作、台词或目标；玩家的行动由你输入。

## 配置 Subject RAG（为显式流程预备）

Subject RAG 的数据、索引与底层工具仍保留。它只检索当前 subject 的 `events.jsonl` 和 `memory.jsonl`，不会检索完整 lorebook 或其他 subject；当前内置 actor 不会自动调用它。

在第一次依赖 RAG 前，打开设置里的 `Embedding` tab：

- Global scope 配置 OpenAI-compatible embedding 服务、API Key、Base URL、模型名和维度。
- Project scope 可以覆盖当前项目使用的 embedding 模型名和维度。

如果没有配置 embedding，显式调用 `subject_rag_search` 会明确报错，不会退回关键词搜索。普通 actor run 当前不会触发这个错误；没有报错也不表示长期记忆已经自动生效。

## 进行第一 Tick

准备好后，可以直接输入行动：

```text
进入 RP。我的角色醒来，发现自己坐在夜行列车最后一节车厢，手里攥着一张被打孔的旧车票。
```

一次 Tick 通常会发生：

1. `simulator.leader` 理解用户行动或开始请求。
2. simulator leader 检查相关 subject、entity、lorebook 和当前状态。
3. simulator leader 向需要反应的 `simulator.actor` 发送 actor-facing message。
4. 上级只把 actor 合理知道的当前信息（以及已显式整理好的 actor-safe 记忆片段）放进 actor-facing message。
5. actor 只按自己知道的信息回应；它不会自行搜索或写入 subject 记忆文件。
6. simulator leader 裁决剧情推进和世界变化。
7. `rp.writer` 把裁决结果写成用户可见文本。
8. 必要状态写回 `simulation/subjects/`、`simulation/entities/` 或 `simulation/runs/`。当前没有自动 memory-save；若要维护 `events.jsonl` / `memory.jsonl`，必须由明确的外部流程执行。

第一 Tick 后，你应该能看到一次 run 记录，例如：

```text
simulation/runs/ticks/{id}-{slug}/report.md
simulation/runs/ticks/{id}-{slug}/prose.md
```

`report.md` 保存后台裁决和状态变化，`prose.md` 保存用户可见正文或片段。

## 和写作模式的关系

RP 模式可以服务于写作。你可以先用世界模拟探索角色反应和剧情可能性，再把稳定结果整理进 Plot，最后用普通 `writer` 写正式章节。

边界要保持清楚：

- `agents/` 保存 profile 专用上下文、启动阅读顺序、跨 session 记忆、程序生成的 context recommendations，以及部分 profile 的可编辑资源。
- `lorebook/` 保存稳定设定和原型。
- `simulation/` 保存当前运行态。
- `manuscript/` 保存正式正文。
- `reference/` 保存外部素材和导入归档。

如果你不确定某条信息该放哪里，先让 leader 解释它是稳定设定、角色知识、实体状态，还是一次 Tick 的过程记录。

## 继续阅读

- [Subject RAG 记忆](/agent/subject-rag-memory)
- [Agent Workflow](https://github.com/notnotype/neuro-book/blob/master/reference/agent/workflow/README.md)
