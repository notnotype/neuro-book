# Round 335: Subject File Bridge Plan

## Context

上一轮确认真实作者流的首要卡点是：World Engine slice 能记录结构化 timeline，但 `ming-ding-zhi-shi-2` 的角色叙事状态仍在 `simulation/subjects/*` 六文件中。作者写完 slice 后，看不到角色 `state.md / events.jsonl / memory.jsonl` 如何跟进。

本轮继续只读收敛方案，不写业务代码。

## Evidence

- `reference/content/subjects.md` 定义六文件职责：
  - `events.jsonl`：剧情累积、RAG 索引、角色第一人称经历流。
  - `memory.jsonl`：角色对特定主体的稳定看法。
  - `mind.md`：当前心理、疑虑、短期意图。
  - `state.md`：当前位置、装备、伤势、外观、关系压力和短期目标等可见状态。
- `reference/agent/sidecar-profile-pass.md` 明确 `actor.memory-save` 只维护 `events.jsonl / memory.jsonl / mind.md`，不更新 `state.md`；位置、持有物、伤势等仍由 `simulator.leader` 或后续变量系统裁决。
- `server/agent/tools/subject-memory-tools.ts` 已有：
  - `subject_event_append`：安全追加 subject-facing events，并标记 RAG dirty。
  - `subject_memory_update`：把 facts 交给 `memory.curator`，由工具应用 JSON Patch 写回 `memory.jsonl`。
  - 没有稳定的 `state.md` patch 工具。
- `world.engine.profile.tsx` 当前边界是“只处理 world-engine/ 与 Project SQLite 中的 World* 数据；旧 simulation/ workflow 暂不接入”，且没有暴露 subject memory 工具。
- `schema-design.md` §7 仍记录当前 World Engine 与 `simulation/` 独立，后续再迁移。

## Recommendation

采用“显式桥接建议”，不要让 World Engine 自动写六文件。

核心原则：

- World Engine slice 继续作为结构化 timeline / reduce 的事实源。
- `simulation/subjects` 六文件继续作为当前 RP / simulation workflow 的运行态工作区。
- 两者之间先做可审查的 subject file commit proposal，而不是隐式同步。
- `events.jsonl` / `memory.jsonl` 可以复用既有工具路线；`state.md` 先不自动改，必须交给作者或 `simulator.leader` 审查后写入。

这比直接自动写文件更稳：`state.md` 是长 Markdown，里面混有位置、关系压力、短期目标、最新动态，不能从一组结构化 mutation 机械推导；同时也比完全不接更符合作者预期，因为作者能看到“这一条 slice 之后，哪些主体文件应当更新”。

## Proposed Stages

### P0: Workbench subject file proposal surface

目标：作者写入 / 编辑 slice 后，立即看到“这条 slice 可能需要同步到哪些主体文件”。

最小形态：

- 在主 Workbench 的 slice 写入 / 编辑结果或 selected slice Inspector 中，增加轻量“主体文件建议”区域。
- 每个被 slice mutation 触及、且来自 `simulation/subjects` discovery 的 subject，生成一条建议：
  - `subjectPath`
  - 建议追加到 `events.jsonl` 的一句经历草稿：优先用 slice `time + title + summary`，必要时附触及的 mutation 摘要。
  - 建议提交给 `subject_memory_update` 的 facts 草稿：只在 mutation 明确触及 `memory.*`、关系、态度或 slice summary 有稳定认知变化时出现。
  - `state.md` 待审查提示：如果 mutation 涉及 `location / inventory / hp / relationship / short-term goal` 或 slice summary 描述了当前状态变化，提示需要由作者或 `simulator.leader` 更新 `state.md`。
- P0 只生成建议，不自动调用 Agent 工具、不写文件。

验收重点：

- 选中 `player`、写一条世界事件或角色相关 slice 后，作者能看到“这不会自动更新 state.md，但这里是建议同步内容”。
- 对 `ming-ding-zhi-shi-2` 这种角色没有 `events` attr、默认 mutation 回退到 `world.events` 的项目，建议仍能保留原 subject 语境，告诉作者哪个角色文件可能需要跟进。

### P1: Explicit commit action

目标：把建议变成可执行动作，但仍由作者确认。

候选设计：

- 新增 `subject file commit` UI 动作，先显示 diff / payload。
- `events.jsonl` 走 `subject_event_append` 等价能力。
- `memory.jsonl` 走 `subject_memory_update` 等价能力。
- `state.md` 不做自动推理式改写；只打开文件、生成 patch draft，或委托 `simulator.leader` 处理并返回待确认变更。

需要先决定的 API / Agent 边界：

- 由 Workbench HTTP API 直接写 subject 文件，还是通过 Agent 工具 / profile 执行？
- 如果通过 Agent，当前 `world.engine` 是否应继续保持不接旧 simulation，改为创建 / 委托 `simulator.leader`？
- `state.md` patch 是否需要一个专门工具，避免通用 file edit 直接覆盖长文档？

### P2: Source-of-truth migration

目标：如果未来希望 World Engine 彻底取代旧 simulation 运行态，再做大迁移。

这会牵动：

- schema 需要表达当前心理 / 可见状态 / 关系压力 / 近期动态等 narrative attrs。
- RAG 真相源需要从 JSONL 迁移到 World Engine slice 或可重建投影。
- `simulator.leader`、`actor.context-load`、`actor.memory-save` 的文件合同要重写。

P2 是大活，不应混进当前 Workbench 拼接优化里。

## Minimal Test Plan For Future Code

只测最容易错、最常用的路径：

- Utility test：从一条 slice + touched simulation subject summary 生成 subject file proposal，覆盖：
  - 角色没有 `events` attr、mutation 落到 `world.events`，但上下文 subject 是 `player`。
  - mutation 触及 `location / inventory / hp` 时出现 `state.md` 待审查提示。
  - mutation 触及 `memory.*` 时出现 `memory facts`。
- Static integration test：主 Workbench 写入 / 编辑返回后存在 proposal surface，且文案不暗示自动写入六文件。
- 暂不做浏览器验证，除非用户明确允许。

## Actual Result

- 本轮没有改业务代码。
- 本轮没有运行测试。
- 本轮把桥接路线收敛为 P0 proposal surface -> P1 explicit commit -> P2 source-of-truth migration。

