# RP v2 角色信息与记忆体系

> RP 模式 v2 的角色主观认知存储协议。客观世界状态归 World Engine（worldKey="rp"），本体系管「角色以为什么」——两边独立演进，偏差即剧情。设计背景见 docs/tasks/100-rp-mode-v2/README.md。

## 目录布局

```
rp/characters/{characterId}/
├── 人设/
│   ├── soul.md          第一人称扮演手册（沿用 subject-creation-guide 的写法）
│   └── 心境.md          短期情绪/意图/悬念，每 Tick 更新
├── 已知信息/
│   └── knowledge.md     状态性知识（K 条目），永不老化，原地更新
├── 未知信息(god-view)/
│   ├── ledger.md        未知信息账本（U 条目）：角色不知道但与他相关的事
│   └── truth-notes.md   已知条目的属实批注（K 条目为假/存疑时）
├── 记忆/
│   ├── 摘要.md          三级粒度滚动（远期段落 / 中期行 / 近期每 Tick 一行）
│   └── ticks/TickNNNNNN.md  该角色视角的当 Tick 详情
├── events.jsonl         RAG 联想通道（经历流，追加式）
└── memory.jsonl         RAG 联想通道（稳定认知）
```

## 铁律

1. **god-view 隔离**：`未知信息(god-view)/` 目录内容绝不注入 actor。只有 rp.screenwriter（终裁/揭示设计）与 rp.leader（编暗线）可读。`rp_character_recall` 的 `view="god"` 同理。
2. **信念非真相**：knowledge.md 存角色「相信的」——被骗、误解照记，每条带来源与得知 Tick。条目是否属实由 god-view 的 truth-notes.md 批注，角色永远看不到批注。
3. **知识不老化，事件才归档**：状态性知识（关系、物品位置、身份）常驻 knowledge.md，内容变化原地更新；事件性经历进 `记忆/ticks/`，由摘要滚动压缩管理时间跨度。
4. **详情按角色视角写**：非化身角色的 TickNNN.md 由该角色的三通道输出（可见反应/台词/内心）+ 它感知到的事件拼成；**不得**粘贴全知 prose 原文（会让角色记住没经历过的事）。用户化身的详情可引用 prose 原文（prose 就是化身视角）。
5. **渐进式回忆**：先读摘要（便宜索引）→ 摘要行命中需要细节时再读对应 Tick 详情 → RAG（events/memory jsonl）补语义联想。不要一次性把全部详情塞进上下文。

## 工具

| 工具 | 用途 | 权限层 |
| --- | --- | --- |
| `rp_character_recall` | 渐进式回忆：不带 ticks 取人设/心境/已知/摘要；命中后带 `ticks:[n]` 细读详情。`view="god"` 附加未知账本与属实批注 | actor 用 actor 视图；god 视图仅编剧/主持 |
| `rp_character_update` | ensure / write_soul / write_mood / add_knowledge / update_knowledge / add_unknown / reveal_unknown / set_truth_note | god-view 操作仅编剧/主持 |
| `rp_memory_commit` | 每角色每 Tick 一次：写详情 + 摘要近期行 + 可选心境；返回 rollupNeeded 时自行生成概括再调 rollup_* | 记忆维护步骤 |

## Tick 结束时的记忆维护流程

对每个本 Tick 参与的角色：

1. 组装该角色视角的详情（其 actor 三通道输出 + 收到的 packet 感知内容；化身用 prose）。
2. `rp_memory_commit`：detail + summaryLine（在本 Tick 与谁经历了什么）+ mood（心境有变化时）。
3. 有新知识 → `rp_character_update op=add_knowledge`（含来源与 tick）；旧知识变化 → `update_knowledge`。角色被骗时照样记入，再用 `set_truth_note` 批注真相。
4. rp.screenwriter 维护未知信息：场外相关事件 → `add_unknown`；本 Tick 角色得知了某条 → `reveal_unknown`（source 写得知方式，content 可按角色实际听到的版本改写）。
5. 结果返回 `rollupNeeded: true` 时：读摘要近期段最旧的 5-10 行，自行概括成一行，调 `rp_memory_commit op=rollup_recent_to_mid`；中期超过约 10 行时同理 `rollup_mid_to_far` 压缩成远期段落。

## 文件格式（工具自动维护，手工编辑需遵守）

**knowledge.md**（K 条目，`## K001 主题` 分节）：

```markdown
## K001 钥匙的位置
- 内容: 东塔书房的钥匙放在管家房间的抽屉里
- 来源: 管家亲口告知
- 得知: Tick 3
- 更新: Tick 7
```

**ledger.md**（U 条目）：

```markdown
## U001 挚友的行踪
- 内容: 挚友已于 Tick 5 离开城镇前往北方
- 发生: Tick 5
- 揭示建议: 通过旅店老板的闲聊
```

**truth-notes.md**（按 K id 批注）：

```markdown
## K003
- 属实: 否
- 真相: 子爵在撒谎，钥匙其实在法师手里
```

**摘要.md**：

```markdown
# 记忆摘要

## 远期

Tick 1-50：被召唤到异界，与三名同伴在子爵城堡，与眼镜女生建立信任。

## 中期

- [Tick 051-060] 初次进城与公会接触

## 近期

- [Tick 61] 在公会大厅接下讨伐委托
- [Tick 62] 与薇洛丝确认出发时间
```

**ticks/Tick000062.md**：

```markdown
---
tick: 62
time: "公元1年2月3日 09:00"
participants: [erina, veloce]
---

（该角色视角的详情正文）
```
