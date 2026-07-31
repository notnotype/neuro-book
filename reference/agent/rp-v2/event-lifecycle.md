# RP v2 事件生命周期

RP 的正式候选与活动事件由 `rp_event` 服务端账本维护，canonical 文件位于 Project Workspace `.nbook/rp/runtime/events/state.json`，审计流水位于 `.nbook/rp/runtime/events-ledger.jsonl`。Agent 不能用聊天上下文、`report.md` 或 World Engine pending slice 代替这份状态。

## 权限边界

| 角色 | 可以做什么 | 不可以做什么 |
| --- | --- | --- |
| `rp.screenwriter` | 提出四卡并调用 `validate_candidates` 校验 | 登记、选择、激活、结束事件 |
| `rp.world` | 登记候选/正式事件；处理地点失效、重新校验、激活、阶段推进、暂停与终态 | 替玩家选择候选；替 screenwriter 决定剧情 |
| `rp.leader` | 读取玩家视图；按玩家明确指令 save/discard/select/random_select | 读取或泄露 hiddenSetup；直接推进客观生命周期 |
| 服务端 `rp_turn commit` | committed 后按 turnId 幂等更新平淡回合计数 | 计入 failed/cancelled/awaiting_player 回合 |

权限由 `rp_event` 工具层硬校验，不只依赖 Prompt。

## 四卡候选

每批候选必须恰好四张，并分别使用：

- `calm`：平淡、生活、交流或低风险探索。
- `exciting`：刺激、竞争、追逐或明显机会。
- `dangerous`：危险、损失风险或高压局面。
- `unusual`：不寻常、反常迹象或未知规则。

每张卡只描述玩家此刻可察觉的入口，不预设结果。玩家可保留、放弃、选择，或指定 1-4 张候选交给服务端随机。`select` 只固定入口，随后仍须由 `rp.world activate`，发展取决于角色、人际状态、判定和玩家行动。

生成触发器：

- 进入新地点；
- 开始新活动；
- 已启动计划到期；
- 玩家主动要求；
- 开场局面稳定后按需生成；
- 连续五个 committed 平淡回合。

不要求每 Tick 产生候选。`rp_turn commit` 接收 `meaningfulEvent`：本回合启动、推进或结束正式事件时为 `true`，否则为 `false`。连续五次 `false` 后 `candidateGenerationDue=true`；同一 turnId 重试不会重复增长。以 `calm_streak` 登记新四卡后计数归零。

## 生命周期

```text
available <-> saved
available/saved -> selected -> active -> suspended -> active
active/suspended/selected/available/saved
    -> resolved | failed | missed | continued_without_player | expired | cancelled
```

- `available`：可选择候选或尚未到期的正式/硬性事件。
- `saved`：玩家保留的候选；没有硬数量上限，但新增时校验互斥键。
- `selected`：玩家已选择入口，尚未正式发生。
- `active`：当前精细运行；普通 active 最多三个。
- `suspended`：玩家离场，NPC 默认 `backgroundProgress=true` 继续行动。
- `continued_without_player`：事件在玩家缺席时继续并结束，不占 active 名额。
- 其他终态按字面含义保留，不删除记录。

事件内部阶段只能向前：

```text
entry -> involvement -> development -> critical_choice -> outcome -> aftermath
```

阶段属于主持层，不进入玩家视图。玩家只看到当前状况、可知时限与 `lastChange`。

## 地点失效与保留

离开地点时，`rp.world` 调用 `invalidate_location`：

- 普通 `available` 候选变为 `availability=unavailable`，保留玩家可知原因；
- `saved` 候选保留，但变为 `needs_revalidation`；
- 玩家回到相关条件或世界事实发生变化后，由 `rp.world revalidate` 给出通过或不通过及具体原因；
- 不可用候选不直接消失，方便 UI 展示与审计。

## active 名额与硬性事件

- 普通 active 事件最多三个。
- 硬性日程、提前预报天气、约定和已启动计划标记 `hard=true`，到期后可临时成为第四焦点。
- 即使是硬性事件，也只保证客观发生，不强迫玩家参与；玩家离开后按事实进入 `suspended`、`missed`、`failed` 或 `continued_without_player`。
- 已有四个 active 焦点时不能再激活硬性事件，必须先处理一个焦点。

## 与 World Engine pending slice 的关系

`rp_event` 是事件生命周期真相源；World Engine pending slice 只是未来时间触发器。例如“明早九点考试”同时需要：

1. `rp_event register_event` 登记硬性日程及玩家可见状态；
2. World Engine future/pending slice 表达日历到期；
3. 到期时 `rp.world` 兑现 pending slice，并调用 `rp_event activate`；
4. 回合写回后，客观资源、地点和关系变化进入 World Engine，事件阶段进入 `rp_event`。

不能只写 pending slice 而没有正式事件记录，也不能只登记事件而不维护客观日历触发。
