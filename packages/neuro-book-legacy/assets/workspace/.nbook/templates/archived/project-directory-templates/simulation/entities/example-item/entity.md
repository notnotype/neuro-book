# Example Entity

本目录示例一个需要状态追踪的实例。普通可堆叠、无差异物品不需要建立 entity；只有唯一物品、隐藏状态、被下毒/损坏/附魔的物品、门锁、机关、碎片等才建议实例化。

```yaml
kind: item
prototype: null
displayName: 示例物品
```

## 说明

- `prototype` 指向 lorebook 原型或规则来源；没有真实原型时保持 `null`，不要填写不存在的路径。
- 连接到真实 lorebook 后可改成类似 `lorebook/item/consumable/blood-potion/` 的 Project Workspace 相对路径。
- 这个引用不是 subject 可见性授权。
- subject 是否知道该实例真相，由 `simulation/subjects/{id}/events.jsonl` 与 `memory.jsonl` 决定。
- 真实可变状态写在同目录 `state.md`。
