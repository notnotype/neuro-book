# Sample NPC State

本文件记录示例 NPC 当前状态。它是可变运行状态，不是角色卡稳定设定。

本文件由 simulator leader 裁决后维护。actor 可以报告状态变化候选，但不自行决定真实世界状态；特殊实例状态应放入 `simulation/entities/`。

## 当前位置

- 待填写。
- 示例：位于起始场景附近，能看见玩家角色。

## 持有物品

- 待填写。
- 示例：暂无已确认关键物品。
- 普通可堆叠物品可以直接记录数量；特殊、隐藏状态或唯一物品引用 `simulation/entities/{entity-id}/`。

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: 血药
    quantity: 1
  - entity: simulation/entities/example-item/
    subjectVisibleName: 看起来普通的示例物品
```

`entity` 的真实状态只给 simulator leader 使用，不代表该 NPC 已经知道它的完整真相。

## 身体与姿态

- 待填写。
- 示例：状态正常，保持克制和警惕。

## 关系压力

- 待填写。
- 示例：对玩家角色缺乏信任，但没有公开敌意。

## 短期目标

- 待填写。
- 示例：确认玩家角色的目的，避免泄露自己不知道或不该说的信息。

## 更新规则

- 只记录故事内已经确认的状态变化。
- 不记录其他 actor 的私密意图。
- 不确定内容写成待确认，不要当作事实。
