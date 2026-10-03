# World Engine 记录原则：最少支持当前叙事

本文讲清"在 World Engine 里记录什么、记录到什么粒度"的核心心法——**最少支持当前叙事原则**。读者是需要把剧情映射成切片（slice）的 Agent，主要是 leader。本文只教原理与判断依据，不教"第一步做什么"的操作流程。

> World Engine 用事件溯源（event sourcing）表达世界演化：任意时刻的世界状态 = 该时刻前所有切片按时间排序后 reduce（按序叠加）得来。一个切片是世界在某个时间点发生的一组 patch；一个 subject（主体）是被记录状态的对象，例如一个角色、一件物品、一个阵营。记录的本质就是"决定哪些 subject、在哪些时刻、发生了哪些变更"。

## 1. 核心原则

**在 World Engine 中试图记录所有事件既不可能也不必要。记录的内容应该是"支持当前叙事所必需的最少信息"，而不是穷举所有细节。**

这条原则是 leader 熟练使用 World Engine 的关键。世界引擎不是世界的完整模拟器，它是叙事的状态支撑：只有当某个事实"会被后续剧情读取、引用或依赖"时，它才值得进入切片。判断标准始终是"当前叙事是否需要它"，而不是"它在世界里是否真实发生过"。

记录什么：

- 主要角色的关键状态变化（位置、处境、关键物品、关键认知）。
- 重要地点、物品、阵营在叙事中第一次变得重要时的身份与状态。
- 支持当前叙事所必需的背景与来历。

不记录什么：

- 每一个细节行动（出发、路过、休息、继续前进）。
- 临时龙套的完整信息。
- 预先填满的、当前叙事用不到的所有可能背景。

## 2. 群体角色处理

一组功能相同、当前无需区分的角色（例如一支 3-5 人的邪教徒巡逻队），**先用单一 subject 表示整体**，不要为每个成员各建一个 subject。

错误做法是按人头建 subject：

```typescript
// 错误：为每个邪教徒创建独立 subject，制造大量无叙事意义的主体
await world.slice.write({ 
    patches: [
        { subjectId: "cultist-1", path: "/name", op: "replace", value: "邪教徒A" },
        { subjectId: "cultist-2", path: "/name", op: "replace", value: "邪教徒B" },
        { subjectId: "cultist-3", path: "/name", op: "replace", value: "邪教徒C" },
    ]
})
```

正确做法是用一个 subject 代表整支队伍，把"人数""领队"等当成它的属性：

```typescript
// 正确：首次写入时自动创建 subject
await world.slice.write({
    time: world.time.parse("公元2020年4月10日 09:00"),
    title: "邪教徒巡逻队部署",
    patches: [
        { subjectId: "cultist-patrol-01", type: "character", name: "邪教徒巡逻队", path: "/name", op: "replace", value: "邪教徒巡逻队" },
        { subjectId: "cultist-patrol-01", path: "/members", op: "replace", value: 5 },
    ]
})
```

**精细化原则**：只有当某个个体"对叙事变得重要"时——例如队长开始与主角直接互动、产生独立动机——才把它从群体中拆分成独立 subject，其余成员仍由群体 subject 承载。

```typescript
// 队长成为重要角色时再拆分；首次写入自动创建 subject
await world.slice.write({
    time: world.time.parse("公元2020年4月12日 12:00"),
    title: "邪教徒队长与主角对峙",
    patches: [
        { subjectId: "cultist-captain", type: "character", name: "邪教徒队长", path: "/name", op: "replace", value: "邪教徒队长" },
        { subjectId: "cultist-captain", path: "/status", op: "replace", value: "与薇洛丝对峙" },
        // 群体 subject 仍承载其余成员
        { subjectId: "cultist-patrol-01", path: "/status", op: "replace", value: "队长与目标对峙，其余成员警戒" }
    ]
})
```

拆分是单向的渐进动作：群体在前，重要个体在需要时析出。不要预判"将来可能重要"就提前拆分。

## 3. 切片数量控制

**每个 subject 通常只需要 1-2 条切片来建立"起因 + 当前状态"**，不要记录它的每一个细节行动。

以邪教徒巡逻队为例，两条切片足够：

- **切片 1（起因）**：他们为什么存在？接了什么任务？由谁派遣？
- **切片 2（当前状态）**：他们现在在哪、正在做什么？

