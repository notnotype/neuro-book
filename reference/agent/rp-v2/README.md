# RP v2 Tick Protocol

RP 模式 v2 的世界推进协议。六角色流水线，World Engine（worldKey="rp"）为唯一客观世界状态源，`rp/characters/` 为角色主观认知层，`rp_event` 为候选与正式事件生命周期源；`rp_turn` 负责每个 IC 回合的状态、恢复与幂等提交，`rp_pipeline` 负责代码可见阶段与同快照提案门禁，`rp_focus` 负责关注度、强度和长跳运行计划。详细结算写入 Project Workspace `.nbook/rp/runtime/` 而不注入聊天上下文。

## 角色分工

| Profile | 职责 | 关键约束 |
| --- | --- | --- |
| `rp.leader` | 主持（彩绘）：IC/OOC 审查、流水线编排、编剧 Writer Brief、终稿组装 | 不写任何世界内正文；不自己裁决世界 |
| `rp.world` | World Engine 唯一读写通道：Tick 开始读状态分发、结束写回切片 | 一律 worldKey="rp"；默认剥除 secret；见 [world-contract.md](world-contract.md) |
| `rp.screenwriter` | 一切判断：事前判断（出场名单/群演/成功率掷骰/意外+LOD）、事后终裁、未知信息账本维护 | 全知层；见 [adjudication.md](adjudication.md) |
| `rp.cast` | 按名单创建/复用 `rp.actor` 并**并行**调度，组装 actor-facing packet | 只接触过滤后材料，不接触 god-view |
| `rp.actor` | 单角色第一人称扮演（每主要角色一个），三通道输出 | 记忆走 `rp/characters/`；见 [character-memory.md](character-memory.md) |
| `rp.extras` | 单 agent 扮演本 Tick 全部群演 NPC | 不写文件；只消费上级注入的材料 |
| `rp.writer` | Writer Brief → 用户可见正文 | 见 [writer-brief.md](writer-brief.md) 与 [rp-writer-interaction.md](rp-writer-interaction.md) |

packet 标签规范见 [actor-packet.md](actor-packet.md)（`<gm>/<character>/<knowledge>/<directive>`）；LOD 世界模拟见 [lod-simulation.md](lod-simulation.md)。
候选四卡、active 名额、地点失效、硬性事件与完整生命周期见 [event-lifecycle.md](event-lifecycle.md)。
时间/长跳、资源周期、八维关系与三层认知见 [mechanics-relations-cognition.md](mechanics-relations-cognition.md)。
层级地图、秘密路线、小说地点导入与 NPC 擢升见 [map-npc-lifecycle.md](map-npc-lifecycle.md)。
代码可见阶段、同快照冲突、失败恢复、关注度与运行强度见 [pipeline-focus-runtime.md](pipeline-focus-runtime.md)。
世界切片树、四分支上限、混合快照、只读预览、恢复与认知隔离见 [timeline-branches.md](timeline-branches.md)。
三档一致性审计、安全修复边界、损坏恢复阶梯和测试随机见 [consistency-recovery.md](consistency-recovery.md)。

## Tick 流水线

```
用户输入 → rp_turn start/resume
 ↓ action_understanding  rp.leader 判断 IC/OOC、读取强度、宣告 Tick
 ↓ world_snapshot        rp.world reduce + runtime plan + capture_snapshot
 ↓ condition_check       检查可行动性、骰子/确认暂停
 ↓ screenwriter_plan     rp.screenwriter submit_plan
 ↓ actor_proposals       rp.cast actors 并行 submit ∥ rp.extras submit
 ↓ conflict_resolution   rp.world 逐项 resolve_conflicts
 ↓ adjudication          rp.screenwriter submit_adjudication + report.md
 ↓ narrative             rp.writer 生成 prose，rp.leader register_narrative
 ↓ world_commit          begin_commit → worldOperationId 幂等写回 → rp_turn commit
 ↓ ui_update             服务端自动进入已提交界面投影
```

