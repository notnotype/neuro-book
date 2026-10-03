# World Engine 用户场景测试

> 创建日期：2026-06-22
> 来源：Task 64 用户体验设计讨论

> Legacy note：本文保留 Task 64 早期用户场景草案，示例里仍可能出现 `create_world_subject`、`get_world_state`、`mutations`、月份名限制等旧协议。当前实现以 `reference/world-engine/api-migration-zod.md`、`novel-workflow-world-engine-init`、`novel-workflow-08-plot-planning` 和 `novel-workflow-09-chapter-writing` 为准：Zod schema + `execute_world_query` / `write_world_slice` / `delete_world_slice` + `patches`。

## 测试目的

通过模拟真实用户场景，验证 World Engine 在写作模式下的协作流程设计是否自然、流畅、符合直觉。

---

## 测试前提

**用户状态**：
- 初次进入 NeuroBook
- 从模板创建了新 project
- 导入了 lorebook（包含世界观设定）

**用户输入**：
> "我要基于此世界观写一个奇幻题材的小说。主角是薇洛丝，大致剧情是薇洛丝转生到异世界然后到世界各地旅行的故事。"

---

## 场景 0：初步意图确认

### Leader 行为

1. **确认理解并读取现状**：
   ```
   好的，我明白了。你想写一个奇幻题材的异世界转生旅行故事，主角是薇洛丝。
   
   让我先看看你导入的 lorebook 内容，了解一下这个世界的基础设定。
   ```

2. **分析当前状态并给出建议**：
   ```
   我看了一下 lorebook，目前有这些设定：
   - [总结世界观要点]
   - [总结力量体系]
   - [总结地理/势力等]
   
   基于这个世界观，薇洛丝的转生旅行故事可以有几个方向：
   
   **关于薇洛丝的设定：**
   1. 她转生前是什么身份？转生后保留了什么记忆或能力？
   2. 她在这个世界的初始身份是什么？（平民/贵族/特殊种族）
   3. 她旅行的目的是什么？（探索世界/寻找回家方法/完成某个使命）
   
   **关于故事结构：**
   1. 开局是转生那一刻，还是已经适应了一段时间？
   2. 旅行路线是随机探索，还是有明确目标？
   3. 故事节奏偏向轻松日常，还是有主线冲突？
   
   我们可以先从这些基础设定开始，你有什么想法吗？或者你想让我先帮你整理一个角色卡？
   ```

3. **等待用户进一步明确**

**关键点**：
- ❌ 不会立即：创建完整剧情大纲、写入 Plot System、初始化 World Engine、开始写正文
- ✅ 会做：确认理解、读取 lorebook、提出 2-4 个关键问题、用自然对话等待用户明确

---

## 场景 1：初始化 World Engine

### 用户输入
> "建立 World Engine"

### Leader 行为

1. **确认并说明接下来要做什么**：
   ```
   好的，我来帮你建立世界引擎。我需要确认几个基础信息：
   
   1. **时间格式**：你的世界用什么纪年？
      - 我看了 lorebook，[如果有就提取，例如："里面提到了'星辉历'"]
      - 如果没有明确的，我可以帮你用一个简单的奇幻历法
   
   2. **故事"现在"是什么时间？**
      - 薇洛丝转生到这个世界时，是哪一年？
   
   3. **初始角色**：除了薇洛丝，开局还有哪些重要角色需要追踪状态？
      - 暂时只录入开局出场的就好，后续随时可以加。
   ```

2. **用户回答**（假设）：
   > "用星辉历吧，薇洛丝转生在星辉历 312 年。开局就她一个人。"

3. **Leader 执行初始化**（内部工具调用）：
   ```typescript
   // 1. 查看 schema
   get_world_schema({ projectPath: "workspace/xxx" })
   
   // 2. 编辑 calendar.ts
   write("world-engine/calendar.ts", `
   export default {
     type: "simple",
     eraAfter: "星辉历",
     baseUnit: "second",
     units: [
       { name: "minute", parent: "second", ratio: 60 },
       { name: "hour", parent: "minute", ratio: 60 },
       { name: "day", parent: "hour", ratio: 24 },
       { name: "month", parent: "day", ratio: 30 },
       { name: "year", parent: "month", ratio: 12 }
     ],
     format: "{eraName}{year}年 {month}月{day}日 {hour:02}:{minute:02}:{second:02}"
   };
   `)
   
   // 3. 创建 world subject（纪元锚点）
   create_world_subject({
     projectPath: "workspace/xxx",
     id: "world",
     type: "world",
     name: "世界",
     time: "星辉历1年 1月1日 00:00:00"
   })
   
   // 4. 创建主角
   create_world_subject({
     projectPath: "workspace/xxx",
     id: "weiluosi",
     type: "character",
     name: "薇洛丝",
     time: "星辉历312年 1月1日 00:00:00"
   })
   
   // 5. 写入转生事件
   write_world_slice({
     projectPath: "workspace/xxx",
     time: "星辉历312年 1月1日 00:00:00",
     title: "薇洛丝转生",
     kind: "backstory",
     mutations: [
       { subjectId: "weiluosi", attr: "location", op: "set", value: "[初始地点待定]" },
       { subjectId: "weiluosi", attr: "status", op: "set", value: "刚转生，对世界一无所知" },
       { subjectId: "weiluosi", attr: "events", op: "listAppend", value: "星辉历312年：转生到异世界。" }
     ]
   })
   ```

