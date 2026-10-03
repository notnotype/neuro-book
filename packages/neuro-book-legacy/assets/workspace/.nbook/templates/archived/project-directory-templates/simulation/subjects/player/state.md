# Player State

本文件记录玩家角色当前状态。它是可变运行状态，不是角色卡稳定设定。

本文件由 simulator leader 裁决后维护。actor 可以报告状态变化候选，但不自行决定真实世界状态；特殊实例状态应放入 `simulation/entities/`。

## 当前位置

- 待填写。
- 示例：先参考 `simulation/runs/current.md` 的当前场景，直到 simulator leader 建立更具体位置。

## 持有物品

- 待填写。
- 示例：暂无已确认关键物品。
- 普通可堆叠物品示例：

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: 血药
    quantity: 3
    subjectKnownEffect: 通常用于恢复伤势
```

- 特殊或隐藏状态实例示例：

```yaml
inventory:
  - entity: simulation/entities/poisoned-blood-potion-001/
    subjectVisibleName: 血药
```

`entity` 引用不代表玩家角色知道隐藏真相；玩家角色知道什么仍看 `events.jsonl` 与 `memory.jsonl`。

## 身体与姿态

- 待填写。
- 示例：状态正常，正在观察现场。

## 关系压力

- 待填写。
- 示例：与示例 NPC 尚未建立信任。

## 短期目标

- 由用户输入决定。
- 示例：弄清楚现场状况。

## 更新规则

- 只记录故事内已经确认的状态变化。
- 不把玩家未选择的行动结果写成既成事实。
- 状态不确定时写成“可能/待确认”，不要写成确定事实。