编排要点（rp.leader 责任）：

- 每个阶段只在 `rp_pipeline` 必需产物已登记后相邻推进；自然语言声称完成无效。
- snapshotId 从 world_snapshot 起原样传递；screenwriter、cast、extras、world 和终裁不得各读一份不同状态。
- P3 的多个 actor invoke 互不依赖，**必须在同一轮并行发出**；rp.extras 与 actors 并行。
- 主要 actor 失败不能由 leader/extras 代演；只有同 actor 成功提交才能解除阻塞。
- world 在 screenwriter 终裁前统一解决冲突；角色意图以 actor 人设和既有状态为先。
- active 冒险的 RP 子 Agent 只能在已绑定的 turn 中调用；awaiting_player 阶段暂停所有子 Agent，committing 阶段只允许 rp.world 完成写回。
- rp.world 的 turn_commit 必须把 `rp_turn begin_commit` 返回的 worldOperationId 原样传为 `execute_world.operationId`。World 写入和 operation 结果同事务提交，重试不会重复结算。
- 轻量通道可以省略独立 actor/extras，但仍走空冲突收口、终裁、叙事登记和统一提交，不能跳阶段。
- 群演反应并入终裁报告，不单独写 World Engine，除非 screenwriter 决定把某 NPC 升格为正式 subject/角色。
- 每个 prose artifact 一个新的 rp.writer session；Brief 协议不变。
- 候选生成时，screenwriter 只负责四卡提案与校验；world 登记；leader 展示并执行玩家选择。权限由 `rp_event` 工具硬校验。
- 时间当前值只认 World Engine Instant；资源、关系、认知变化在 `rp_turn commit.rules` 统一预检和幂等收口，失败不产生 committed 半套状态。
- `rp_map` 只维护地点目录、可见性与路线，完整客观地点状态仍在 World Engine；`rp_npc` 只维护生命周期，主要角色主观档案仍在 `rp/characters/`。
- 每轮读取 `rp_focus` 的 light/standard/deep。强度只改变远端丰富度，不减少当前场景、直接互动角色、硬事件和确定性结算；长跳只保存一次批量摘要。
- 世界切片树启用后，每个 committed Tick 自动建立节点；`begin_commit` 若报告当前节点已有四条直接分支，立即停止并让玩家在 RP 状态页的切片树窗口选择替换对象。Agent 不得删除 WorldSlice 或改文件模拟回滚。
- `begin_commit` 还会运行 light 一致性审计；长跳和恢复运行 standard。blocked 时先把实际问题交给玩家，不能修改资源、关系、认知或正文来绕过。

## RP 专属目录（与写作模式完全分离）

RP 模式的一切材料都在项目的 `rp/` 子树内，**与写作模式零共享**——RP agent 不读写作模式的 `lorebook/`、`manual/`、`world-engine/`、`manuscript/`，写作模式 agent 也不进 `rp/`。初始化时可从写作素材**一次性拷贝改编**（用户主导），运行时绝不跨读。

```
rp/
├── world-engine/             RP 专属 schema + calendar（结构镜像根 world-engine/：schema/index.ts + calendar.ts）
│                             数据存 .nbook/world-rp.sqlite；worldKey=rp 的一切读写用这套配置
├── lorebook/                 RP 世界观 canon（screenwriter 全知读取）
├── manual/                   玩家手册层：README.md / world-guide.md / rules-guide.md / gm-guide.md / player-guide/
├── characters/{id}/          角色主观认知层（见 character-memory.md）
└── ticks/{NNNNNN-slug}/
    ├── report.md             screenwriter 终裁报告（全知，god-view）
    └── prose.md              用户可见正文
```

## 开团顺序（新冒险）