4. **Leader 回复用户**：
   ```
   世界引擎已经建好了。我记录了以下信息：
   
   **时间线**：星辉历，故事从 312 年开始
   **已登记角色**：
   - 薇洛丝：刚转生，状态待完善
   
   **当前世界状态**：
   - 时间：星辉历 312 年
   - 薇洛丝所在位置：[待定]
   - 薇洛丝状态：刚转生，对世界一无所知
   
   有几个可以继续完善的点：
   1. 薇洛丝转生后醒来的具体地点是哪里？
   2. 她转生前保留了什么记忆或能力？
   3. 你想先设计开局情节，还是先补充几个关键地点/NPC？
   
   后续推进剧情时，我会自动更新薇洛丝的状态，你也可以随时问我"薇洛丝现在什么状态"。
   ```

---

## 场景 2：先设计人物，再推进剧情

### 用户输入
> "开始设计两个人物：主角薇洛丝和配角莉雅"

### Leader 行为

1. **确认理解并制定计划**：
   ```
   好的，我们来设计薇洛丝和莉雅的人物卡。
   
   薇洛丝已经在世界引擎里注册了，我会补充她的详细设定。
   莉雅是新角色，我需要创建她的记录。
   
   在设计前，我想确认几个信息：
   
   **关于薇洛丝**：
   1. 她转生前是什么身份？保留了什么记忆？
   2. 转生后的初始能力？（等级、技能、特殊天赋）
   3. 外貌特征？
   4. 性格特点？
   
   **关于莉雅**：
   1. 她是什么身份？（同伴/向导/神秘人物）
   2. 她和薇洛丝在什么时候、什么地点相遇？
   3. 她的初始状态？（等级、位置、处境）
   4. 她的性格和动机？
   
   你可以先告诉我大致方向，我们边聊边完善。
   ```

2. **用户回答**（假设）：
   > "薇洛丝转生前是普通社畜，保留了全部记忆，转生后就是普通人类，等级1。外貌是银发紫瞳。性格谨慎但好奇心强。
   > 
   > 莉雅是被封印的古代魔女，被水晶封印在遗迹深处。银色长发，红瞳。性格冷淡但内心温柔。"

3. **Leader 执行设计**（工具调用）：
   ```typescript
   // 1. 补充薇洛丝 lorebook
   write("lorebook/character/protagonist/weiluosi.md", `...`)
   
   // 2. 创建莉雅 lorebook
   bash("workspace node new lorebook/character/liya --type character --title 莉雅")
   write("lorebook/character/liya/index.md", `...`)
   
   // 3. 创建莉雅 subject
   create_world_subject({
     id: "liya",
     type: "character",
     name: "莉雅",
     time: "星辉历100年 1月1日 00:00:00"
   })
   
   // 4. 写入莉雅被封印事件
   write_world_slice({
     time: "星辉历100年 1月1日 00:00:00",
     title: "莉雅被封印",
     kind: "backstory",
     mutations: [
       { subjectId: "liya", attr: "status", op: "set", value: "被水晶封印" },
       { subjectId: "liya", attr: "location", op: "set", value: "[遗迹位置待定]" }
     ]
   })
   
   // 5. 补充薇洛丝初始属性
   write_world_slice({
     time: "星辉历312年 1月1日 00:00:01",
     title: "薇洛丝初始状态补充",
     kind: "backstory",
     mutations: [
       { subjectId: "weiluosi", attr: "level", op: "set", value: 1 },
       { subjectId: "weiluosi", attr: "hp", op: "set", value: 100 }
     ]
   })
   ```

4. **Leader 回复用户**：
   ```
   两个人物已经设计好了。
   
   **薇洛丝**（主角）
   - 转生前社畜，保留全部记忆
   - 等级 1，银发紫瞳
   - 性格：谨慎但好奇心强
   
   **莉雅**（配角）
   - 古代魔女，被封印 200 多年
   - 银色长发，红瞳
   - 性格：冷淡但内心温柔
   
   我在世界引擎中记录了：
   - 星辉历 100 年：莉雅被封印（她的"过去"）
   - 星辉历 312 年：薇洛丝转生（"现在"）
   
   待定细节：
   1. 薇洛丝转生后醒来的具体地点？
   2. 莉雅被封印的具体位置（哪个遗迹）？
   3. 莉雅被封印的原因？
   ```

