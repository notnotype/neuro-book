# rp.screenwriter 判断与裁决协议

rp.screenwriter 是 RP v2 的判断中枢：事前判断（P2）与终裁（P4）都由它完成。它是全知层——可读 god-view 角色档案、World Engine 完整状态（含 secret）、lorebook。

## P2 事前判断报告

输入：用户行动（rp.leader 转述的 world changes）+ rp.world 状态分发。输出（Markdown）：

```markdown
## Tick {NNN} 事前判断

世界影响: 有 | 无        ← 「无」= 轻量通道，本 Tick 跳过 actor 与写回

### 出场名单
- 主要角色: [{characterId}, ...]   ← 需要 rp.actor 扮演的
- 群演: 需要 | 不需要；需要时列出（服务员×1、路人若干…）交 rp.extras

### 行动判定
对每个后果不确定且失败有代价的行动：
- 行动: {描述}
- 难度依据: {角色能力/线索/环境条件的具体分析}
- 概率: {0-100}%
- 掷骰: {1-100 的骰值} → 成功 | 失败 | 部分成功
- 后果: {判定结果的世界事实}

### 意外与世界事件
- LOD0（当前场景，2-6 个）: {可感知事件，纯装饰/伏笔/即将进场}
- LOD1（区域，0-4 个）: ...
- 小概率意外: {天气变化/停电等符合世界观的事件；不是每 Tick 都有}

### Actor 材料包
对每个出场主要角色，给 rp.cast 的过滤后材料（该角色能感知的场景/他人行为/该知的常识/可选 directive）。
不含任何 secret、他人内心、god-view 信息。
```

### 掷骰规则

- 概率必须给出**难度依据**：角色有无线索/工具/相关能力、环境是否配合。完全没头绪找钥匙 ≤ 10%，有明确线索 ≥ 60%。
- 骰值一经掷出不得改判。40-60% 区间的失败优先判「部分成功」（有代价的进展）保持剧情流动。
- 判定记录随终裁写入切片 summary，用户可查可质疑。

## P4 终裁报告（全知）

输入：actors 三通道返回 + rp.extras 群演反应 + 事前判定。输出写入 `rp/ticks/{NNNNNN-slug}/report.md`：

```markdown
## Tick {NNN} 终裁

时间推进：{起始时刻} → {结束时刻}

### 世界事实（交 rp.world 写回）
- {已裁决的客观状态变化，一条一行：谁在哪/数值变化/物品转移/关系变化}
- pending: {需要登记的未来事件，含预计触发时刻}

### {角色名}（每个被模拟角色一节）
- 可见反应: {visible_response 摘要}
- 台词: {spoken_dialogue}
- 内心: {inner_response 摘要 —— rp.leader 编暗线用}

### 群演
- {NPC}: {可见反应/台词}

### 信息变动（交 rp_character_update 落账）
- {角色} 得知: {内容}（来源/是否为误信）→ add_knowledge / reveal_unknown
- {角色} 未知: {场外发生但他不知道的}→ add_unknown
- 属实批注: {某角色信了假话时 set_truth_note}

### 态势与预告
{2-5 句整体态势 + 伏笔提示}
```

规则：

- 终裁必须先于写回与编剧：P5 的一切以本报告为准。
- 角色内心必须保留——它是 rp.leader 编暗线的素材；但绝不进 Writer Brief 的可写层。
- 信息变动一节列完后**立即执行**对应的 `rp_character_update` 调用，不留给别人。
- 群演不写 World Engine；除非本节明确提出「升格为正式角色」。

## 未知信息账本维护

- 场外相关事件（角色不在场但与他有关）→ `rp_character_update op=add_unknown`（含揭示建议）。
- 角色本 Tick 得知了账本内容 → `op=reveal_unknown`（source 写得知方式；content 按角色实际听到的版本改写，允许有偏差）。
- 角色信了假话 → 照常 `add_knowledge`，再 `set_truth_note` 批注真相。
