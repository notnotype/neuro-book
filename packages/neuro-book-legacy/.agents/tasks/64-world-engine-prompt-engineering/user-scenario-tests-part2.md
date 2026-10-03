# World Engine 用户场景测试 - Part 2：Writer 协作

> 创建日期：2026-06-22
> 来源：Task 64 用户体验设计讨论（续）

> Legacy note：本文保留 Writer 协作早期草案，示例里仍可能出现 `get_world_state`、`list_world_slices`、`mutations` 等旧协议。当前实现以 `reference/world-engine/api-migration-zod.md`、`novel-workflow-08-plot-planning` 和 `novel-workflow-09-chapter-writing` 为准：writer 通过 `execute_world_query` 只读查询，leader 用 `write_world_slice` 的 `patches` 写入状态。

本文档是 [user-scenario-tests.md](user-scenario-tests.md) 的续篇，专注于 Writer 协作场景。

---

## 场景 5：进入 Writer 写正文

### 前提状态

**剧情已设计完成**：
- 时间：星辉历 312 年 风信之月 5 日
- 薇洛丝解除莉雅的封印
- 遇见分散开来的邪教徒队长
- 本章结束到邪教徒队长拔剑出手

**World Engine 状态**：
- 薇洛丝：位于星陨遗迹，HP 80/100
- 莉雅：刚被解封，状态待定
- 邪教徒队长：从小队中拆分出独立 subject

### 用户输入

> "开始写第一章，就写刚才设计的剧情。"

---

### NeuroBook Leader 理想行为

#### 1️⃣ **确认章节并先演化世界状态**

```
好的，我来准备第一章的写作。

让我先确认一下章节结构和当前世界状态...

[调用工具检查 manuscript]
[如果没有章节，先创建]

bash("workspace node new project-slug/manuscript/001-volume --type volume --title 第一卷")
bash("workspace node new project-slug/manuscript/001-volume/001-chapter --type chapter --title 第一章")

现在我需要先推进世界状态，把刚才设计的剧情事件记录到 World Engine。
```

#### 2️⃣ **推进 World Engine 状态（写作前）**

**关键原则**：**先演化世界 + 设计剧情，然后再调用 writer**

```typescript
// Leader 先完成世界演化，记录剧情事件

// 事件 1：莉雅被解封
write_world_slice({
  projectPath: "workspace/xxx",
  time: "星辉历312年 风信之月 5日 10:30:00",
  title: "薇洛丝解除莉雅的封印",
  mutations: [
    { subjectId: "liya", attr: "status", op: "set", value: "被解封，部分失忆" },
    { subjectId: "liya", attr: "mind", op: "set", value: "迷茫、虚弱，但本能记得魔法" },
    { subjectId: "liya", attr: "location", op: "set", value: "subject://ruins-meteor" },
    { subjectId: "weiluosi", attr: "events", op: "listAppend", 
      value: "风信之月5日10:30：解除了银发红瞳女孩莉雅的封印。" }
  ]
})

// 事件 2：两人短暂交流
write_world_slice({
  projectPath: "workspace/xxx",
  time: "星辉历312年 风信之月 5日 11:00:00",
  title: "薇洛丝与莉雅初次交流",
  mutations: [
    { subjectId: "weiluosi", attr: "mind", op: "set", value: "好奇、想要了解这个女孩" },
    { subjectId: "liya", attr: "mind", op: "set", value: "困惑，只记得自己的名字" }
  ]
})

// 事件 3：邪教徒队长追入
write_world_slice({
  projectPath: "workspace/xxx",
  time: "星辉历312年 风信之月 5日 11:30:00",
  title: "邪教徒队长卡尔追入遗迹深处",
  mutations: [
    { subjectId: "cultist-captain", attr: "location", op: "set", 
      value: "subject://ruins-meteor" },
    { subjectId: "cultist-captain", attr: "status", op: "set", 
      value: "发现两人，警惕观察" }
  ]
})

// 事件 4：认出项链并拔剑
write_world_slice({
  projectPath: "workspace/xxx",
  time: "星辉历312年 风信之月 5日 12:00:00",
  title: "邪教徒队长认出古代魔女项链",
  mutations: [
    { subjectId: "cultist-captain", attr: "status", op: "set", 
      value: "认出古代魔女项链，准备攻击" },
    { subjectId: "cultist-captain", attr: "mind", op: "set", 
      value: "震惊、警惕、杀意" },
    { subjectId: "weiluosi", attr: "mind", op: "set", value: "紧张、准备应战" },
    { subjectId: "liya", attr: "mind", op: "set", value: "本能感知到危险" }
  ]
})

世界状态演化完成。现在来准备 writer brief。
```

#### 3️⃣ **准备简化的 Writer Brief**

**关键调整**：Writer 现在拥有查询 World Engine 的能力，所以 brief 应该简化。

**Brief 简化原则**：