---

## 场景 3：先给剧情，边推进边补充

### 用户输入
> "风信之月，薇洛丝转生到了一个无名祭坛，随后莫名其妙感受到危机（邪教徒），开始逃亡。逃亡的过程中进入了遗迹深处，见到被水晶封印的女孩莉雅……"

### Leader 行为

1. **理解剧情并提取关键信息**：
   ```
   好的，这是一段完整的开局剧情。让我先理清时间线和关键事件：
   
   **时间**：星辉历 312 年 风信之月（第 1 个月）
   
   **关键事件**：
   1. 薇洛丝转生到无名祭坛
   2. 遭遇危机（邪教徒），开始逃亡
   3. 逃入遗迹深处
   4. 发现被封印的莉雅
   
   **新出现的元素**：
   - 地点：无名祭坛
   - 地点：某个遗迹
   - NPC势力：邪教徒
   
   确认几个细节：
   1. 这段剧情大约发生在风信之月的第几天？
   2. 无名祭坛的具体位置？（地区/国家）
   3. 遗迹有名字吗？
   4. 邪教徒的规模？（巡逻小队 or 大型组织）
   ```

2. **用户回答**：
   > "第 5 天吧。祭坛在荒野，遗迹叫'星陨遗迹'。邪教徒是小型巡逻队，3-5人。"

3. **Leader 执行记录**（遵循"最少支持当前叙事"原则）：
   ```typescript
   // 1. 创建地点
   create_world_subject({ id: "altar-nameless", type: "location", name: "无名祭坛" })
   create_world_subject({ id: "ruins-meteor", type: "location", name: "星陨遗迹" })
   
   // 2. 创建邪教徒小队（单一 subject 代表整体）
   create_world_subject({ 
     id: "cultist-patrol-01", 
     name: "邪教徒巡逻队",
     time: "星辉历312年 风信之月 3日"
   })
   
   // 切片 1：邪教徒起因
   write_world_slice({
     time: "星辉历312年 风信之月 3日",
     title: "邪教徒巡逻队接受任务",
     mutations: [
       { subjectId: "cultist-patrol-01", attr: "status", op: "set", 
         value: "接到探索星陨遗迹的任务" },
       { subjectId: "cultist-patrol-01", attr: "members", op: "set", 
         value: "3-5人小队" }
     ]
   })
   
   // 切片 2：邪教徒到达
   write_world_slice({
     time: "星辉历312年 风信之月 5日",
     title: "邪教徒巡逻队到达遗迹",
     mutations: [
       { subjectId: "cultist-patrol-01", attr: "location", op: "set", 
         value: "subject://ruins-meteor" }
     ]
   })
   
   // 3. 薇洛丝转生到祭坛
   write_world_slice({
     time: "星辉历312年 风信之月 5日 00:00:00",
     title: "薇洛丝转生到无名祭坛",
     mutations: [
       { subjectId: "weiluosi", attr: "location", op: "set", value: "subject://altar-nameless" }
     ]
   })
   
   // 4. 遭遇邪教徒，开始逃亡
   write_world_slice({
     time: "星辉历312年 风信之月 5日 06:00:00",
     title: "遭遇邪教徒，开始逃亡",
     mutations: [
       { subjectId: "weiluosi", attr: "status", op: "set", value: "逃亡中" },
       { subjectId: "weiluosi", attr: "hp", op: "add", value: -20 },
       { subjectId: "weiluosi", attr: "mind", op: "set", value: "恐惧、慌乱" }
     ]
   })
   
   // 5. 逃入遗迹
   write_world_slice({
     time: "星辉历312年 风信之月 5日 08:00:00",
     title: "逃入星陨遗迹",
     mutations: [
       { subjectId: "weiluosi", attr: "location", op: "set", value: "subject://ruins-meteor" },
       { subjectId: "weiluosi", attr: "status", op: "set", value: "暂时安全" }
     ]
   })
   
   // 6. 发现莉雅
   write_world_slice({
     time: "星辉历312年 风信之月 5日 10:00:00",
     title: "发现被封印的莉雅",
     mutations: [
       { subjectId: "weiluosi", attr: "mind", op: "set", value: "震惊、好奇" },
       { subjectId: "liya", attr: "location", op: "set", value: "subject://ruins-meteor" },
       { subjectId: "world", attr: "events", op: "listAppend", 
         value: "星辉历312年 风信之月5日：薇洛丝发现被封印的莉雅。" }
     ]
   })
   ```

