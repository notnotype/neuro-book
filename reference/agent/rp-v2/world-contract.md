# rp.world 世界引擎读写约定

rp.world 是 RP v2 中 World Engine 的唯一读写通道。其他 agent 需要世界状态时问 rp.world，不自己调 execute_world 写入（screenwriter 可只读查证）。

## 铁律

1. **一律 worldKey="rp"**：每次 `execute_world` 调用都必须带 `worldKey: "rp"`。绝不写入 main 世界线（那是写作模式的世界）。rp 世界线的 schema/calendar 配置根是 **`rp/world-engine/`**（与写作模式的根 `world-engine/` 完全分离，互不读取）；配置缺失时如实报错并提示先初始化 `rp/world-engine/schema/index.ts` 与 `rp/world-engine/calendar.ts`，不要回退或代读写作模式配置。
2. **声明 RP 操作类型**：状态读取使用 `rpOperation="state_read"`；初始化使用 `rpOperation="bootstrap"`；常规回合写回使用 `rpOperation="turn_commit"`。
3. **回合写回必须幂等**：turn_commit 必须携带 `rp_turn begin_commit` 返回的 `worldOperationId` 作为 `execute_world.operationId`。该 id 与世界写入结果在同一 SQLite 事务提交；响应丢失后复用同一 id 会返回首次结果，不再次执行脚本。禁止自行换 id 重试。
4. **secret 剥除**：subject 的 `secret` 子对象（隐藏动机、未揭示真相）在状态分发摘要中必须整体剥除。只有调用方明确声明「god 完整版」（仅 rp.screenwriter / rp.leader 的请求）时才可包含。
5. **只做状态，不做判断**：成功率、因果、剧情走向是 rp.screenwriter 的事。rp.world 只忠实读写。
6. **事件账本分离**：正式候选/活动事件的生命周期只写 `rp_event`；World Engine pending slice 只表达未来时间触发。两者需要同步，但不能互相替代。详见 [event-lifecycle.md](event-lifecycle.md)。
7. **当前时间不分叉**：RP Calendar/World Engine Instant 是当前时间唯一真相。P4 mechanics 只保存回合 start/end 和规则流水；`rp_turn commit` 会核对 endTime 等于世界最新时间。详见 [mechanics-relations-cognition.md](mechanics-relations-cognition.md)。
8. **地图/NPC 目录不复制世界事实**：`rp_map` 只保存稳定地点 id、层级、玩家可见性与路线；`rp_npc` 只保存角色生命周期。地点完整状态和客观出场位置仍写 World Engine。详见 [map-npc-lifecycle.md](map-npc-lifecycle.md)。
9. **回合开始状态只捕获一次**：状态分发完成后，rp.world 必须用 `rp_pipeline capture_snapshot` 固定本 turn 的 World Instant 和状态 JSON；后续只认返回的 snapshotId。详见 [pipeline-focus-runtime.md](pipeline-focus-runtime.md)。
10. **冲突先于终裁**：rp.world 在 `conflict_resolution` 阶段统一读取同快照提案并逐项解决；角色意图不得用 screenwriter 计划覆盖 actor 人设和既有状态。
11. **关注度不是真相源**：`rp_focus` 只决定运行频率和远端预算，不复制 World Engine attrs。强度永不降低当前场景、直接互动角色、硬事件和确定性结算。
12. **world_snapshot 调用顺序固定**：rp.world 依次执行 `rp_focus get → execute_world state_read → rp_focus rebalance → rp_focus plan_runtime → rp_pipeline capture_snapshot`。关注平衡与运行计划必须基于刚读取的客观状态；`plan_runtime` 的起止时间使用 `execute_world` 返回的原始 `worldInstant` bigint 十进制字符串，不使用日历显示文本；`set_focus` 归 rp.leader 与玩家审批，rp.world 禁止调用；任何等待状态都必须以真实 invocation 状态为准，不能因 `get_agent` 显示 idle 就当作调用已经结束。

## Tick 开始：状态分发（P1）

按当前时间 reduce 世界状态，输出**状态分发摘要**（Markdown，人读格式，不甩 JSON）：

状态分发前读取 `rp_focus`，使用严格的 `rebalance` 参数生成当前 turn 的 runtime plan；摘要完成后调用 `capture_snapshot`，把工具实际返回的 snapshotId 一并返回 leader。`rebalance` 根节点只接受 `op`、`projectPath`、`tick`、`current`、`activeBackground`、`lowFrequency`，其中三个关注数组的条目使用 `id`、`kind`、`reason`；根节点没有 `reason`。

```markdown
## 世界状态 @ {日历时间}

### 场景
当前地点、在场角色、环境要点（从 world subject 与地点 subject 归纳）。

### 角色状态
- {角色名}: 位置/关键数值/持有物等本 Tick 相关字段（已剥除 secret）

### 已到期的 pending 事件
- {kind="pending" 且时间 ≤ 当前时刻的切片}：标题 + 内容。列出后提醒调用方本 Tick 应兑现。

### 地图与 NPC 目录
- 使用 rp_map/rp_npc 的 player 投影列出当前可见地点、路线状态、NPC 层级与擢升建议；秘密路线、冲突内部字段和 personaSummary 不得输出。
```

## Tick 结束：写回（P5）

从 screenwriter 终裁报告提取**已裁决的客观事实**，写为一条新切片：

- 一个 Tick = 一个主切片：`world.slice.write({time, title: "Tick NNN {slug}", summary: 终裁一句话, patches})`。
- patch 只写客观状态变化（位置/数值/持有物/关系值）；角色主观认知不写这里（归 rp/characters/）。
- 掷骰记录写入 slice summary 尾部：`[掷骰#seq] 行动=..., 目标=≥N, 骰=d1+d2=total, 结果=成功|部分成功|失败`（骰值来自 rp/dice/rolls.jsonl，用户亲掷）。
- 时间推进：按剧情实际经过的时间推进 instant；一个 instant 只能一个切片。

### Pending Events = 未来切片

- 「N 分钟后女仆到达」类事件：写一条**未来时间**、`kind: "pending"` 的切片，patches 可为最小占位（如对 world subject 的 events append）。
- 每次 P1 分发时列出已到期（时间 ≤ 当前）的 pending 切片；兑现后由 rp.world 将其 kind 改写为普通切片（editPatches/edit）或在新主切片中落实并删除占位。
- 已失效的 pending 切片直接删除，并在分发摘要中注明。
- pending 到期若对应正式事件，同时调用 `rp_event activate/advance_stage/finish` 更新事件账本；不要只兑现世界切片。

## Schema 约定（图数据）

初始化或补建 subject 时遵守（供地图/关系图面板读取）：

- 地点 subject（type=location）：`连接: [{目标: ref, 距离?: string, 方向?: string}]`。
- 角色 subject（type=character）：`关系: [{对象: ref, 类型: string, 好感?: number}]`；可选 `secret: {…}` 子对象存放隐藏状态。
- schema 由 **`rp/world-engine/schema`** 定义（RP 专属，与写作模式完全分离）；缺少上述字段时如实报告，不硬造。
- 新 location subject 的 id 必须与 `rp_map` 节点 id 一致。先确认客观 subject，再 materialize 地图目录；两者不一致时停止并报告。
