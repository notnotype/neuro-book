# 阶段四：World Engine 初始化

> **API 速览**：World Engine = Zod schema + 单一 `execute_world` 工具。详细契约见 `reference/world-engine/api-migration-zod.md`。
> - Schema: `world-engine/schema/index.ts`（TypeScript + Zod，不再用 `schema.yaml`）
> - 工具: `execute_world`（CodeAct；leader / world.engine 为 readwrite，writer 为 readonly）
> - API: `world.time.*` / `world.subject.*` / `world.search.*` / `world.slice.*`
> - Subject 创建：首次 `world.slice.write` 在 patch 上声明 `type` 即自动注册，无需单独 create 步骤

引导 leader 帮用户把 World Engine 从零搭起来：确认时间格式、设计主体模式、建立纪元锚点和初始角色、写入开局状态，最后教会用户怎么用。World Engine 是写作模式下**动态世界状态 + 时间线的唯一真相源**，原理与契约见 `reference/world-engine/`（README、workflow、calendar-system、schema-system、subject-lifecycle）。本文只讲操作步骤和引导话术，不重复解释原理；遇到概念问题回去读 reference。

技术细节对用户透明是硬原则：用户只讲故事、设计角色、确认几个基础信息，永远不需要理解 slice / patch / schema / instant / op。leader 在和用户交流时用人话，在调用工具时才用技术概念。

## 使用时机与前置

**该初始化的时机**：项目有明确时间线，且有需要随剧情追踪状态的角色。这通常出现在用户从灵感探索转向"我要正经写这个故事"的时刻，或用户明确要求建立 World Engine。

**不该初始化的时机**：纯灵感探索阶段。用户还在反复推翻设定、连主角身份都没定时，初始化只会制造需要反复推翻的结构化数据。这种情况先回 `novel-idea-exploration` 或阶段一。

**前置**：项目已有基本定位（题材、主角、大致走向），最好已经走过阶段二建好 lorebook 骨架——leader 设计 schema 时要读 lorebook 的力量体系、货币、等级等设定，lorebook 越完整 schema 越贴合作品。

## 边界

- 本阶段使用 World Engine 当前协议：单一 `execute_world` 工具 + 分组 `world.*` API 维护世界状态，**不引导用户用 plot / simulator / director / emulation 来追踪世界状态**——在写作模式里这些当做不存在。
- 静态设定（人物底设、世界规则、地理）属于 lorebook，不进 World Engine。会随剧情时间演变的状态（位置、HP、心理、当前关系、谁知道了什么）才进 World Engine。判断归属见 `reference/world-engine/workflow.md` 第 2 节。
- 时间对外一律用项目日历字符串（如「公元2020年4月12日 18:00」），禁止 raw instant。默认模板使用公历，格式到分钟、不带秒。

## 工作方式

用 task_create 建立 checklist，用 task_set_status 一步步推进，不要一次做完再汇报。每完成一步，向用户用人话报告结论。

建议 task checklist：

1. 读取 lorebook（力量体系、货币、势力、主角设定）和项目定位。
2. 确认时间格式（calendar），写入 `world-engine/calendar.ts`。
3. 设计或调整 subject schema，写入 `world-engine/schema/index.ts`（Zod 格式）。
4. 创建 world subject（纪元锚点）和初始角色。
5. 写入开局状态。
6. 教会用户后续怎么用，汇报当前世界状态摘要。

## 第一步：确认时间格式（calendar）

World Engine 靠时间排序和截断算状态，所以先和用户定下这个世界用什么纪年。用人话给用户几个选项，让他选或描述自己想要的：

> 我们先定一下这个世界的时间怎么计。给你几个方向：
>
> 1. **现代公历**：真实公历闰年（2月平年28天、闰年29天），适合现实/都市/近未来题材。
> 2. **奇幻简单历法**：自定义纪元名和单位，比如一天36小时、一年4个月，每月固定90天，适合架空世界。
> 3. **完全自定义**：如果你有特殊规则（比如农历闰月），可以写自定义函数。
>
> 你想要哪种，或者你心里已经有一套历法了？

确认时要点清两件容易混的事：

- **纪元锚点（零点 / 公元日）** 是这个世界开始计时的原点，类比公元元年。
- **故事"现在"的时间点** 是叙事真正展开的时刻。两者通常不同——故事可以从「公元2020年4月12日 18:00」开始，而纪元零点是「公元1年1月1日 00:00」。

问清楚："你这个故事开篇大概是纪元多少年？主角登场那一刻，你想标成几年几月几日？"

**Calendar 系统能力**：

- **Simple Calendar（通用单位链）**：用户定义单位层级（秒→分→时→日→月→年），每个单位固定换算比例（ratio），支持月份名（cycleNames）和星期（week token）。适合固定月数、固定天数的奇幻历法。
- **Gregorian Calendar（预置公历）**：内置闰年规则（4/100/400）、大小月（1/3/5/7/8/10/12月31天，4/6/9/11月30天，2月平年28/闰年29）。适合现代背景。
- **Custom Calendar（用户手写函数）**：用户直接写 format(instant) / parse(input) 函数。适合复杂历法（如农历闰月）。

