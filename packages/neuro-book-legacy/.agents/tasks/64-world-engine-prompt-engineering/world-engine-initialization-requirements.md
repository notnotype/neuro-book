# World Engine 初始化需求与设计

> 创建日期：2026-06-22

> Legacy note：本文是 Task 64 早期初始化需求草案，部分段落仍以 `schema.yaml` 和旧多工具 API 表述。当前实现以 `reference/world-engine/api-migration-zod.md` 与 `novel-workflow-world-engine-init` 为准：schema 真相源是 `world-engine/schema/index.ts`，subject 首次写入由 `write_world_slice` 的 patch `type` 自动创建。

## 背景

World Engine 目前已完成后端实现，但用户初始化流程需要进一步完善。当前 calendar 和 schema 设计需要用户深度参与，但这些流程还没有标准化的引导。

## 核心需求

### 1. Calendar 系统增强

**当前问题**：
- Calendar 已硬切到 `world-engine/calendar.ts`，初始化引导必须让用户选择 simple / gregorian / custom 策略，而不是继续编辑 `calendar.yaml`。
- 用户需要用自然语言理解"只有 4 个月，一个月 90 天"这类非标准历法如何映射到 `simple` 单位链。
- 纪元锚点（公元日）概念不清晰。

**需求**：
1. **自定义月份名称**：
   - 支持"风信之月"、"霜降之月"等自定义月份名
   - 支持自定义月份数量（不限于 12 个月）
   - 支持自定义每月天数

2. **纪元锚点明确化**：
   - 明确"公元日"概念：纪元的起点时间
   - World subject 的 `time` 就是纪元锚点
   - 用户需要理解"故事开始的时间"与"纪元起点"的关系

3. **历法模板**：
   - 提供常见历法模板（现代公历、简单纪年、奇幻历法）
   - 用户可在模板基础上调整

**示例历法**：
```ts
export default {
    type: "simple",
    eraAfter: "星辉历",
    baseUnit: "second",
    units: [
        {name: "minute", parent: "second", ratio: 60},
        {name: "hour", parent: "minute", ratio: 60},
        {name: "day", parent: "hour", ratio: 24},
        {name: "month", parent: "day", ratio: 90},
        {name: "year", parent: "month", ratio: 4},
    ],
    cycleNames: {
        month: ["风信之月", "炎夏之月", "金秋之月", "冰封之月"],
    },
    format: "{eraName}{year}年 {monthName} {day}日",
};

// 纪元锚点：星辉历 1 年 风信之月 1 日
// 由 world subject 的创建时间定义
```

---

### 2. Schema 设计引导流程

**当前问题**：
- schema.yaml 需要用户手动编写或理解复杂的 YAML 结构
- 用户不理解 subject / attr / kind / op 等技术概念
- 缺少"从世界观推导 schema"的引导流程

**需求**：

#### 2.1 提供预设模板

**典型奇幻模板**：
```yaml
character:
  desc: 角色
  attrs:
    level:
      kind: scalar
      type: int
      desc: 等级
    hp:
      kind: scalar
      type: int
      desc: 生命值
    location:
      kind: scalar
      type: ref(location)
      desc: 当前所在地
    status:
      kind: scalar
      type: text
      desc: 当前状态
    events:
      kind: list
      itemType: text
      desc: 经历事件流
    mind:
      kind: scalar
      type: text
      desc: 当前心理状态
    inventory:
      kind: collection
      itemType: ref(item)
      desc: 背包物品

location:
  desc: 地点
  attrs:
    description:
      kind: scalar
      type: text
      desc: 地点描述

item:
  desc: 物品
  attrs:
    description:
      kind: scalar
      type: text
      desc: 物品描述

faction:
  desc: 势力
  attrs:
    treasury:
      kind: scalar
      type: int
      desc: 国库
    capital:
      kind: scalar
      type: ref(location)
      desc: 首都

world:
  desc: 世界本身
  attrs:
    events:
      kind: list
      itemType: text
      desc: 世界大事件
```

#### 2.2 引导对话流程

**Leader 应该这样引导**：

```
【用户要求初始化 World Engine】

Leader: 初始化世界引擎还需要设计**主体（subject）**，这是世界引擎主要关注记录的对象。

常见的主体类型包括：
- 角色（character）
- 地点（location）
- 物品（item）
- 势力/国家（faction）
- 世界本身（world）

项目模板已经有一组预设好的**主体模式（subject schema）**，适用于典型奇幻题材：
- 角色有：等级、生命值、位置、状态、背包、经历
- 地点有：描述
- 物品有：描述
- 势力有：国库、首都
- 世界有：大事件记录

需要我为你介绍一下吗？你可以在此基础上进行调整。

【用户选择"先用模板"】

Leader: 好的，我看了一下你的 lorebook。

[读取 lorebook，分析力量体系]

你的世界观里有[魔力系统/修仙境界/科技等级]，我建议在角色的 schema 里增加这些属性：
- [魔力值/境界/科技等级]
- [对应的追踪属性]

要不要我帮你调整？

【用户确认后】

Leader: 好的，schema 已更新。现在可以开始初始化了。
```

#### 2.3 Schema 调整建议

**从 Lorebook 推导**：
- 读取 `lorebook/rule/power-system/` 等设定
- 分析力量体系、等级系统、货币系统
- 自动建议增加对应的 subject attributes

**示例**：
- Lorebook 提到"修仙境界" → 建议增加 `character.realm: scalar/text`
- Lorebook 提到"魔力值" → 建议增加 `character.mana: scalar/int`
- Lorebook 提到"金币/银币" → 建议增加 `character.gold: scalar/int`

---

## 架构设计：References vs Skills

