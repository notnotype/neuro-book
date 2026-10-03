---
id: player
name: 玩家角色
kind: player
profile: simulator.actor
controlledBy: user
canonicalSource: null
---

# Player Subject（全知秘密档）

> **信息控制原则（创建者必读）**
>
> - 本文件是**全知档**，只有上级模拟器（simulator.leader）可见，actor 主路**永远读不到**它。可以在这里写隐藏真相、未来安排、作者意图。
> - 角色**自己知道**的部分写进同目录的 `soul.md`（第一人称扮演手册，会被直接注入 actor 本人）。
> - **秘密绝不写进 soul.md**，否则角色会带着不该知道的真相自觉演，必然穿帮。
> - 信息按稳定性分流：稳定人设写 `soul.md`；会变的经历写 `events.jsonl`，会变的稳定看法写 `memory.jsonl`，当前想法写 `mind.md`，可见状态写 `state.md`。
> - `subject.md` 与 `soul.md` 都**不进 Subject RAG 索引**；RAG 只索引 `events.jsonl` / `memory.jsonl`。

## 角色定位（给上级模拟器）

这个 subject 代表玩家操控的故事内角色。上级模拟器读本文件理解玩家角色的身份、能力边界与剧情位置，但**不能替用户决定核心行动**。

- 名称：玩家角色
- 角色定位：待填写
- 在剧情中的位置：待填写

## 行动边界（player 纪律）

- 用户每 Tick 的输入是最高优先级。
- 上级模拟器只能把用户输入转译成故事内意图，不能擅自扩展成用户没表达的关键选择。
- 用户输入模糊时，可做最小合理解释；影响重大时让 writer 在正文中自然暴露不确定性，或在下一轮询问。
- 调用 player actor 时，directive 要写得更具体（player actor 以 directive 为骨架第一人称复述，不自由发挥）；但 directive 不得替用户新增关键行动、台词、情绪或目标。

## 隐藏设定与真相（actor 不可知）

> 这里写玩家角色**自己还不知道**、但作者/上级模拟器需要掌握的真相。这些内容只用于上级裁决，绝不进 packet、绝不进 soul.md、绝不进 RAG。

- 待填写（示例：玩家角色的真实身世、被隐瞒的过去、尚未触发的剧情钩子）。

## simulator.leader 调度提示

- 调 player actor 时传 `kind: "player"`。
- 把用户本轮输入转成戏内 `<directive>` 骨架，再交给 actor 第一人称自然化；不要让 actor 替用户自创关键决定。
- 玩家角色的稳定身份、资源、可见限制由 `soul.md` 提供；隐藏真相由本文件提供，只供你裁决。
