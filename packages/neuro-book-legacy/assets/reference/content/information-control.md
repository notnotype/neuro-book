# Content Information Control

本文定义 NeuroBook 内容层的信息控制原则。第一版先固定模型，不定义完整 frontmatter schema、GraphRAG 边类型或自动可见性算法。

## Core Pattern

推荐模型是：

```text
Prototype / Instance + Event Sourcing + Subject-facing View
```

| Concept | Directory | Meaning |
| --- | --- | --- |
| Prototype | `lorebook/` | 类型、原型、全知规则、隐藏后果。 |
| Entity | `simulation/entities/` | 有状态实例。 |
| Subject | `simulation/subjects/` | 信息控制主体。 |
| Event Log | `events.jsonl` | subject 的经历流，每行记录“怎么知道的 / 怎么变化的”。 |
| Snapshot | `state.md` | 当前状态快照。 |
| Memory | `memory.jsonl` | subject 对某个主体的当前看法、理解、态度或误解修正。 |

引用路径不是可见性授权。`state.md` 或 `entity.md` 可以引用 `lorebook/...` 原型，但 subject 不能因为看到引用就读取完整 lorebook。

## Lorebook Is Omniscient

`lorebook/` 默认是全知、作者视角、AI 说明书。它可以记录：

- 世界真实设定。
- 角色秘密。
- 隐藏规则。
- 物品完整后果。
- 世界机制和玩法模块。

任何 subject / actor 都不能直接把完整 lorebook 当成自己的知识。subject 可见内容必须来自：

- 自己的 `subject.md`。
- 自己的 `events.jsonl`。
- 自己的 `memory.jsonl`。
- 自己的 `mind.md`。
- 自己的 `state.md`。
- simulator leader 过滤后的 subject-facing message。
- 由授权 workflow/job 明确过滤并注入的 actor-safe context；当前没有内置自动注入流程。

## Subject Memory

`events.jsonl` 记录 subject 当时经历、观察、被告知、想到、误解或推理出的片段。`memory.jsonl` 记录这些片段沉淀后的当前稳定认知，例如 subject 对某个人、组织、地点、物品、概念或自身限制的看法。

建议：

- 以自然语言写主体视角。
- 记录来源和获得过程时，优先写进 `events.jsonl`。
- `memory.jsonl` 写当前稳定认知，不写纯短期念头；短期心理优先写入 `mind.md`。
- 不写上帝视角秘密。
- 不写“你不知道 X”清单；未知信息直接不出现。
- 不直接授权 subject 自行读取 `lorebook/...`。

例子：

```jsonl
{"tick":"000001","time":"十年前的一次冒险","text":"我经过某座城市时，曾在酒馆里从一名流亡精灵口中听说过翠梦晶露。"}
{"topic":"翠梦晶露","aliases":["精灵秘仪材料"],"view":"我知道翠梦晶露是一种与精灵秘仪相关的稀有材料，但并不知道它的完整用途。"}
```

## Entity State

entity 保存真实实例状态。subject 是否知道这些状态，由 subject 的 `events.jsonl` 和 `memory.jsonl` 决定。

例子：

```text
lorebook/item/consumable/blood-potion/
simulation/entities/poisoned-blood-potion-001/
```

`entity.md`：

```yaml
kind: item
prototype: lorebook/item/consumable/blood-potion/
displayName: 血药
```

`state.md`：

```yaml
holder: simulation/subjects/npc-a/
condition:
  poisoned: true
subjectVisibleName: 血药
subjectVisibleProperties:
  - 看起来和普通血药没有区别
```

NPC-A 是否知道它有毒，不由 entity 决定，而由 `simulation/subjects/npc-a/events.jsonl` 和 `simulation/subjects/npc-a/memory.jsonl` 决定。

## Relationship Patterns

创作中常见关系按四层记录：

| Relation Kind | Where | Example |
| --- | --- | --- |
| prototype relation | `lorebook/` | 血药属于消耗品；世界之心可以被分成三块。 |
| state relation | `simulation/entities/*/state.md` 或 `simulation/subjects/*/state.md` | NPC-A 持有某个碎片；某扇门已锁定。 |
| memory relation | `simulation/subjects/*/memory.jsonl` | NPC-A 只知道自己碎片的能力，不知道其他碎片。 |
| event relation | `events.jsonl` | NPC-A 在十年前从流亡精灵口中听说翠梦晶露。 |

这些关系可以互相引用，但不会自动互相泄露信息。

## Examples

三瓶普通血药：

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: 血药
    quantity: 3
    subjectKnownEffect: 通常用于恢复伤势
```

一瓶被下毒的血药：

```yaml
inventory:
  - entity: simulation/entities/poisoned-blood-potion-001/
    subjectVisibleName: 血药
```

世界之心三块碎片：

```text
lorebook/item/artifact/world-heart/
simulation/entities/world-heart-fragment-a/
simulation/entities/world-heart-fragment-b/
simulation/entities/world-heart-fragment-c/
```

每个持有者的 `memory.jsonl` 只记录自己知道或相信的碎片信息，`events.jsonl` 记录它如何获得这些认知。不能因为 state 引用了 entity 或 entity 引用了 lorebook，就把全知规则暴露给 subject。

## Deferred Schema

后续再设计：

- lorebook 如何声明“谁默认知道什么、谁不知道什么”。
- `memory.jsonl` 如何覆盖 lorebook 级默认声明。
- entity hidden state 如何转换为 subject-facing observation。
- simulator leader、subject simulator、entity simulator、writer、retrieval 分别能读取哪些正文分区。
- GraphRAG 如何表示 `who knows what`、`who holds what`、`what is where`。
- 未来 workflow/job 如何把上帝视角设定过滤成 subject-facing context，并显式交给 actor。

当前只固定原则：目录先分层，`lorebook/` 放 canonical / prototype，`simulation/subjects/` 放 information subject，`simulation/entities/` 放 stateful instance，`simulation/runs/` 放 run artifacts。
