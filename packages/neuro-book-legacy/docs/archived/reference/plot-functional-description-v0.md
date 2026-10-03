> 历史状态：本文件记录旧 Plot 对象模型，其中 `chapterPath` 等合同已被当前实现取代。当前 Plot 真相源见 [`../../../reference/plot/system.md`](../../../reference/plot/system.md) 与 [`../../../reference/plot/frontend.md`](../../../reference/plot/frontend.md)。

# Plot 系统功能说明

## 概述

Plot 系统是 neuro-book 中用于管理小说剧情结构的核心模块。它不是传统的章节大纲，也不是单纯的正文摘要，而是一套面向作者视角的剧情规划系统。

它的目标是把小说创作中常见的“主线、支线、场景、爽点、伏笔、冲突、反转、章节承载、写作提示、设定引用”拆成可浏览、可编辑、可排序、可被 Agent 消费的结构化对象。

Plot 系统回答的问题是：

- 整本书有哪些剧情阶段。
- 当前有哪些剧情线。
- 每条线由哪些 Scene 推进。
- 每个 Scene 最终写进哪一章。
- 一个 Scene 内部有哪些 Plot 节奏点。
- 当前剧情对象依赖哪些角色、地点、设定、物品或其他剧情对象。
- Writer / Planner / Critic 等 Agent 应该怎样读取剧情上下文。

## 核心定位

### 作者视角的剧情真相源

正文目录表达读者看到的顺序，Plot 系统表达作者设计剧情时知道的因果结构。

两套结构的职责不同：

- 正文目录：`Novel / manuscript chapter`，回答“读者按什么顺序看到文本”。
- 剧情结构：`Story / Phase / Thread / Scene / Plot`，回答“作者如何设计和管理剧情推进”。

因此，Plot 系统不是对章节目录的重命名。一个 Thread 可以跨多个章节；一个章节也可以承载多个 Thread 的 Scene。

### Scene 是核心工作单位

Plot 系统的高频工作重心是 Scene。

Scene 同时连接两套世界：

- 在剧情结构中，Scene 属于某个 Thread。
- 在正文结构中，Scene 可以挂到某个 `manuscript/.../` 章节路径。

这让 Scene 成为作者和 Agent 最适合协作的最小稳定单位。Thread 更适合规划，Plot 更适合细化节奏，Chapter 更适合表达正文承载。

### 多线剧情管理

Thread 用于管理多线叙事。它可以表示：

- 主线。
- 支线。
- 伏笔线。
- 人物成长线。
- 阵营冲突线。
- 世界事件线。

Thread 不等于 Chapter。它是一串按因果顺序组织起来的 Scene 列表，用于回答“这条线如何推进”。

## 对象模型

### Story

Story 是单本小说的剧情根作用域。

功能：

- 与 Novel 一一对应。
- 统一挂载 StoryPhase、Thread、Scene、Plot。
- 提供整书级剧情摘要和备注。
- 作为剧情查询、Agent 上下文装配和权限边界的根。

典型字段：

- `title`：剧情结构标题。
- `summary`：整书剧情摘要。
- `note`：作者备注。

### StoryPhase

StoryPhase 是剧情阶段分组。

功能：

- 对 Thread 做阶段性整理。
- 支撑大型长篇的分段浏览和筛选。
- 降低 Thread 数量过多时的管理复杂度。

注意：

- StoryPhase 不是 Volume。
- StoryPhase 不直接决定正文目录。
- StoryPhase 更偏整理和定位，不是剧情推理的核心层。

典型字段：

- `name`：机器名。
- `title`：展示标题。
- `summary`：阶段摘要。
- `sortOrder`：阶段顺序。

### Thread

Thread 是一条剧情因果线。

功能：

- 管理一组按因果顺序推进的 Scene。
- 标记主线或支线。
- 记录该线的状态、标签、摘要和长期写作策略。
- 承载 Thread 级 refs，作为下属 Scene 的继承上下文。

典型字段：

- `title`：剧情线标题。
- `summary`：这条线讲什么。
- `isMainThread`：是否主线。
- `status`：`draft / active / paused / done / archived`。
- `tags`：自定义标签。
- `writingTip`：这条线的长期写作策略。
- `refs`：稳定背景、长期依赖、常驻设定。

典型操作：

- 新建 Thread。
- 编辑 Thread。
- 设置主线。
- 调整状态。
- 按 Phase 归组。
- 管理 Thread 下的 Scene 顺序。

### Scene

Scene 是剧情系统中的基本叙事单位。

功能：

- 表达一场戏或一个连续叙事单元。
- 属于且只属于一个 Thread。
- 可以挂接到一个 manuscript chapter。
- 同时拥有 Thread 内顺序和 Chapter 内顺序。
- 承载局部 refs、Plot 列表、目的和写作提示。

典型字段：