1. **开团引导**（[adventure-intake.md](adventure-intake.md) / `rp-v2-adventure-intake` skill）：所有回答先写 Project Workspace `.nbook/rp/intake/` 版本草案；完整企划通过 `rp_intake confirm` 的玩家审批后，才能 `begin_bootstrap`。
2. **技术初始化**（`rp-v2-bootstrap` skill）：
   - rp.leader 调用 `rp_intake op=initialize_config`，由服务端标准模板生成 `rp/world-engine/`（schema/index.ts + calendar.ts）；现代/校园/都市使用 gregorian，固定长度架空历法使用 simple。禁止 Agent 手写猜配置格式。随后调用 rp.world 建立初始世界状态（world subject + 化身/关键 NPC 首切片，worldKey=rp）。
   - 对化身与每个主要角色 `rp_character_update op=ensure` 建 `rp/characters/{id}/` 档案——**必带 name、kind（化身 player / 其他 npc）与 aliases**，id 登记进注册表（soul.md 按 [../rp-tick/subject-creation-guide.md](../rp-tick/subject-creation-guide.md) 方法论撰写）。
   - 开场白 Brief 交 rp.writer，先写入 `rp/bootstrap/staging/opening-prose.md`；服务端全量验收并激活后发布为 `rp/ticks/000000-initial-state/prose.md`。
   - 任一 checkpoint 失败都停留在原阶段并保留该阶段写权限；修正后直接重试 checkpoint，不重复 begin_bootstrap。

## Tick 产物落盘

- Tick 编号的唯一权威是 `rp_tick_info`（扫描 rp/ticks/ 返回 nextTick）：rp.leader 每 Tick 开始时取号并向全管线宣告，任何 agent 不得自行推算。000000 固定为初始化；`{NNNNNN-slug}` 的 slug 用短横线英文短语。
- 客观状态变化只写 World Engine 切片，不再维护 legacy 的 current.md/state.md；Pending Events 用未来时间切片（kind="pending"）表达。
- 回合 canonical 状态、阶段流水、完整结算和错误分别保存在 Project Workspace `.nbook/rp/runtime/turns/`、`turn-ledger.jsonl`、`updates.jsonl` 与 `errors.jsonl`；代码可见阶段另存 `pipelines/` 与 `pipeline-ledger.jsonl`。
- 关注度/强度与运行计划保存在 `.nbook/rp/runtime/focus/`，长跳摘要保存在 `long-jumps/{turnId}.json`。这些文件供恢复和世界状态更新窗口按需读取，不进入聊天上下文。
- 正式事件状态与审计分别保存在 `.nbook/rp/runtime/events/state.json` 和 `events-ledger.jsonl`；玩家视图不含 `hiddenSetup` 和内部阶段。
- 时间资源、八维关系与三层认知分别保存在 `.nbook/rp/runtime/mechanics/`、`relations/`、`cognition/` 及对应 JSONL 流水；完整结算按需投影，不反复注入上下文。
- 地图与 NPC roster 分别保存在 `.nbook/rp/runtime/map/`、`npcs/` 及对应 JSONL 流水；秘密路线和 GM 人设不进入玩家投影。
- `rp.writer` 生成的常规 prose 只有在对应 turn committed 且登记 prosePath 后才进入正文面板；失败或中断回合的半成品不向玩家展示。
- 时间线索引与完整/差量恢复材料保存在 `.nbook/rp/branches/`；它不进入自身快照。恢复后角色 belief/记忆随分支切换，玩家 OOC 认知保留，并由前端创建新的 rp.leader 会话隔离旧分支对话上下文。
- 最近一次一致性报告保存在 `.nbook/rp/runtime/consistency/latest.json`；切片损坏报告保存在 `.nbook/rp/branches/problems/`，均由 UI 按需读取，不写入聊天上下文。

## 与 legacy / 写作模式的边界

- `simulation/` 体系（simulator.leader / simulator.actor / rp-tick 旧协议）保留供历史项目使用。v2 全部落在 `rp/` 目录与 `rp.*` profile，两套互不迁移、互不混用。
- 写作模式的 `lorebook/`、`manual/`、`world-engine/`（main 世界线）对 RP agent 是禁区；反之写作模式 agent 不读写 `rp/`。防止两模式互相污染设定与状态。
