# RP Tick Protocol

RP Tick 是 RP 模式下世界推进的最小单位。本目录定义 rp.leader、simulator.leader、simulator.actor、rp.writer 四个 profile 在一次 Tick 中的完整交互协议。数据层面的 simulation 目录结构和文件合同见 [simulation.md](../../content/simulation.md)。

## 文件索引

| 文件 | 内容 | 可被 Import 的 Profile |
|------|------|----------------------|
| [lod-simulation.md](lod-simulation.md) | LOD 世界模拟系统 | simulator.leader |
| [actor-facing-packet.md](actor-facing-packet.md) | Actor-facing packet 标签规范 | simulator.leader + simulator.actor |
| [subject-creation-guide.md](subject-creation-guide.md) | Subject 创建流程与设计方法论（7 步任务清单、调色盘、核心人格层） | simulator.leader |
| [adjudication-report.md](adjudication-report.md) | 裁决结果报告格式 | simulator.leader + rp.leader |
| [writer-brief.md](writer-brief.md) | Writer Brief 剧本格式 | rp.leader + rp.writer |
| [tick-002-example.md](tick-002-example.md) | 完整 Tick 002 示例 | 不 Import，仅供参考 |

**相关参考**：
- [subjects.md](../../content/subjects.md)：Subject 文件架构与分流规则（可被其他需要理解 subject 文件的场景复用）

## Tick Lifecycle

一次完整的 Tick 经历以下 5 个阶段：

```
Phase 0        Phase 1         Phase 2            Phase 3          Phase 4        Phase 5
 IDLE ──────► rp.leader ──► simulator.leader ──► rp.leader ──► rp.writer ──► rp.leader ──► IDLE
              IC/OOC 审查     世界模拟 10 步        生成 Brief       自检与渲染      终稿组装
```

## Opening / Initialization

开场白发生在第一个常规 Tick 之前，但它仍然是用户可见正文产物，不能由 `rp.leader` 直接撰写。

- 初始化正文固定写入当前 Project Workspace 的 `simulation/runs/ticks/000000-initial-state/prose.md`；交给文件工具或 rp.writer 时必须写成 `{project-slug}/simulation/runs/ticks/000000-initial-state/prose.md`。
- `rp.leader` 负责读取 manual / agents、确认化身和初始处境，必要时调用 `simulator.leader` 建立初始运行态。
- 随后 `rp.leader` 生成开场白 Writer Brief，创建空 initial 的 `rp.writer` session，并通过 `invoke_agent.message` 发送完整 Brief。
- `rp.writer` 将开场白正文写入带 `{project-slug}/` 前缀的 `000000-initial-state/prose.md`；`rp.leader` 最终只组装正文链接和元场景引导。

### Phase 1 — rp.leader：IC/OOC 审查

rp.leader 接收用户输入后执行以下判断：

- **IC/OOC 检查**：区分用户消息属于角色内（In-Character）行为还是元层（Out-Of-Character）指令。OOC 指令直接处理，不进入后续 Phase。
- **合理性校验**：评估 IC 行为在当前世界状态下是否合理，必要时向用户发出澄清或拒绝。
- **输出**：仅将需要世界响应的变化（world changes，通常 1–3 行戏内事实）发送给 simulator.leader；不传递裁决问题、渲染指令或叙事偏好。

### Phase 2 — simulator.leader：世界模拟

simulator.leader 执行 10 步工作流，驱动世界状态向前推进：

- 完整流程定义见 [lod-simulation.md](lod-simulation.md)。
- 与 simulator.actor 之间的数据包格式遵循 [actor-facing-packet.md](actor-facing-packet.md)。
- 返回给 rp.leader 的裁决结果遵循 [adjudication-report.md](adjudication-report.md)。

### Phase 3 — rp.leader：生成 Writer Brief

rp.leader 根据 simulator.leader 返回的世界变化，组装一份 Writer Brief 剧本：

- Brief 合同定义见 [writer-brief.md](writer-brief.md)。

### Phase 4 — rp.writer：自检、提问或渲染

rp.writer 的 profile initial 为空。rp.leader 为每个 prose artifact 创建新的 writer session，并把完整 Writer Brief 作为 `invoke_agent.message` 发送给它。

- **解析 context 引用**：从 `<context>` 内 Markdown 链接提取可读路径，按需 read（不强制全读）。
- **检查素材完整性**：确认场景底色、人物状态、剧情骨架、视角边界和 prose 输出路径足以写作。
- **阻塞问题**：如果缺少关键材料或输出路径，不写文件，用 `report_result.result` 纯文本提问或报错。
- **渲染正文**：如果无阻塞问题，先打草稿、用 stop-slop skill 自查，再 write 到 Brief 指定 prose 路径并 edit 润色。
- **完成输出**：写完后用 `report_result.result` 汇报实际写入路径。

详细协议见 [rp-writer-interaction.md](rp-writer-interaction.md)。

如果 writer 提问，rp.leader 修改或扩展原 Writer Brief，再次向同一个 writer session 发送完整新版 Brief。不要发送裸 answer，也不要依赖 writer 从历史上下文拼接任务。

writer 不发明落点。Brief 缺少 prose 输出路径时，它只报告缺路径，不写文件。

### Phase 5 — rp.leader：终稿组装

rp.leader 接收 rp.writer 的渲染输出，完成最终组装：

- **Prose 组装**：使用 writer 写入的 prose 路径生成链接，确保与 Brief 事实一致；不要自行重写正文。
- **Meta-scene 组装**：将本 Tick 产生的元数据（场景标签、状态变更摘要等）附加到输出，供下一次 Tick 的 Phase 1 消费。