- `title`：Scene 标题。
- `summary`：这一场发生了什么。
- `purpose`：这一场为什么存在。
- `status`：`draft / active / written / revised / archived`。
- `threadSortOrder`：在线程内的因果顺序。
- `chapterPath`：挂接的正文 content-node 章节路径，未挂章时为空。
- `chapterSortOrder`：在章节内的正文顺序，未挂章时为空。
- `writingTip`：这一场的写作策略。
- `refs`：该场独有的局部上下文约束。
- `effectiveRefs`：Thread refs 与 Scene refs 合成后的有效引用。

典型操作：

- 新建 Scene。
- 编辑 Scene。
- 快速编辑标题、状态、章节、摘要、目的、写作提示。
- 在线程内拖拽排序。
- 挂接或移出章节。
- 管理 Scene 内的 Plot。
- 管理 Scene refs。

### Plot

Plot 是 Scene 内部的最小推进点。

功能：

- 拆开一场戏内部的节奏。
- 表达一个动作、一次冲突、一次揭示、一次反转、一次爽点兑现或一个结果。
- 帮助作者和 Agent 判断一场戏内部是否有推进、铺垫和回收。

典型字段：

- `kind`：Plot 类型。
- `summary`：当前 Plot 的简述。
- `effect`：当前 Plot 带来的结果。
- `writingTip`：当前 Plot 的写作提示。
- `sortOrder`：在 Scene 内的顺序。

Plot 类型：

- `setup`：铺垫。
- `action`：行动。
- `conflict`：冲突。
- `despair`：低谷。
- `relief`：释放。
- `reward`：回报。
- `mystery`：悬念。
- `reveal`：揭示。
- `twist`：反转。
- `payoff`：回收。
- `result`：结果。

典型操作：

- 新增 Plot。
- 编辑 Plot 类型、摘要、结果、写作提示。
- 删除 Plot。
- 在 Scene 内拖拽排序。

## 引用系统

### 功能定位

refs 用于把剧情对象与设定、角色、地点、物品、规则、其他剧情对象建立结构化关系。

它解决的问题是：

- 当前 Scene 涉及哪些设定或角色。
- 当前 Thread 长期依赖哪些世界规则。
- 某个 Scene 是否在铺垫或回收某个伏笔。
- Agent 写作时应该加载哪些额外上下文。

### 适用对象

当前高频支持：

- Thread refs。
- Scene refs。

当前不把 Plot refs 作为独立高频能力。Plot 通过所属 Scene 获得上下文。

### Ref 字段

每条 ref 包含：

- `relation`：关系语义，例如 `involves`、`foreshadows`、`setup_for`、`payoff_of`。
- `target`：目标。
- `visibility`：`author` 或 `reader`。
- `note`：补充说明。

### Target 规则

设定、角色、地点、物品等内容节点使用 workspace path：

```text
lorebook/character/example/index.md
lorebook/location/example/index.md
```

剧情内部对象使用 URI：

```text
thread://12
scene://34
plot://56
```

不再支持 legacy `pending://` 或 `pending.*`。如果某个对象尚未落地，应先创建 pending 状态的 content-node，再通过 content-node path 引用。

### effectiveRefs

Scene 的有效引用由两部分组成：

```text
effectiveRefs = Thread.refs + Scene.refs
```

Thread refs 用于长期背景，Scene refs 用于局部约束。Agent 消费某个 Scene 时，应读取 effectiveRefs，而不是只读取 Scene 自身 refs。

## 章节挂接

当前实现已经移除数据库 `Volume / Chapter` 表。正文章节以 workspace 文件树为真相源。

Scene 通过 `chapterPath` 挂接到正文章节：

```text
manuscript/001-volume/001-chapter/
```

功能：

- `chapterPath = null` 表示 Scene 尚未进入正文。
- `chapterSortOrder = null` 表示 Scene 尚未拥有章节内顺序。
- 同一个 Chapter 可以包含多个 Scene。
- 同一条 Thread 下的 Scene 可以分布在多个 Chapter。

这使得 Plot 系统能同时支持两种排序：

- `threadSortOrder`：剧情因果顺序。
- `chapterSortOrder`：正文展示顺序。

## 前端功能

### 单 Thread 侧边栏

单 Thread 侧边栏是一种局部剧情工作视图。

功能：

- 选择当前 Thread。
- 展示当前 Thread 摘要、状态、主线标记、标签。
- 展示当前 Thread 下的 Scene 列表。
- 支持 Scene 拖拽排序。
- 展示 Scene 快速摘要、状态、挂章、目的、Plot 数、Ref 数。
- 选中 Scene 后在底部展示详情面板。
- 支持 Scene 快速编辑和 AI 批注。

适用场景：

- 作者正在处理某一条线。
- 快速检查这条线是否连贯。
- 快速调整 Scene 顺序。
- 快速补 Scene 的目的、摘要和章节挂接。

限制：