```typescript
// 切片 1：起因
await world.slice.write({
    time: world.time.parse("公元2020年4月11日 09:00"),
    title: "邪教徒巡逻队接受任务",
    patches: [
        { subjectId: "cultist-patrol-01", type: "character", name: "邪教徒巡逻队", path: "/status", op: "replace", value: "接到探索星陨遗迹的任务" },
        { subjectId: "cultist-patrol-01", path: "/members", op: "replace", value: "3-5人" }
    ]
})

// 切片 2：当前状态
await world.slice.write({
    time: world.time.parse("公元2020年4月12日 10:00"),
    title: "邪教徒巡逻队到达遗迹",
    patches: [
        { subjectId: "cultist-patrol-01", path: "/location", op: "replace", value: "subject://ruins-meteor" }
    ]
})
```

不要把中间过程逐条记成切片（"出发""路过A地""休息""继续前进""到达遗迹"）。这些过程动作不会被后续剧情单独读取，只会让 timeline 膨胀、reduce 噪声变大。只记录**关键转折**：状态从一个有叙事意义的形态变成另一个。

## 4. 按需补充设定（溯源）

剧情推进时常常需要角色展现一项之前未交代的能力、知识或关系。正确的处理不是在当前时刻凭空 replace 一个属性，而是**向时间线更早处插入一条切片，把这项设定溯源到它合理的来历**。

补过去与写当前是**同一个工具**：`world.slice.write` 传一个比当前最新切片更早的 `time`，timeline 会自动按时间归位。这正是 `increment` 之类相对 op 在架构上稳定的原因——往过去插一条变更，后续相对增量不受影响，reduce 自动得到正确结果。

> 前提：下列示例假定项目 schema 已把 `skills`、`knowledge` 声明为 `list`；默认模板的 `events` 是 `EmbeddingText[]`，所以写入 `/events` 时 value 使用 `{text: "..."}`。注意：schema 未声明的属性默认按 scalar 处理；要对数组使用 `append`，先确认该属性在 schema 里声明了对应 kind（见 [schema-system.md](schema-system.md)）。

### 示例 1：莉雅失忆但会魔法

剧情上莉雅当前需要施展岩石魔法，但此前从未交代她会魔法。向她学会该魔法的年代插入一条 backstory 切片溯源：

```typescript
// 在过去插入一条切片，说明莉雅何时、如何学会这个魔法
await world.slice.write({
    time: world.time.parse("公元2010年3月15日 00:00"),
    title: "莉雅学会岩石魔法",
    kind: "backstory",
    patches: [
        { subjectId: "liya", type: "character", name: "莉雅", path: "/skills", op: "append", value: "岩石操控魔法", summary: "学会岩石魔法" },
        { subjectId: "liya", path: "/events", op: "append", value: {text: "公元2010年：在导师指导下学会岩石操控魔法。"}, summary: "记录修行经历" }
    ]
})
```

### 示例 2：队长认出项链

队长看到莉雅的项链并认出它的来历，需要补充"队长读过相关典籍"这一背景，使他的认知有据可循：

```typescript
// 补充队长了解项链来历的背景
await world.slice.write({
    time: world.time.parse("公元2019年3月1日 00:00"),
    title: "邪教徒队长读过古代魔女典籍",
    kind: "backstory",
    patches: [
        { subjectId: "cultist-captain", type: "character", name: "邪教徒队长", path: "/knowledge", op: "append", value: "认识古代魔女的标志性项链", summary: "补充项链知识" },
        { subjectId: "cultist-captain", path: "/events", op: "append", value: {text: "公元2019年：在教会典籍中见过古代魔女项链的记载。"}, summary: "记录阅读典籍" }
    ]
})
```

**何时补充**：剧情需要角色展现新能力、特殊知识，或某个物品 / 地点 / 关系突然变得重要并需要解释时。

**补充原则**：

- **按需补充**：只在叙事需要时溯源，不预先填满所有背景。
- **向更早插入**：在时间线上更早的时刻写切片，而不是在当前时刻硬塞一个无来历的状态。
- **保持简洁**：1-2 条切片说清关键点即可，不为每个细节补完整历史。

## 5. 模糊时间段处理

World Engine 的时间真相源 instant 是**精确时刻**（公开入参一律用项目日历字符串，如 `公元2020年4月12日 18:00`，工具与 HTTP 层禁止 raw instant 即 `instant:<number>`）。但叙事里常出现"2010-2015 年间学习魔法"这类**时间段**概念，第一版没有时间段类型。

处理方式：**用一个精确 instant 锚定切片落点，用切片的 `title` / `summary` 和 `events` 文本承载时间段语义**。