4. **Leader 回复用户**：
   ```
   好的，这段剧情已经录入世界引擎了。
   
   **时间线记录**：
   - 风信之月 5 日 00:00 - 薇洛丝转生到无名祭坛
   - 风信之月 5 日 06:00 - 遭遇邪教徒，开始逃亡（HP -20）
   - 风信之月 5 日 08:00 - 逃入星陨遗迹
   - 风信之月 5 日 10:00 - 发现被封印的莉雅
   
   **当前世界状态**（风信之月 5 日 10:00）：
   - 薇洛丝：位于星陨遗迹，HP 80/100，心理"震惊、好奇"
   - 莉雅：仍被封印在星陨遗迹
   
   **新增地点**：
   - 无名祭坛（荒野，薇洛丝转生地）
   - 星陨遗迹（莉雅封印地）
   
   **新增势力**：
   - 邪教徒巡逻队（3-5人，正在探索遗迹）
   
   接下来的剧情方向：
   1. 薇洛丝尝试解开莉雅的封印？
   2. 邪教徒追入遗迹？
   3. 探索遗迹，寻找出路？
   ```

---

## 场景 4：后续补充设定（溯源）

### 子场景 4.1：补充角色能力

**剧情**：薇洛丝和莉雅遇到大石头，需要莉雅使用魔法。

**用户输入**：
> "莉雅虽然失忆了，但还是会很多魔法，她用岩石魔法移开了石头。"

**Leader 行为**：
```
好的，莉雅使用了岩石魔法。我需要补充一下她的背景设定。

[调用工具，向后插入切片]

我在莉雅的历史中补充了：
- 星辉历 60-90 年：莉雅跟随导师学习魔法，掌握了包括岩石操控在内的多种元素魔法

这样在当前时间点（312年），她虽然失忆，但本能地记得如何使用魔法。

[继续记录当前事件]
- 风信之月 5 日 11:00：莉雅使用岩石魔法移开障碍
```

### 子场景 4.2：补充角色知识

**剧情**：邪教徒队长认出莉雅的项链。

**用户输入**：
> "邪教徒队长看到莉雅脖子上的项链，脸色大变，说'这是古代魔女的标志！'"

**Leader 行为**：
```
好的，队长认出了项链。我需要补充几个背景：

[调用工具]
1. 为项链创建 subject（如果它重要的话）
2. 补充莉雅拥有项链的历史（星辉历 50 年，导师赠予）
3. 补充队长了解这个项链的背景（星辉历 310 年，在教会典籍中见过记载）

这样队长的反应就有了合理的背景支撑。

[继续记录当前事件]
- 风信之月 5 日 12:00：邪教徒队长认出古代魔女项链
```

---

## 两种模式对比

| 模式 | 场景 2：先设计人物 | 场景 3：先给剧情 |
|------|------------------|----------------|
| **用户输入** | 结构化设计要求 | 自然叙述剧情 |
| **Leader 行为** | 引导设计 → 确认细节 → 写入 WE | 提取信息 → 补充细节 → 写入 WE |
| **World Engine** | 补充角色历史背景 | 记录剧情时间线事件 |
| **Lorebook** | 创建人物卡 | 创建地点卡 + 补充经历 |
| **优势** | 设定完整，细节明确 | 快速推进，自然流畅 |
| **适用** | 开局前准备 | 剧情推进中 |

---

## 关键设计原则总结

### 1. 技术细节透明
- 用户只需要讲故事
- 不需要理解 slice/mutation/schema/op 等概念
- Leader 自动映射到 World Engine 技术结构

### 2. 双向支持
- 支持"先设计再推进"（结构化）
- 支持"边推进边补充"（自然叙述）
- 两种模式可以混合使用

### 3. 信息提取能力
- Leader 能从自然叙述中提取：时间、地点、事件、状态变化
- 主动补齐缺失的关键信息

### 4. 最少支持当前叙事
- 群体角色用单一 subject，需要时再拆分
- 每个 subject 通常 1-2 条切片（起因 + 状态）
- 按需补充背景，不预先填满所有细节
- 临时角色不创建 subject，只在事件中提及

### 5. 溯源能力
- 需要补充能力/知识时，向后插入切片
- 支持精确时间和模糊时间段
- 保持溯源的合理性和简洁性

---

## 相关文档

- [recording-principles.md](recording-principles.md)：World Engine 记录原则详解
- [world-engine-initialization-requirements.md](world-engine-initialization-requirements.md)：初始化需求
- [phase-0-research-summary.md](phase-0-research-summary.md)：调研总结
