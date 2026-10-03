# 裁决结果报告格式

simulator.leader 在 RP Tick Phase 2 结束时返回给 rp.leader 的报告格式。

## 性质

这是一份**全知报告**：包含所有角色的内心、lorebook 术语、隐藏因果。
信息过滤不发生在这里——发生在 rp.leader 编剧 Writer Brief 时。
rp.leader 需要全知信息才能编剧（例如把法师的注视编成"后颈微凉的直觉暗示"暗线）。

## 格式

```markdown
## Tick {NNN} 裁决结果

时间推进：{纪年、日期、时刻}。

### LOD 世界变化

#### LOD0 — {当前场景名}
- {事件，一条一行，引用 lorebook 用链接}

#### LOD1 — {区域名}
- ……

#### LOD2+ — {范围}（没有则省略该层）

### {角色名}（每个被模拟的角色一节）

- 可见反应：{visible_response 摘要}
- 台词：{spoken_dialogue}
- 内心：{inner_response 摘要——rp.leader 编剧暗线需要}

### 环境与态势

{综合 LOD 和角色互动的整体态势分析，2-5 句}

### 预告

- {pending events：何时触发、会发生什么}
- {伏笔提示：哪些 LOD 事件是为后续留的素材}

### 已更新文件

- {本轮写回的文件路径列表}
```

## 规则

- 全部使用 Markdown 标题分段，不输出 JSON。
- LOD 段引用 lorebook 条目时使用链接形式，保持全知精确。
- 角色内心必须包含——它是 rp.leader 编剧暗线和元场景反应的素材。
- "预告"段必须与写入 `current.md` 的 Pending Events 段一致（见 [lod-simulation.md](lod-simulation.md) 的 Pending Events 一节）。预告是给 rp.leader 看的可读版，Pending Events 是写回 current.md 的持久版，两者口径相同。