```typescript
// 用切片起点的精确时间锚定，靠 summary 与 events 文本表达"一段时期"
await world.slice.write({
    time: world.time.parse("公元2010年3月1日 00:00"),
    title: "莉雅的魔法修行时期",
    kind: "backstory",
    summary: "公元2010-2015年间，莉雅跟随导师学习各种魔法",
    patches: [
        { subjectId: "liya", type: "character", name: "莉雅", path: "/skills", op: "replace", value: ["基础元素魔法", "岩石操控", "风系魔法"], summary: "整理修行成果" },
        { subjectId: "liya", path: "/events", op: "append", value: {text: "公元2010-2015年：跟随导师学习魔法，掌握多种元素操控能力。"}, summary: "记录修行时期" }
    ]
})
```

要点：

- `time` 用该时间段的起点或某个代表时刻，让切片在 timeline 上有确定落点。
- 时间段的"跨度"信息写进 `summary` 与 `events` 文本，由人和下游阅读理解，引擎不为它建模。
- 这是第一版用"精确 instant + 文本描述"近似模糊时间的标准手法；不要试图用多条切片去逐年填满一整段时期。

## 6. 临时角色

路人、一次性的小怪、没有后续戏份的角色**不创建 subject**。他们只在与主角相关的切片的 `events` 文本里被提及即可。

```typescript
// 临时 NPC 不建 subject，只在主角切片的 events 文本中记录互动
await world.slice.write({
    time: world.time.parse("公元2020年4月12日 13:00"),
    title: "薇洛丝在集市问路",
    patches: [
        { subjectId: "weiluosi", type: "character", name: "薇洛丝", path: "/events", op: "append", value: {text: "向集市一名卖花老妇打听遗迹方向，得知需绕过北侧断桥。"}, summary: "记录问路经历" }
    ]
})
```

判断标准同核心原则：如果这个角色不会被后续剧情再次读取或引用，他就不值得一个独立 subject。一旦某个原本临时的角色后来变得重要，再按第 2 节的精细化方式为他创建 subject 并溯源即可。

## 7. 记录策略速查表

| 场景 | 处理方式 | 切片数量 |
| --- | --- | --- |
| **群体角色**（邪教徒小队） | 单一 subject 代表整体，按需拆分重要个体 | 1-2 条（起因 + 当前状态） |
| **重要个体**（邪教徒队长） | 变得重要时从群体析出独立 subject | 1-2 条（背景 + 当前状态） |
| **能力 / 知识**（莉雅的魔法） | 向更早处插入切片溯源来源 | 1 条（精确）或 1 条（模糊时间段 + 文本） |
| **物品 / 地点**（项链、遗迹） | 首次重要时创建 subject，按需补历史 | 1-2 条（来历 + 当前） |
| **临时 NPC**（路人、小怪） | 不创建 subject，只在事件文本中提及 | 0 条（写进主角切片的 events） |

## 8. leader 需要的判断能力

把上述原则落地，leader 需要四种判断：

1. **识别重要性**：哪些角色 / 物品 / 地点会被后续叙事读取，需要独立 subject；哪些只需在事件文本中一笔带过。
2. **控制粒度**：群体还是个体、精确时刻还是模糊时间段、关键转折还是细节过程——始终选叙事真正需要的那一档。
3. **按需补充**：识别剧情需要溯源的时机，向更早的时刻插入切片，保持来历合理且简洁。
4. **避免过度**：不记录每个细节行动，不为每个龙套建 subject，不预先填满当前用不到的背景。

## 9. 记录时必须守住的边界

记录决策不能绕过 World Engine 的契约，以下边界始终成立：

- **第一版不接旧 simulation workflow，也不依赖 Plot 系统**。记录世界状态只用 World Engine 工具（`execute_world`），不要为了记录状态去调 plot / simulation 工具。
- **patch 不存旧值，后端不自动改写后续切片**。声明式的 patch 序列是唯一真相源，状态永远由 reduce 得来；补过去时要意识到这一点，必要的下游影响由 issues 提醒。
- **同一 instant 只能有一个切片**。目标时间点已存在切片时，`world.slice.write` 会冲突报错。同一时刻要补内容时先用 `world.slice.list({withPatches:true})` 或 `world.slice.get(sliceId)` 找到切面和 patchId，再用 `world.slice.editPatches()` 精确增删改；只有整条切片作废时才 `world.slice.delete()` 物理删除。
- **issues 分两类，处理方式不同**。E issues 是持久的数据错误，必须修；A issues 是补过去时的一次性提醒，确认本次修改的语义符合预期即可，不落库。完整 code 表和展示规则见 [issues.md](issues.md)。
- **writer 对 World Engine 只读**。writer 拥有 readonly `execute_world` 用于读取世界状态，但不能写入；所有切片记录由 leader 负责。