### References（原理层）

**存放位置**：`reference/world-engine/`

**职责**：教 **How**（概念、原理、契约）

**内容**：
1. **`reference/world-engine/calendar-system.md`**：
   - Calendar 的作用和概念
   - 时间格式定义
   - 纪元锚点（公元日）概念
   - 自定义历法的规则和约束
   - `calendar.ts` 格式规范
   - simple / gregorian / custom 的选择边界

2. **`reference/world-engine/schema-system.md`**：
   - Subject / Attr / Kind / Op 概念
   - schema.yaml 格式规范
   - 各 kind 的语义（scalar / list / collection / object）
   - 各 op 的含义（set / add / unset / listAppend / collectionAdd / collectionRemove）
   - Default 值和初始化

3. **`reference/world-engine/subject-lifecycle.md`**：
   - Subject 的创建流程
   - Init slice 的写入
   - Subject 的状态演化

4. **`reference/world-engine/workflow.md`**：
   - 写作模式下的 World Engine 使用流程
   - 与 Lorebook / Plot / Manuscript 的关系

---

### Skills（操作层）

**存放位置**：`assets/workspace/.nbook/agent/skills/`

**职责**：教 **How to do**（具体操作、引导流程）

**依赖**：References 提供的概念和契约

**新增 Skills**：

#### 1. `novel-workflow-world-engine-init`

**名称**：世界引擎初始化

**职责**：
- 引导用户初始化 World Engine
- 设计 calendar
- 设计或调整 schema
- 创建初始 subjects（world, 主角等）
- 写入初始状态

**流程**：
```markdown
1. 检查是否已有 world-engine/schema.yaml 和 calendar.ts
2. 如果没有，提供模板选择：
   - 现代公历模板
   - 简单纪年模板
   - 奇幻历法模板（可自定义月份）
3. 读取 lorebook，分析力量体系和世界观
4. 建议 schema 调整（增加对应属性）
5. 确认纪元起点时间和故事开始时间
6. 创建 world subject（纪元锚点）
7. 创建主角等初始角色
8. 写入初始状态 slice
9. 向用户说明如何使用（查询状态、记录事件）
```

**引导话术示例**：
```
【检测到用户要求初始化 World Engine】

我来帮你初始化世界引擎。需要完成几个步骤：

**1. 时间格式**
你的世界用什么历法？
- 现代公历（2024年1月1日）
- 简单纪年（第1年）
- 自定义奇幻历法（可以定义月份名称）

【用户选择"奇幻历法"】

好的。你想用什么纪元名称？（例如"星辉历"、"新纪元"）

【用户："星辉历"】

你的世界有几个月？每个月叫什么名字？
- 如果不确定，可以先用 12 个月，月份用数字（1月、2月...）
- 如果有特殊设定，可以自定义（例如"风信之月"、"炎夏之月"）

【用户自定义 4 个月】

好的。我记录了：
- 纪元：星辉历
- 月份：风信之月(90天)、炎夏之月(90天)、金秋之月(90天)、冰封之月(95天)

**2. 主体模式（Subject Schema）**
[继续引导 schema 设计...]
```

---

#### 2. 调整现有 Skills

**`novel-workflow-02-project-bootstrap`**：
- 在完成基础定位后，添加"是否需要初始化世界引擎"的提示
- 引导用户切换到 `novel-workflow-world-engine-init`

**`novel-workflow-08-plot-planning`**：
- 检查 World Engine 是否已初始化
- 如果已初始化，使用 `get_world_state` 查询当前状态辅助剧情设计
- 剧情设计后，使用 `write_world_slice` 记录状态变化

**`novel-workflow-09-chapter-writing`**：
- 章节写作前，使用 `get_world_state` 查询相关角色状态
- 章节完成后，使用 `write_world_slice` 记录状态变化

---

## 实施优先级

### Phase 1：References 文档（优先）

1. 创建 `reference/world-engine/calendar-system.md`
2. 创建 `reference/world-engine/schema-system.md`
3. 创建 `reference/world-engine/subject-lifecycle.md`
4. 创建 `reference/world-engine/workflow.md`

### Phase 2：新增 Skill

1. 创建 `novel-workflow-world-engine-init`
2. 测试初始化流程

### Phase 3：调整现有 Skills

1. 更新 `novel-workflow-02-project-bootstrap`
2. 更新 `novel-workflow-08-plot-planning`
3. 更新 `novel-workflow-09-chapter-writing`

### Phase 4：Calendar 增强

1. 使用 `calendar.ts` 的 simple / gregorian / custom 三类策略表达用户历法
2. 初始化 skill 引导用户选择策略并生成对应草稿
3. 前端配置入口打开 `world-engine/calendar.ts`

---

## 待讨论问题

1. **Calendar 增强的实现时机**：
   - Phase 1-3 可以先用现有 calendar 格式
   - Calendar 自定义月份功能可以作为独立任务（Task 65？）

2. **Schema 模板的数量**：
   - 提供几套模板？（奇幻、现代、科幻、修仙）
   - 模板放在哪里？（Project Workspace 模板 vs 运行时生成）

3. **Schema 调整的自动化程度**：
   - Leader 读取 lorebook 后，自动建议还是完全由用户决定？
   - 建议的 schema 调整是否需要用户逐项确认？

---

## 参考资料

- [docs/tasks/56-world-engine/README.md](../56-world-engine/README.md)
- [docs/tasks/56-world-engine/schema-design.md](../56-world-engine/schema-design.md)
- [docs/tasks/56-world-engine/agent-tools.md](../56-world-engine/agent-tools.md)
- [reference/agent/workspace-tool-use.md](../../../reference/agent/workspace-tool-use.md)