| 应该传递 | 不需要传递 |
|---------|----------|
| 章节目标和剧情点 | 详细的角色状态 |
| 信息控制要求 | 完整的世界状态 |
| 写作约束（视角、节奏） | HP/位置等细节 |
| 建议读取的 lorebook | 时间线完整记录 |
| World Engine 查询提示 | mutation 细节 |

**调用 Writer**：

```typescript
// Leader 调用 writer
invoke_agent({
  agentId: "writer-xxx",
  message: `
请写第一章正文。

**章节目标**：
薇洛丝解除莉雅的封印，两人短暂交流。邪教徒队长追入遗迹深处，认出古代魔女项链并拔剑出手。

**关键剧情点**：
1. 薇洛丝尝试与莉雅沟通，莉雅苏醒
2. 莉雅失忆，只记得自己的名字，但本能记得魔法
3. 邪教徒队长卡尔独自追入，发现两人
4. 卡尔认出莉雅脖子上的古代魔女项链，脸色大变
5. 卡尔拔剑相向（章节在此结束，制造悬念）

**时间范围**：
星辉历312年 风信之月 5日 10:30 - 12:00

**信息控制**：
- 薇洛丝视角：她不知道莉雅的真实身份、被封印的原因、项链的意义
- 莉雅视角：她失去了大部分记忆，不知道自己被封印了多久，不知道外面的世界
- 卡尔视角：他从教会典籍中见过古代魔女项链的记载，认出了标志，但不确定这个女孩是谁

**写作要求**：
- 第三人称，主要跟随薇洛丝视角
- 前半部分：神秘感、探索感（发现莉雅、尝试沟通）
- 后半部分：紧张感、危机感（卡尔追入、认出项链）
- 章节结束在卡尔拔剑的瞬间

**World Engine 查询建议**：
你可以使用 get_world_state 查询角色的当前状态（HP、位置、心理状态等）。
查询时间范围：星辉历312年 风信之月 5日 10:00 - 12:00
  `,
  input: {
    path: "project-slug/manuscript/001-volume/001-chapter/index.md",
    context: {
      lorebookEntries: [
        "project-slug/lorebook/character/weiluosi/",
        "project-slug/lorebook/character/liya/",
        "project-slug/lorebook/character/cultist-captain-karl/",
        "project-slug/lorebook/location/ruins-meteor/"
      ]
    }
  }
})
```

#### 4️⃣ **Writer 执行写作**

Writer 的工作流程：

1. **读取 lorebook**：
   ```typescript
   // 读取角色设定
   read("project-slug/lorebook/character/weiluosi/index.md")
   read("project-slug/lorebook/character/liya/index.md")
   read("project-slug/lorebook/character/cultist-captain-karl/index.md")
   read("project-slug/lorebook/location/ruins-meteor/index.md")
   ```

2. **查询 World Engine（Writer 自主查询）**：
   ```typescript
   // Writer 自己调用 get_world_state
   get_world_state({
     projectPath: "workspace/project-slug",
     subjectIds: ["weiluosi", "liya", "cultist-captain"],
     at: "星辉历312年 风信之月 5日 12:00:00"  // 章节结束时刻
   })
   // 返回：
   // weiluosi: HP 80/100, location: ruins-meteor, mind: "紧张、准备应战"
   // liya: status: "被解封，部分失忆", mind: "本能感知到危险"
   // cultist-captain: status: "认出项链，准备攻击", mind: "震惊、警惕、杀意"
   ```

3. **构思并写入正文**：
   ```typescript
   write("project-slug/manuscript/001-volume/001-chapter/index.md", `
   # 第一章
   
   [正文内容...]
   `)
   ```

4. **llmlint 检查**（如果配置）：
   ```bash
   bun .nbook/agent/skills/llmlint/bin/llmlint.ts check project-slug/manuscript/001-volume/001-chapter/index.md
   ```

5. **报告结果**：
   ```typescript
   report_result({
     result: "已写入 project-slug/manuscript/001-volume/001-chapter/index.md，约3000字。本章讲述薇洛丝解封莉雅，两人短暂交流后遭遇邪教徒队长，队长认出古代魔女项链并拔剑相向。"
   })
   ```

#### 5️⃣ **Leader 章节完成后处理（可选）**

```
Writer 已完成第一章。

[读取 writer 的输出]

让我检查一下 writer 的成果...

[读取章节正文，分析是否有超出 brief 的自由发挥]

Writer 基本按照 brief 完成了写作。有一些细节上的自由发挥：
- 增加了薇洛丝观察遗迹环境的描写
- 补充了莉雅苏醒时的细节反应
- 卡尔在拔剑前有一段内心独白

这些都在合理范围内，丰富了故事细节，不需要补回 World Engine。

【如果用户允许 writer 有更大的自由度】
例如：writer 增加了新角色、改变了剧情走向、角色受伤超出预期等
我会在这个阶段补充相应的 World Engine 记录。

完成！第一章已写入。

**本章摘要**：
薇洛丝在星陨遗迹深处发现被水晶封印的银发红瞳女孩莉雅。在好奇心驱使下，她尝试解除封印，莉雅苏醒但失去了记忆，只记得自己的名字。两人短暂交流后，追踪而来的邪教徒队长卡尔独自闯入。卡尔看到莉雅脖子上的项链后脸色大变，认出了古代魔女的标志，拔剑相向。

**下一步**：
1. 继续写第二章（战斗场景）？
2. 先设计第二章剧情？
3. 补充一些设定？
```