**落地动作**：根据用户选择，创建 `world-engine/calendar.ts`。

**calendar.ts 示例**：

Gregorian Calendar（真实公历，默认推荐）：
```typescript
export default {
  type: 'gregorian',
  eraBefore: '公元前',
  eraAfter: '公元',
  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'
};
```

Simple Calendar（奇幻固定历法，一年4个月、每月90天）：
```typescript
export default {
  type: 'simple',
  eraBefore: '旧纪元',
  eraAfter: '新纪元',
  baseUnit: 'second',
  units: [
    { name: 'minute', parent: 'second', ratio: 60 },
    { name: 'hour', parent: 'minute', ratio: 60 },
    { name: 'day', parent: 'hour', ratio: 24 },
    { name: 'month', parent: 'day', ratio: 90 },
    { name: 'year', parent: 'month', ratio: 4 }
  ],
  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}'
};
```

向用户确认时用人话："好，这个世界用公历记录时间，格式到分钟，例如公元2020年4月12日 18:00。时间格式定好了。"

详见 `reference/world-engine/calendar-system.md` 和 `reference/world-engine/examples/calendar-*.ts`。

## 第二步：设计或调整 subject schema

schema 是这个世界的"主体模式"——告诉引擎每一类对象（角色、地点、物品、势力）有哪些属性、每个属性怎么随时间叠加。项目模板已经预置了一组 schema（`character` / `location` / `item` / `faction` / `world`），多数项目在它基础上微调即可，不用从零写。

先读 `world-engine/schema/index.ts` 看预设，再问用户要不要介绍 / 调整：

> 初始化世界引擎还需要设计"主体"（subject），也就是这个世界里要追踪状态的对象，比如角色有血量、位置、心境这些会变的属性。项目模板已经有一组预设好的主体模式（角色、地点、物品、势力），需要我先给你介绍一下吗？你也可以在这个基础上加减属性。

**关键动作：把 lorebook 的设定映射进 character schema**。leader 要读 lorebook 的力量体系、货币、等级、状态规则，给 `character` 增删对应属性。例如：

- 修仙世界有修为境界 → 给 character 加 `realm`（scalar enum，取值如练气/筑基/金丹）。
- 魔法世界有魔力值 → 加 `mana`（scalar int）。
- 有货币体系 → 给 character 或 faction 加 `gold`（scalar int）。
- 有技能 / 功法成长 → 加 `skills`（list，只增的有序流）。

引导话术：

> 我看了你的设定，这个世界有"修为境界"和"灵石"两套体系。我建议给角色加两个会变化的属性：修为境界和灵石数量，这样后面剧情里角色突破、花钱都能自动记进时间线。可以吗？

属性怎么用 Zod 写、怎么用 `Ref("type")` 标引用、default 怎么定，见 `reference/world-engine/schema-system.md` 与 `reference/world-engine/api-migration-zod.md`。两条最常用的判断：

- 会反复加减的数值（血量、灵石）用 `z.number()`，剧情里用 `increment` op 记增减最稳健。
- 只增的经历流（events、学会的功法）用 `z.array()`；可增删且不重复的集合（背包、弟子名册）用 `z.array(...).unique()`，写入用 `append` op（unique 数组自动去重）。

schema 是宽松约束：patch 打在没声明的属性上也允许（按 scalar 处理），所以不用一开始就把属性列全，后面随剧情按需加。

**落地动作**：写入或调整 `world-engine/schema/index.ts`（Zod 格式），schema 写错会在加载期报错（比如 ref 指向不存在的 type、default 类型不符）。

## 第三步：写入纪元锚点和初始角色

schema 定好后，通过 `execute_world` 里的 `world.slice.write` 写入第一批 subject。**首次写入某个 subject 时会自动创建**，不需要单独注册步骤。

**先写入 world subject 作为纪元锚点**。world 这个主体的起始时间就锚定这个世界从哪一刻开始计时，也用来承载世界级大事件：

```javascript
const time = world.time.parse("公元1年1月1日 00:00"); // 纪元零点，锚定起点
await world.slice.write({
    time,
    title: "世界起源",
    patches: [
        // 首写该 subject：在 patch 上声明 type（必填）+ name（可选，表级显示名），工具会自动注册并应用 schema 默认值
        { subjectId: "world", type: "world", name: "故事世界", path: "/name", op: "replace", value: "故事世界" },
    ],
})
```

**再写入开局要追踪的角色**。同样在首写的 patch 上声明 `type`：

```javascript
const time = world.time.parse("公元2020年4月12日 18:00");
await world.slice.write({
    time,
    title: "薇洛丝登场",
    patches: [
        { subjectId: "weiluosi", type: "character", name: "薇洛丝", path: "/name", op: "replace", value: "薇洛丝" },
        // schema 有 default 时会自动应用（如 hp=100），无需手写
    ],
})
```

关键契约：

