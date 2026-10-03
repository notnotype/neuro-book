# 环节二：拍板落库

用户确认剧情事实后，把这些事实落到三个真相源：

- **World Engine**：动态状态与时间线（本环节主体）。
- **Plot Workbench**：剧情结构——Thread / Scene / Chapter、Promise 承诺账本、Decision 决策记录。剧情设计确认后用 plot 写工具（`save_*`）更新对应实体；重大剧情取舍记 Decision（ADR，risk 必填）。
- **lorebook**：拍板过程中新产生的**稳定**设定（新势力底设、新规则），回填到对应内容节点；动态事实不要倒灌成稳定世界设定。

## 确认剧情事实

写入前必须把将要成为 canon 的内容用人话对齐。示例：

> 那这一段我理解为：薇洛丝进入遗迹深处，解除莉雅封印；莉雅失忆，只记得名字；邪教徒队长追入，认出项链，章末拔剑。这个版本确定记进时间线吗？

用户确认后再写。若用户只是说“可以先看看”“你推一下”，回环节一继续讨论，不写入。

## LOD 粒度判断

写入前先判断叙事粒度。LOD 用于决定“要不要建 subject、切面写多细、哪些只做氛围”。

| LOD | 范围 | 记录方式 |
| --- | --- | --- |
| LOD0 当前场景 | 主角视角附近，正在发生的动作、对话、战斗、选择 | 细记。关键对话、战斗回合、位置/HP/认知变化可拆多条 slice。 |
| LOD1 区域动向 | 同一地点或附近区域，能影响当前场景的其他角色/势力 | 中等粒度。只记录会影响当前剧情的动向。 |
| LOD2 远处世界 | 远方势力、背景变化、伏笔和世界事件 | 粗记。通常一条摘要 slice，不展开细节个体。 |
| LOD3 氛围/群体 | 天气、路人、城镇氛围、普通巡逻、背景人群 | 一般不建 subject，只写进相关事件摘要或正文 brief。 |

提升为 subject 的条件：

- 有名字、会对话、会再次出现，或需要追踪独立状态。
- 会持有关键物品、掌握秘密、改变关系或影响后续剧情。
- 群体先用单一 subject，例如“邪教徒巡逻队”；群体中某个个体变重要时，再拆成独立 subject。
- 临时角色不建 subject，只在主角或地点的事件文本里提及。

切片粒度判断：

- 当前场景细，视角之外粗。
- 新发生的事件细，旧背景粗。
- 战斗、关键对话、关系转折细；赶路、休息、日常过渡粗。
- 只记录后续会读取、引用或依赖的事实，不记录每个细节动作。

## 拆成 World Engine 事件

把确认后的剧情事实拆成状态变化：

- 时间：发生在项目日历里的哪一天、几点或哪个代表时刻。
- 地点：谁移动到了哪里；地点是否首次变重要。
- 角色状态：HP、心理、目标、处境、身份暴露、当前关系。
- 认知变化：谁知道了什么、误解了什么、仍不知道什么。
- 物品变化：获得、失去、装备、损坏、发现来历。
- 势力变化：部署、追捕、撤退、结盟、暴露意图。
- 回溯补设定：当前剧情需要某能力、知识、身份或物品来历时，向过去插一条 backstory slice。

## 写入 World Engine

使用 `execute_world` 里的 `world.slice.write` 写入。一个 slice 对应一个有叙事意义的时间点，同一时间点发生的多 subject 变化可以放进同一个 slice。

写入前先查目标时间附近是否已有 slice，避免同一时间点冲突；查询返回的 E issues 需要先修。

写入规则：

- 时间一律用项目 `calendar.ts` 能 parse 的日历字符串；禁止 raw instant。
- 默认模板使用公历数字年月日，格式到分钟、不带秒；不要凭空发明月份名或添加 format 里没有的空格。
- 首次写入新 subject 时，在该 subject 任意 patch 上声明 `type`，可选 `name`。
- 同一 instant 只能有一个 slice；冲突时先查已有 sliceId 和 patchId，再用 `world.slice.editPatches` 合并或修正。只有整条切面作废时才用 `world.slice.delete`。
- 用 `increment` 记录数值增减，用 `append` 记录经历、知识、技能、集合新增，用 `replace` 记录绝对状态。
- 引用已有 subject 前先查询确认 id 与 type。

写入示例：

```javascript
const time = world.time.parse("公元2020年4月12日 18:30");
await world.slice.write({
    time,
    title: "薇洛丝解除莉雅的封印",
    patches: [
        {subjectId: "liya", type: "character", name: "莉雅", path: "/status", op: "replace", value: "被解封，部分失忆"},
        {subjectId: "liya", path: "/location", op: "replace", value: "subject://ruins-meteor"},
        {subjectId: "weiluosi", path: "/events", op: "append", value: {text: "在星陨遗迹深处解除了莉雅的封印"}}
    ]
});
```

## 处理 issues

写入、删除或查询后检查 issues：

- `severity: "error"` 是持久数据错误，必须修。
- `severity: "advisory"` 是补过去时的提醒，确认语义即可。
- 向用户解释时使用返回的 `title`、`message`、`explanation`，不要把 code 直接抛给用户。

## 更新 Plot Workbench

状态落库后，把剧情结构同步进 Plot：

- 本段剧情属于哪条 Thread、哪个 Scene、哪一章，用 plot 写工具更新或创建。
- 新立的读者承诺（伏笔、期待）记入 Promise；已兑现的标记 fulfilled。
- 重大剧情取舍（选了 A 弃了 B）记 Decision，写明 chosenOption 与 risk。
- 准备写章节时，Chapter 的剧情点、信息控制先补齐，供 `get_chapter_writer_brief` 编译。

## 回报当前状态

写完后只回报人读摘要：

- 新增了哪几段时间线。
- 当前角色、地点、势力或物品状态。
- 新增或更新了哪些 subject / Plot 实体。
- 是否有未定问题。
- 是否可以进入环节三（`03-chapter-loop.md`）写正文。

不要贴 patch JSON，不复述工具入参。
