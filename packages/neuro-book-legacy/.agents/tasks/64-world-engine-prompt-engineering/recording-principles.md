# World Engine 使用原则：最少支持当前叙事

> 创建日期：2026-06-22
> 来源：Task 64 用户场景测试讨论

## 核心原则

**最少支持当前叙事原则**：在世界引擎中记录的内容应该是"支持当前叙事所必需的最少信息"，而不是试图记录所有细节。

## 具体指导

### 1. 群体角色处理

**问题**：出场了一组邪教徒（3-5人），如何记录？

**错误做法**：
```typescript
// ❌ 为每个邪教徒创建独立 subject
create_world_subject({ id: "cultist-1", name: "邪教徒A" })
create_world_subject({ id: "cultist-2", name: "邪教徒B" })
create_world_subject({ id: "cultist-3", name: "邪教徒C" })
// ...
```

**正确做法**：
```typescript
// ✅ 使用一个 subject 表示整个小队
create_world_subject({ 
  id: "cultist-patrol-01", 
  name: "邪教徒巡逻队"
})

// 记录 1-2 条关键切片
// 切片 1：起因（为什么出现）
write_world_slice({
  time: "星辉历312年 风信之月 3日",
  title: "邪教徒巡逻队接受任务",
  mutations: [
    { subjectId: "cultist-patrol-01", attr: "status", op: "set", 
      value: "接到探索星陨遗迹的任务" },
    { subjectId: "cultist-patrol-01", attr: "leader", op: "set", 
      value: "[队长名字待定]" },
    { subjectId: "cultist-patrol-01", attr: "members", op: "set", 
      value: "3-5人" }
  ]
})

// 切片 2：当前状态
write_world_slice({
  time: "星辉历312年 风信之月 5日",
  title: "邪教徒巡逻队到达遗迹",
  mutations: [
    { subjectId: "cultist-patrol-01", attr: "location", op: "set", 
      value: "subject://ruins-meteor" }
  ]
})
```

**精细化原则**：
- 只有当某个个体变得"对叙事重要"时，才拆分出独立 subject
- 例如：邪教徒队长成为重要角色，与主角产生互动

```typescript
// ✅ 需要时再精细化
create_world_subject({ 
  id: "cultist-captain", 
  name: "邪教徒队长"
})

// 从小队中分离
write_world_slice({
  time: "星辉历312年 风信之月 5日 12:00:00",
  title: "邪教徒队长与主角对峙",
  mutations: [
    { subjectId: "cultist-captain", attr: "status", op: "set", 
      value: "与薇洛丝对峙" },
    // 小队其他成员仍用原 subject
    { subjectId: "cultist-patrol-01", attr: "status", op: "set", 
      value: "队长与目标对峙，其他成员警戒" }
  ]
})
```

---

### 2. 切片数量控制

**原则**：每个 subject 通常只需要 1-2 条切片来建立"起因 + 当前状态"。

**示例**：邪教徒巡逻队
- **切片 1（起因）**：他们为什么存在？接受了什么任务？由谁派遣？
- **切片 2（当前状态）**：他们现在在哪？正在做什么？

**不要**：记录每一个细节行动
```typescript
// ❌ 过度记录
write_world_slice({ title: "邪教徒出发" })
write_world_slice({ title: "邪教徒路过A地" })
write_world_slice({ title: "邪教徒休息" })
write_world_slice({ title: "邪教徒继续前进" })
write_world_slice({ title: "邪教徒到达遗迹" })
```

**应该**：只记录关键转折
```typescript
// ✅ 关键节点
write_world_slice({ title: "邪教徒接受任务" })  // 起因
write_world_slice({ title: "邪教徒到达遗迹" })  // 当前状态
```

---

### 3. 后续补充设定（溯源）

**场景**：剧情推进中需要补充角色能力或背景。

#### 示例 1：莉雅的魔法能力

**剧情**：薇洛丝和莉雅在遗迹中遇到大石头，无法通行。此时需要莉雅使用魔法。

**补充设定的方式**：

**方式 A：精确溯源**（推荐用于重要能力）
```typescript
// 在过去插入一条切片，说明莉雅何时学会这个魔法
write_world_slice({
  time: "星辉历80年 3月15日",  // 比封印时间早
  title: "莉雅学会岩石魔法",
  kind: "backstory",
  mutations: [
    { subjectId: "liya", attr: "skills", op: "listAppend", 
      value: "岩石操控魔法" },
    { subjectId: "liya", attr: "events", op: "listAppend", 
      value: "星辉历80年：在导师指导下学会岩石操控魔法。" }
  ]
})
```

**方式 B：模糊时间段**（用于不太重要的背景）
```typescript
// 使用一个较早的时间点，记录一段时期的学习
write_world_slice({
  time: "星辉历60年 1月1日",
  title: "莉雅的魔法修行时期",
  kind: "backstory",
  summary: "星辉历60-90年间，莉雅跟随导师学习各种魔法",
  mutations: [
    { subjectId: "liya", attr: "skills", op: "set", 
      value: ["基础元素魔法", "岩石操控", "风系魔法", "水系魔法"] },
    { subjectId: "liya", attr: "events", op: "listAppend", 
      value: "星辉历60-90年：跟随导师学习魔法，掌握多种元素操控能力。" }
  ]
})
```

