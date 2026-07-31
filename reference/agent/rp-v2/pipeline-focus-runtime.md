# RP 回合编排与关注度运行时

本契约定义 P6 之后常规 IC 回合的代码可见阶段、同快照提案、失败恢复、四级关注度、三档运行强度和长跳惰性推演。`rp_turn` 仍是唯一回合与提交真相；`rp_pipeline` 是每个 turn 下属的阶段状态，不是第二套回合账本。

## 1. 阶段状态机

每个 `rp_turn start` 自动建立 pipeline，只能按以下顺序相邻推进：

```text
action_understanding
→ world_snapshot
→ condition_check
→ screenwriter_plan
→ actor_proposals
→ conflict_resolution
→ adjudication
→ narrative
→ world_commit
→ ui_update
```

| 阶段 | 责任方 | 必需产物 |
| --- | --- | --- |
| action_understanding | leader | 已绑定的 turn 与玩家行动摘要 |
| world_snapshot | world | `capture_snapshot` 返回的 snapshotId、World Instant、stateHash |
| condition_check | leader / screenwriter | 可行动性与暂停需求的公开摘要 |
| screenwriter_plan | screenwriter | 出场 actor、extras、轻量/骰子要求 |
| actor_proposals | cast ∥ extras | 同 snapshot 的主要 actor 与群演提案 |
| conflict_resolution | world | 全部冲突的逐项解决与合并摘要 |
| adjudication | screenwriter | 绑定 snapshot 的终裁与 settlementDraft |
| narrative | writer 产出，leader 登记 | 合法 prosePath 与公开摘要 |
| world_commit | world / leader | 幂等 World 写回与 `rp_turn commit` |
| ui_update | 服务端自动 | 已提交结果的公开界面投影阶段 |

自然语言中的“已完成”“无影响”不能代替工具产物。轻量回合可以没有 actor/extras，但仍需提交空提案集合、空冲突收口、终裁和叙事登记，不能跳过阶段。

## 2. 同快照并行提案

1. world 在回合开始 reduce 状态后调用 `capture_snapshot`。快照以 turnId、World Instant 和完整 JSON 状态生成稳定 id 与 SHA-256 stateHash。
2. screenwriter plan、cast 提案、extras 提案、world resolution 和 screenwriter adjudication必须原样使用同一 snapshotId。
3. screenwriter plan 的 `expectedActorIds` 是主要 actor 完整性门禁。cast 必须并行调用这些 actor，并一次提交汇总；缺任何一个都不能进入冲突解决。
4. 普通具名 NPC 和未具名群演由 extras 批量处理。当前场景或直接互动的主要/常驻角色仍应独立处理，不能因强度降低而移交 extras。
5. world 是唯一冲突解决者。`character_intent` 冲突只要存在 `actor:{id}` 来源，就不能选择 `screenwriter` 覆盖 actor；角色人设、既有状态和关系优先于剧情计划。
6. screenwriter 只能在 world resolution 完成后终裁。

## 3. 失败与恢复

`rp_pipeline report_failure` 必须记录：失败阶段、kind、Agent、真实问题、是否阻塞、恢复选项和时间。聊天只展示公开问题与恢复方案，不展示思维过程或隐藏剧情。

- `major_actor`：始终阻塞。不能由 leader、cast 或 extras 手工标记恢复；只有同 actor 成功提交提案才自动解除。
- `extras`：可重试或新建 extras session，但 plan 要求的 extras 提案仍必须真实提交。
- `screenwriter` / `writer`：重试当前阶段，或由玩家取消/修改本回合。
- `world`：普通阶段可重试；world_commit 响应不明时必须查询或复用同一个 worldOperationId，不能假定未提交。
- pipeline 的阻塞失败未恢复、叙事未登记或未到 `world_commit` 时，`rp_turn begin_commit` 必须拒绝。

失败报告与 `rp_turn fail` 不是同一动作：前者描述可恢复的阶段问题；只有决定终止回合时才把 turn 标记 failed。

## 4. 统一事务边界

P6 不伪造跨 SQLite 与 JSON 文件的物理原子事务，而使用可恢复的统一逻辑事务：

- `rp_turn` 控制 running / awaiting_player / committing / committed 等正式状态。
- World Engine `operationId` 保证客观世界写回幂等。
- mechanics / relation / cognition 使用 turnId 做完整预检与幂等结算。
- pipeline 在提交前验证同快照提案、冲突解决、终裁、叙事和阻塞失败。
- 只有 committed turn 进入正式正文、事件平淡计数和更新窗口；commit 成功后 pipeline 自动进入 ui_update。