---

## 关键设计调整说明

### 调整前的问题（错误理解）

❌ **Writer 先写，Leader 后补**：
```
错误流程：
1. Leader 准备 brief
2. Writer 写正文
3. Writer 完成后，Leader 更新 World Engine
```

**问题**：
- Writer 承担了部分剧情设计职责
- World Engine 滞后于正文
- 世界状态不一致

❌ **Brief 过于详细**：
```
错误做法：
Leader 把所有状态都查询好，写成详细的 brief 传给 Writer
- 薇洛丝：HP 80/100，位于星陨遗迹，心理"震惊、好奇"
- 莉雅：银色长发，红瞳，刚被解封，失忆状态
- [大量状态细节...]
```

**问题**：
- Writer 变成纯执行者，缺少自主性
- Brief 过长，信息冗余
- 没有利用 Writer 的 World Engine 查询能力

---

### 调整后的正确理解

✅ **推荐流程（标准）**：
```
正确流程：
1. Leader 与用户讨论剧情设计
2. Leader 推进 World Engine（记录剧情事件）← 关键：写作前完成
3. Leader 准备简化 brief（只传剧情点、信息控制、约束）
4. Writer 自己查询 World Engine，写正文
5. Leader 检查成果，处理 writer 的自由发挥（如果有）
```

**优势**：
- 世界状态先行，保证一致性
- Writer 有自主查询能力，不是纯执行者
- Brief 简洁，只传必要信息
- Leader 保持剧情设计的主导权

✅ **Writer 的能力与职责**：

| 能力 | 说明 |
|------|------|
| ✅ 查询 World Engine | `get_world_state`, `list_world_slices`（只读） |
| ✅ 读取 lorebook | 角色设定、地点描述、规则等 |
| ✅ 自主查询状态 | 根据需要查询角色 HP、位置、心理等 |
| ✅ 写作自由度 | 可以在 brief 框架内发挥细节 |
| ❌ 写入 World Engine | 不能调用 `write_world_slice` |
| ❌ 创建 subject | 不能调用 `create_world_subject` |
| ❌ 剧情设计 | 不应承担主线剧情设计职责 |

✅ **Leader 的职责**：

| 阶段 | 职责 |
|------|------|
| **写作前** | 1. 与用户讨论剧情<br>2. 推进 World Engine（记录事件）<br>3. 准备简化 brief |
| **写作中** | 调用 writer，等待完成 |
| **写作后** | 1. 检查成果<br>2. 处理 writer 的自由发挥<br>3. 补充 World Engine（如果需要） |

---

## 两种工作模式对比

### 模式 A：标准模式（推荐）

**适用**：正常章节写作

**流程**：
```
Leader 设计剧情 → Leader 推进 WE → Writer 写正文 → Leader 检查
```

**优势**：
- 世界状态先行，一致性强
- Leader 掌控剧情设计
- Writer 专注写作质量
- 适合结构化创作

---

### 模式 B：Writer 自由发挥模式（可选）

**适用**：探索性写作、即兴创作

**流程**：
```
Leader 给大致方向 → Writer 自由发挥（包括剧情细节）→ Leader 补回 WE
```

**要求**：
- 用户明确允许 writer 自由发挥
- Leader 在写作后补充 World Engine
- 需要 Leader 有能力分析正文，提取状态变化

**示例**：
```
用户："让 writer 自由发挥，我想看看会写出什么。"

Leader brief：
"薇洛丝和莉雅遇到邪教徒，发生战斗。你可以自由发挥战斗细节、结果和意外情况。"

Writer 自由发挥：
- 增加了新角色（邪教徒副队长）
- 薇洛丝受伤更严重（HP -40 而非预定的 -20）
- 莉雅使用了未预设的冰系魔法

Leader 写作后：
[读取正文，分析变化]
[补充 World Engine]
- 创建邪教徒副队长 subject
- 更新薇洛丝 HP（-40）
- 补充莉雅的冰系魔法溯源
```

**注意**：
- 这种模式文字生成快，但需要更多后处理
- Leader 需要有能力从自然语言正文中提取状态变化
- 适合实验性、探索性的写作场景
- 不适合需要严格控制剧情走向的场景

---

## 相关文档

- [user-scenario-tests.md](user-scenario-tests.md)：场景 1-4（初始化、人物设计、剧情推进）
- [recording-principles.md](recording-principles.md)：World Engine 记录原则
- [reference/agent/leader-default.md](../../../reference/agent/leader-default.md)：Leader 协作规范
- [assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx](../../../assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx)：Writer profile 定义
- [assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing/SKILL.md](../../../assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing/SKILL.md)：章节写作 skill