**当前 World Engine 是否支持模糊时间？**
- ✅ **支持**：可以在 `summary` 中写明时间段（"60-90年"）
- ✅ `time` 字段使用该时间段的起点或某个代表时刻
- ✅ `mutations` 的值可以包含时间段描述
- ⚠️ **注意**：instant 本身是精确时刻，但可以用 `summary` 和 `events` 文本记录时间段概念

#### 示例 2：邪教徒队长认出项链

**剧情**：队长看到莉雅脖颈上的项链，知道了些什么。

**补充设定的方式**：

```typescript
// 1. 为项链创建 subject（如果它很重要）
create_world_subject({
  id: "necklace-ancient",
  type: "item",
  name: "古代魔女的项链",
  time: "星辉历1年 1月1日"
})

// 2. 补充莉雅拥有项链的历史
write_world_slice({
  time: "星辉历50年 6月1日",
  title: "莉雅获得导师的项链",
  kind: "backstory",
  mutations: [
    { subjectId: "liya", attr: "equipment.necklace", op: "set", 
      value: "subject://necklace-ancient" },
    { subjectId: "liya", attr: "events", op: "listAppend", 
      value: "星辉历50年：导师将家族传承的项链赠予莉雅。" }
  ]
})

// 3. 补充队长知道项链来历的设定
write_world_slice({
  time: "星辉历310年 1月1日",  // 队长年轻时
  title: "邪教徒队长了解古代魔女传说",
  kind: "backstory",
  mutations: [
    { subjectId: "cultist-captain", attr: "knowledge", op: "listAppend", 
      value: "认识古代魔女的标志性项链" },
    { subjectId: "cultist-captain", attr: "events", op: "listAppend", 
      value: "星辉历310年：在教会典籍中见过古代魔女项链的记载。" }
  ]
})
```

---

### 4. 何时补充设定？

**触发条件**：
1. **剧情需要角色展现新能力**：补充该能力的来源
2. **角色展现特殊知识**：补充该知识的获得经历
3. **物品/地点突然变得重要**：补充其历史背景
4. **角色间关系需要解释**：补充过去的交集

**补充原则**：
- ✅ **按需补充**：只在叙事需要时补充，不预先填满所有背景
- ✅ **向后插入**：在时间线上更早的时刻插入切片
- ✅ **保持简洁**：1-2 条切片说明关键点即可
- ❌ **不要过度**：不需要为每个细节都补充完整历史

---

### 5. 记录策略总结

| 场景 | 处理方式 | 切片数量 |
|------|---------|---------|
| **群体角色**（邪教徒小队） | 单一 subject 代表整体 | 1-2 条（起因 + 状态） |
| **重要个体**（邪教徒队长） | 需要时拆分出独立 subject | 1-2 条（背景 + 状态） |
| **能力/知识**（莉雅的魔法） | 向后插入切片，溯源能力来源 | 1 条（精确）或 1 条（模糊时间段） |
| **物品/地点**（项链、遗迹） | 首次重要时创建 subject，补充历史 | 1-2 条（来历 + 当前） |
| **临时 NPC**（路人、小怪） | 不创建 subject，只在事件中提及 | 0 条（在主角切片中记录互动） |

---

### 6. Leader 的判断能力

Leader 需要具备以下判断能力：

1. **识别重要性**：
   - 哪些角色/物品/地点需要独立 subject？
   - 哪些只需要在事件文本中提及？

2. **控制粒度**：
   - 群体 vs 个体
   - 精确时间 vs 模糊时间段
   - 详细记录 vs 简略提及

3. **按需补充**：
   - 识别剧情需要补充设定的时机
   - 向后插入合适的切片
   - 保持溯源的合理性和简洁性

4. **避免过度**：
   - 不记录每个细节行动
   - 不为每个龙套创建 subject
   - 不预先填满所有可能的背景

---

## 实施建议

### 在 Leader Profile 中补充

```typescript
// leader.default.profile.tsx 系统提示词增加

# World Engine 使用原则

使用世界引擎时遵循"最少支持当前叙事"原则：

1. **群体角色**：先用单一 subject 表示整体，需要时再拆分重要个体
2. **切片数量**：每个 subject 通常 1-2 条切片（起因 + 当前状态）
3. **按需补充**：剧情需要时向后插入切片，溯源能力/知识/背景
4. **临时角色**：路人、小怪等不创建 subject，只在事件中提及

记录什么：
- ✅ 主要角色的关键状态变化
- ✅ 重要地点、物品的首次出现
- ✅ 支持当前叙事的必要背景
- ❌ 每个细节行动
- ❌ 临时龙套的完整信息
- ❌ 预先填满的所有可能背景
```

### 在 Reference 文档中说明

创建 `reference/world-engine/recording-principles.md`，详细说明这些原则和示例。

### 在 Skill 中体现

`novel-workflow-08-plot-planning` 和 `novel-workflow-09-chapter-writing` 中，引导 Leader 遵循这些原则。

---

## 相关文档

- [docs/tasks/64-world-engine-prompt-engineering/README.md](README.md)
- [docs/tasks/64-world-engine-prompt-engineering/world-engine-initialization-requirements.md](world-engine-initialization-requirements.md)
- [docs/tasks/56-world-engine/README.md](../../56-world-engine/README.md)