- **id 全局唯一、不能为空白**。用稳定、好记的英文 id。
- **type 必须是 schema 已声明的类型**，拼错会被拒绝。
- **首次写入必须在该 subject 的某条 patch 上声明 type**（如 `{ subjectId: "weiluosi", type: "character", ... }`）；subject 已存在后再写时 type/name 会被忽略，可省略。
- **schema 给该 type 声明了非空 default 时**，首次写入会自动应用初值（如 hp=100、level=1）。
- 遵循最少支持当前叙事：群体角色（"邪教徒巡逻队"）先用单一 subject 表示整体，需要时再拆重要个体；临时龙套不建 subject，只在主角切面的事件文本里提及。

向用户报告时用人话："我把主角薇洛丝和这个世界本身登记进去了，时间用公历记录，薇洛丝从公元2020年4月12日 18:00 登场。"

## 第四步：写入开局状态

继续用 `execute_world` 里的 `world.slice.write` 把开局那一刻的状态记进时间线：主角转生到哪、初始位置、初始状态、和谁的关系。一个 slice = 一个时间点 + 一组变更，同一时刻发生的事都放进同一个 slice。

```javascript
const time = world.time.parse("公元2020年4月12日 18:05");
await world.slice.write({
    time,
    title: "薇洛丝转生到无名祭坛",
    patches: [
        { subjectId: "weiluosi", path: "/location", op: "replace", value: "subject://altar-01" },
        { subjectId: "weiluosi", path: "/mind",     op: "replace", value: "意识刚清醒，对身世一无所知" },
        { subjectId: "weiluosi", path: "/events",   op: "append",  value: {text: "在无名祭坛睁开眼，发现自己换了身体"} },
    ],
})
```

要点：

- **同一 instant 只能有一个 slice**。如果这个时间点已经有切面，`world.slice.write` 会冲突报错；先用 `world.slice.list({withPatches:true})` 或 `world.slice.get(sliceId)` 找到已有切面，再用 `world.slice.editPatches` 补 patch；不要为了同一事件改用相邻时间制造重复记录。
- **遵循最少支持当前叙事**：每个 subject 通常 1-2 条切面（起因 + 当前状态）就够，不预先填满；背景按需向更早时间溯源（补一段过去就是往更早时间插一条切面）。原则见 `reference/world-engine/recording-principles.md`。
- 写入返回的 issues 要看：`severity: "error"` 必须修；`severity: "advisory"` 确认语义即可。向用户解释时使用返回的 `title`、`message`、`explanation`，不要把 code 直接抛给用户。

## 第五步：教会用户使用

初始化完，告诉用户后面怎么用自然语言驱动世界引擎，强调他不需要懂任何技术结构：

> 世界引擎建好了。从现在起你可以这样用：
>
> - 想知道某个角色现在什么状态，直接问我"薇洛丝现在怎么样"，我帮你查出来。
> - 讲一段剧情给我（"薇洛丝逃进遗迹，遇到被封印的莉雅"），我帮你记进时间线，角色的位置、状态都会自动更新。
> - 想补一段过去（"其实莉雅三百年前就学会了岩石魔法"），告诉我大概什么时候，我帮你插到那个时间点。
> - 倒叙、回忆也行，问我"两百年前这里是什么样"，我能算出那个时刻的世界。
>
> 你只管讲故事，时间、状态这些我在背后帮你记。

## 续写场景：只做结尾切片，不回溯全书

用户已有已写正文（自己写的或经 `novel-import-book` 导入的）要续写时，World Engine 初始化**不按新开流程从纪元锚点重建全书时间线**，只把「故事现在」的状态立起来：

1. **读最后 3-5 章正文 + 摘要**（摘要从章节 frontmatter 读，`workspace node parse --json manuscript` 一条命令批量拿到）。
2. **提取当前状态**：当前时间点（最后一章的事件时间，从正文的时间线索推断）、各关键人物此刻的位置/伤势/持有物/心理、当前势力格局、未了事件（正要进行的行动、悬而未决的冲突）。
3. **按本阶段标准流程写初始切片**：calendar 从正文时间线索定（推断不出时问用户）；schema 沿用预设 + 按 lorebook 微调；world subject 锚点时间用「故事现在」而不是纪元零点；关键人物和当前状态写进第一批 slice。
4. **明确告诉用户哪些状态是推断的**（标注为待确认），让他扫一眼确认或纠正；推断只基于最后几章，不回溯全书——历史状态不需要进 World Engine，动态状态有真相源即可。

其余步骤（教会用户使用、完成标准）与主流程一致。续写不需要把全书几百章都倒着记进时间线，那既浪费又容易错。

## 完成标准

- `world-engine/calendar.ts` 就位，时间格式和纪元锚点已和用户确认。
- `world-engine/schema/index.ts` 就位（Zod 格式），已结合 lorebook 调整过 character 等属性。
- world subject（纪元锚点）和开局要追踪的角色已通过首次 `world.slice.write` 创建。
- 开局状态已写入时间线，写入返回的 E issues 已清掉。
- 用户知道后续怎么用自然语言查询状态、记录剧情、补过去——不需要懂 slice / schema / instant。

## 后续衔接

- 世界观还需要补设定（势力、地点、规则、力量体系细节）→ 回阶段二。
- 要正经设计开局与推进剧情 → 进入 `novel-writing`，首轮走开局模式。