- 不负责完整多线比较。
- 不负责整书树图。
- 不负责大量 Plot / Ref 编辑，完整编辑应进入 Dialog。

### Thread 编辑器

Thread 编辑器用于维护一条剧情线的整体定位。

功能：

- 编辑标题。
- 编辑状态。
- 设置是否主线。
- 编辑摘要。
- 编辑标签。
- 编辑写作提示。
- 调用 AI 批注并应用建议到草稿。
- 在关闭脏表单时提示保存、放弃或取消。

### Scene 编辑器

Scene 编辑器用于维护一场戏的完整结构。

功能：

- 编辑标题、状态、章节。
- 编辑摘要、目的、写作提示。
- 查看 Ref 数和 Plot 数。
- 管理 Plot 列表。
- 管理 Ref 列表。
- 调用 AI 批注并应用建议到草稿。
- 在关闭脏表单时提示保存、放弃或取消。

### Plot 编辑

Plot 编辑嵌入在 Scene 编辑器中。

功能：

- 新增 Plot。
- 选择 Plot 类型。
- 编辑摘要、结果、写作提示。
- 删除 Plot。
- 拖拽调整 Plot 顺序。

### Ref 编辑

Ref 编辑嵌入在 Scene 编辑器中。

功能：

- 新增 Ref。
- 编辑 relation。
- 编辑 target。
- 编辑 visibility。
- 编辑 note。
- 删除 Ref。

## Agent 协作功能

### Scene 级上下文

Writer 处理某个 Scene 时，至少应读取：

- 当前 Scene。
- 当前 Scene 的 Plot 列表。
- 当前 Scene 自身 refs。
- 当前 Scene 的 effectiveRefs。
- 当前 Scene 所属 Thread 的基础信息。

如果 Scene 已挂章，可以再读取章节邻近上下文，但章节上下文不能替代剧情上下文。

### Planner 功能

Planner 更适合工作在 Thread 或 Phase 视角。

可支持：

- 判断某条线缺哪些 Scene。
- 判断某条线是否中断太久。
- 检查伏笔是否有回收位点。
- 建议 Scene 拆分或合并。
- 建议 Plot 节奏调整。

### Critic 功能

Critic 更适合检查 Scene 与正文、Plot、refs 之间的一致性。

可支持：

- 检查 Scene summary 与正文是否一致。
- 检查 Scene purpose 是否实现。
- 检查 Plot kind 节奏是否合理。
- 检查 refs 涉及的设定是否被误写。
- 检查铺垫和回收是否前后矛盾。

### AI 批注

AI 批注是表单草稿级能力。

Thread AI 批注可基于当前 Thread 草稿提出修改，并应用到：

- `title`
- `summary`
- `writingTip`
- `status`
- `isMainThread`

Scene AI 批注可基于当前 Scene 草稿提出修改，并应用到：

- `title`
- `summary`
- `purpose`
- `writingTip`
- `status`
- `chapterPath`

AI 批注只修改草稿，不应绕过用户确认直接保存。

## 典型工作流

### 从灵感到结构

1. 作者先记录一个剧情驱动点，例如冲突、反转、爽点、悬念或设定兑现。
2. 判断它属于已有 Thread，还是需要新建 Thread。
3. 把驱动点拆成一个或多个 Scene。
4. 为 Scene 补充 summary、purpose、chapterPath。
5. 需要更细节奏时，再拆 Plot。
6. 为 Thread 或 Scene 绑定 refs。

### 从 Thread 规划正文

1. 选择一条 Thread。
2. 浏览该 Thread 下的 Scene 顺序。
3. 拖拽调整因果顺序。
4. 为每个 Scene 挂接 manuscript chapter。
5. 对关键 Scene 拆 Plot。
6. 交给 Writer 或 Planner 继续协作。

### 从章节检查剧情承载

1. 选择某个 manuscript chapter。
2. 查看挂入该章的 Scene。
3. 检查每个 Scene 的 Thread 来源。
4. 检查 Plot 节奏是否覆盖本章目标。
5. 调整 Scene 的 `chapterSortOrder` 或回到 Thread 视角调整因果结构。

## 非目标

当前 Plot 系统不负责：

- 替代 manuscript 正文文件。
- 替代 lorebook 设定真相源。
- 自动生成完整剧情。
- 自动推导完整剧情网络。
- 让一个 Scene 同时属于多个 Thread。
- 让 Plot 跨多个 Scene。
- 条件剧情 DSL。
- 复杂规则引擎。

这些能力可以作为后续扩展，但不属于当前 Plot 系统的核心功能闭环。

## 与规范文档的关系

本文描述 Plot 系统“能做什么”和“用户/Agent 如何使用它”。

稳定实现契约仍以以下文档为准：

- [../../../reference/plot/system.md](../../../reference/plot/system.md)
- [../../../reference/plot/frontend.md](../../../reference/plot/frontend.md)