## 5. 四级关注度

| 级别 | 含义 | 运行方式 |
| --- | --- | --- |
| `current` | 当前场景、直接互动对象 | 每回合完整独立处理 |
| `active_background` | 正在推进的后台事件、常驻/主要角色活动 | 按运行强度选择独立或批量推演 |
| `low_frequency` | 仍有持续意义但近期不活跃 | 低频检查；主要角色最低为此级 |
| `dormant` | 长期未接触的地点、角色、组织和计划 | 停止逐回合运行，回归时按时间差惰性推演 |

玩家可固定任一对象的关注度，固定或解除都需要真实审批。world 的自动 rebalance 不得修改 pinned 项；`major` 和 `major_inactive` 至少保留 `low_frequency`。

rp.world 在 `world_snapshot` 阶段对 `rp_focus` 只使用 `get`、`rebalance`、`plan_runtime`，顺序为先 get、再读取 World Engine 客观状态、然后 rebalance 与 plan_runtime。合法的自动平衡调用结构如下；`reason` 属于数组条目，不是根字段：

```json
{
  "op": "rebalance",
  "projectPath": "workspace/example",
  "tick": 1,
  "current": [],
  "activeBackground": [],
  "lowFrequency": []
}
```

`set_focus` 只允许 rp.leader 发起并由玩家确认，rp.world 不得用它替代 `rebalance`。状态读取与运行计划完成后必须调用 `rp_pipeline capture_snapshot`，并以其真实返回的 `snapshotId` 作为阶段完成依据。

`execute_world rpOperation=state_read` 的工具结果顶层会固定返回原始 `worldInstant`。`plan_runtime` 的 `startInstant/endInstant` 只能使用这种 bigint 十进制字符串，不能传格式化日历文本；该操作也不接受 `worldSummary`。常规 Tick 的合法结构如下：

```json
{
  "op": "plan_runtime",
  "projectPath": "workspace/example",
  "turnId": "turn-000001-example",
  "longJump": false,
  "startInstant": "7808400",
  "endInstant": "7808460",
  "currentNpcIds": ["companion"],
  "directInteractionNpcIds": ["companion"]
}
```

## 6. 三档运行强度

`light | standard | deep` 是持久服务端变量，每轮由 Agent 直接读取；P7 UI 可直接切换，不需要为切换单独调用模型。

| 强度 | 后台独立角色上限 | 远端场景预算 |
| --- | ---: | ---: |
| light | 0 个额外后台角色 | 0 |
| standard | 3 个额外后台角色 | 2 |
| deep | 8 个额外后台角色 | 6 |

强度只影响远端世界丰富度，以下项目永远不降级：

- 当前场景与直接互动角色；
- active/suspended 与到期硬性事件；
- 时间、资源、周期、候选失效等确定性模块；
- 生育/风险等已明确要求的服务端概率抽取；
- 玩家明确要求关注的对象。

普通 named NPC 可批量交 extras；当前或直接互动对象即使在 light 也必须保留独立处理。

## 7. 长跳

长跳先完成 mechanics 阻断分析与必要审批，再用 `plan_runtime` 生成一次计划：开始/结束 Instant、确定性模块、独立 NPC、批量 NPC、后台对象和远端预算。

运行结束只调用一次 `record_long_jump`，写入：

```text
.nbook/rp/runtime/long-jumps/{turnId}.json
```

同 turnId 重试返回首次文件，不覆盖。不得为了“一周”“一个月”或多年跨度逐日生成 RP Tick；回归 dormant 地点时，从上次状态按实际时间差做一次合理推演即可。

## 8. 文件真相源

```text
.nbook/rp/runtime/
├── pipelines/{turnId}.json       单回合 pipeline canonical 状态
├── pipeline-ledger.jsonl         阶段与操作审计
├── focus/state.json              强度、关注对象与运行计划
├── focus-ledger.jsonl            关注度操作审计
└── long-jumps/{turnId}.json      长跳单次摘要
```

`stageHistory` 只保存玩家可公开的阶段摘要，不保存 Chain-of-Thought、隐藏剧情或 NPC 未揭示内心。详细文件由 P7 更新窗口按需读取，不反复塞进聊天上下文。
