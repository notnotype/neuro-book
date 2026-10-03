# 剧情模块规范 v0.2

## 当前实现修订：章节来源

当前实现已经移除数据库 `Volume` / `Chapter` 表。书稿章节以 workspace 文件树为真相源：章节是 `manuscript/.../` 下带 `index.md` 的 content-node 目录。

`StoryScene` 不再保存 `chapterId`，而是保存 `chapterPath: string | null`。例如：

```ts
chapterPath: "manuscript/001-volume/001-chapter/"
```

因此本文后续历史段落中提到的 `Chapter` 数据库关系、`chapterId` 字段、`index(chapterId, chapterSortOrder)`，在当前实现中应理解为：

- `Chapter`：manuscript content-node 目录。
- `chapterId`：已替换为 `chapterPath`。
- `index(chapterId, chapterSortOrder)`：已替换为 `index(chapterPath, chapterSortOrder)`。

`StoryPlot.kind` 当前数据库枚举包含 `relief` 和 `reward`；并发创建同一 Scene 下的 Plot 时，服务端会先获取 Scene 级 advisory lock，再计算下一个 `sortOrder`，避免 `(sceneId, sortOrder)` 唯一约束冲突。

## 一、设计目标

- 作为单本小说内剧情结构的真相源（Source of Truth）
- 明确区分两组概念：
  - 剧情模块概念：`Story`、`StoryPhase`、`Thread`、`Scene`、`Plot`
  - 书稿目录概念：`Novel`、`Volume`、`Chapter`
- 为当前项目提供可直接继续落地到 Prisma / PostgreSQL / DTO 的字段基础
- 保持 v1 务实：
  - 先把重点放在 `Thread`、`Scene`、`Plot`
  - `Story`、`StoryPhase` 主要承担分组、检索、浏览职责
  - 暂不设计复杂规则引擎、条件剧情 DSL、自动拓扑推理
- 第二版新增重点：
  - 引入统一引用系统（`refs`）
  - 允许剧情对象显式引用设定、人物、物品、其他剧情对象
  - 开始结构化表达伏笔、铺垫、写作指导、注释
  - 将 Reward / Conflict / Twist / Mystery 纳入剧情驱动要素设计

---

## 二、核心原则

### 1. 单本小说作用域

剧情模块必须属于某一本 `novel`。

因此：

- `Story` 与 `Novel` 一一对应
- 所有剧情对象都必须能回溯到同一个 `storyId`
- `storyId` 本质上是当前小说下剧情结构的根作用域

---

### 2. 两组概念必须分开

剧情模块概念：

```text
Story
  └── StoryPhase
        └── Thread
              └── Scene
                    └── Plot
```

书稿目录概念：

```text
Novel
  └── Volume
        └── Chapter
```

这两组概念有关联，但不能混为一谈。

---

### 3. 引入两个视角

#### 读者视角

读者视角对应：

```text
Novel
  └── Volume
        └── Chapter
```

它的作用是：

- 理解当前阅读上下文
- 理解内容已经写到了哪里
- 理解章节级前后文

注意：

- 读者视角是**非全知视角**
- 它只应该表达“文本已经呈现出来的信息”

---

#### 作者视角

作者视角对应：

```text
Story
  └── StoryPhase
        └── StoryThread
              └── StoryScene
                    └── StoryPlot
```

它的作用是：

- 设计剧情
- 管理因果推进
- 管理主线、支线、伏笔线
- 记录尚未写入正文、但作者已经知道的信息

注意：

- 作者视角是**上帝视角 / 全知视角**
- 它不是读者当前已知信息的简单镜像

---

### 4. Story 与 StoryPhase 不是重点

在 v1 中：

- `Story` 主要用于整书级剧情作用域
- `StoryPhase` 主要用于阶段分组、检索、筛选、浏览

它们不是剧情推理的重点。

剧情模块真正的重点是：

- `Thread`
- `Scene`
- `Plot`

---

### 5. Thread 与 Scene 采用一对多关系

v1 明确采用以下约束：

```text
Thread 1 -> N Scene
```

也就是说：

- 一个 `Thread` 包含多个 `Scene`
- 一个 `Scene` 只属于一个 `Thread`

这样做的目的：

- 简化数据库结构
- 简化前端编辑器
- 简化 Agent 上下文组织

---

### 6. Scene 是剧情系统与正文系统的桥梁

`Scene` 同时参与两套结构：

- 在剧情结构中，它属于某个 `Thread`
- 在正文结构中，它最终属于某个 `Chapter`

因此：

- `Scene` 是剧情模块最重要的桥接单位
- Writer / Planner / Critic 等 Agent 最适合消费 `Scene`

---

### 7. Scene 必须同时记录两种顺序

一个 `Scene` 同时存在两种顺序：

- 在 `Thread` 中的因果顺序
- 在 `Chapter` 中的正文顺序

因此数据库中至少需要：

- `threadSortOrder`
- `chapterSortOrder`

不能只保留一个通用 `sortOrder`。

---

### 8. 引用系统是第二版的基础能力

在剧情模块中，很多高阶功能都建立在“先能引用”之上。

例如：

- 一个 `Scene` 涉及哪些人物、地点、物品、规则
- 一个 `Plot` 在铺垫什么设定
- 一个 `Scene` 是否在回收之前埋下的伏笔
- 一条 `Thread` 依赖哪些世界书条目才能成立

因此 v0.2 明确要求：

- `Thread`、`Scene` 都应支持 `refs`
- `refs` 必须能指向：
  - `lorebook`
  - `thread`
  - `scene`
  - `plot`
  - `pending`

---

### 9. 伏笔、铺垫、写作指导不应只藏在自由文本里

如果只依赖 `summary` / `note`：

- 前端难以做结构化展示
- Agent 难以稳定提取
- 难以判断某个伏笔是否已经回收
- 难以知道某个 Scene 到底在铺垫什么

因此 v0.2 采用以下原则：

- 伏笔 / 铺垫 / 回收，优先通过 `refs.relation` 表达
- 写作指导，优先通过 `writingTip` 表达
- 临时说明、编辑备注，继续放在 `note`

---

### 10. 创作驱动要素需要进入结构化字段

人在构思一章或一个场景时，通常不只是按事件顺序思考，还会考虑：

- `Reward`
- `Conflict`
- `Twist`
- `Mystery`

这些不是独立剧情对象，但应该被剧情系统记录下来。

因此 v0.2 建议：

- `Plot.kind` 扩展到更贴近创作驱动的枚举

其中推荐值包括：

- `reward`
- `conflict`
- `despair`
- `relief`
- `twist`
- `mystery`

这些驱动要素主要用于：

- 帮助作者理解当前 Scene / Plot 的创作目标
- 帮助 Agent 规划节奏与信息释放

但 v0.2 不强制为 `Thread` / `Scene` 单独增加专门的驱动标签字段。

---

### 11. `summary` 与 `note` 的语义必须稳定

为了避免字段混乱，v1 统一采用以下约束：

- `summary`：面向结构化理解的核心摘要，应该尽量短、稳定、可检索
- `note`：面向作者内部工作的补充备注，可以更自由、更临时

因此：

- `summary` 应优先承担“让人或 AI 快速理解这个对象是什么”的职责
- `note` 应优先承担“补充说明、工作备注、编辑提醒”的职责

---

### 12. API 可嵌套，数据库尽量扁平

为了让前端和 Agent 更好消费，API 可以返回嵌套结构：

- `thread -> scenes -> plots`
- `chapter -> scenes`

但数据库落库应尽量扁平，优先使用：

- 主表字段
- 明确外键
- 独立排序字段

---

## 三、概念定义

### 1. Story

#### 定义

`Story` 是单本小说的剧情作用域根。

#### 作用

- 与 `Novel` 一一对应
- 作为剧情对象的统一挂载点
- 便于整书级剧情检索

---

### 2. StoryPhase

#### 定义

`StoryPhase` 是 `Story` 下的剧情阶段分组。

#### 作用

- 对 `Thread` 进行阶段性分类
- 便于筛选、搜索、浏览
- 在大型长篇中降低 Thread 管理成本

#### 注意

- `StoryPhase` 不是 `Volume` 的别名
- `StoryPhase` 与 `Volume` 没有稳定的一一对应关系

---

### 3. Thread

#### 定义

`Thread` 是由多个 `Scene` 构成的因果逻辑线。

#### 作用

- 表达主线、支线、伏笔线等剧情推进逻辑
- 为 AI 提供比 `Chapter` 更适合推理的结构
- 为作者提供多线叙事管理能力

#### 注意

- `Thread` 与 `Chapter` 没有直接对应关系
- 同一个 `Thread` 下的 `Scene` 可以分布在多个 `Chapter`

---

### 4. Scene

#### 定义

`Scene` 是剧情模块中的基本叙事单位。

#### 作用

- 是人类构造剧情时最自然的工作单位
- 是 AI 最稳定的剧情消费单位
- 是剧情结构与正文结构的桥梁

#### 关系

- 一个 `Scene` 属于一个 `Thread`
- 一个 `Scene` 最终属于一个 `Chapter`
- 一个 `Scene` 由多个 `Plot` 构成

---

### 5. Plot

#### 定义

`Plot` 是 `Scene` 内部的最小动作单位。

#### 作用

- 细化 Scene 内部推进
- 拆分动作、冲突、转折、揭示、结果
- 为未来更细的节奏分析和自动规划提供基础

---

## 四、与现有模块的关系

### 1. 与 Novel / Volume / Chapter 的关系

- `Story` 与 `Novel` 一一对应
- `Volume` 仍然是书稿目录单位
- `Chapter` 仍然是正文组织单位
- 一章包含多个 `Scene`

其中：

- `Novel / Volume / Chapter` 更接近读者视角
- `Story / StoryPhase / Thread / Scene / Plot` 更接近作者视角

注意：

- `StoryPhase` 与 `Volume` 没有直接映射
- `Thread` 与 `Chapter` 没有直接映射

---

### 2. 与 Lorebook 的关系

剧情模块不替代 `lorebook`。

两者职责不同：

- `lorebook` 管理设定真相源
- 剧情模块管理剧情推进结构

在 v0.2 中：

- 剧情对象可以通过 `refs` 显式引用 lorebook 条目
- 这样可以结构化表达“该场涉及谁 / 什么物品 / 哪条规则 / 哪个地点”
- 但 v1 仍然不要求把所有剧情字段都强制绑定为 lorebook 外键

---

### 3. 与 Agent 的关系

当前 Agent 侧已经存在“剧情点”输入，但粒度仍是字符串数组。

剧情模块落地后，后续可以逐步把 Agent 输入升级为：

- 当前 `Thread`
- 当前 `Scene`
- 当前 `Scene` 的 `Plot` 列表
- 当前 `Scene` 关联的上下文约束

---

## 五、引用系统（v0.2）

### 1. 设计目标

剧情引用系统用于支持：

- 剧情涉及到的设定、人物、地点、物品、规则
- 伏笔、铺垫、回收
- 线程间、场景间、情节点间的结构化关联
- 后续 Writer / Planner / Critic 的上下文构造

---

### 2. 适用范围

以下对象都应支持 `refs`：

- `StoryThread`
- `StoryScene`

以下对象暂不支持 `refs`：

- `Story`
- `StoryPhase`
- `StoryPlot`

这样可以把第二版的引用复杂度控制在最关键的两层：

- 线级上下文：`StoryThread`
- 场级上下文：`StoryScene`

---

### 3. API 结构

v0.2 推荐统一采用：

```yaml
refs:
  - relation: string
    target: string
    visibility: "author" | "reader"
    note: string | null
```

字段说明：

- `relation`：关系语义
- `target`：目标标识
- `visibility`：
  - `author` 表示仅作者 / Agent 内部已知
  - `reader` 表示该关系对应的信息已经进入读者可见层
- `note`：对该关系的补充说明

---

### 4. `target` 推荐格式

推荐支持以下目标：

```text
lorebook/character/headmaster/
lorebook/item/old-key/
lorebook/location/city-ba/orphanage/

thread://12
scene://34
plot://56
```

说明：

- `lorebook/.../` 指向文件化内容节点，使用 workspace 相对路径
- `thread://` / `scene://` / `plot://` 指向剧情内部对象
- Plot refs 不再支持 `pending://` 或 `pending.*`；未落地目标应先写入 `status: pending` 的内容节点，再引用其路径

---

### 5. `relation` 推荐语义

第二版推荐优先支持以下关系语义：

#### 通用涉及关系

- `involves`
- `mentions`
- `uses`
- `located_at`
- `depends_on`
- `reveals`
- `hides`

#### 伏笔 / 铺垫 / 回收关系

- `foreshadows`
- `setup_for`
- `payoff_of`
- `callbacks_to`

#### 剧情内部关系

- `precedes`
- `follows`
- `parallels`
- `contrasts_with`

说明：

- v0.2 不强制把 `relation` 做成数据库 enum
- 推荐先保留为字符串，便于快速演化

---

### 6. 伏笔与铺垫的设计原则

在第二版中：

- “伏笔”不是单独依赖自由文本描述
- 它应主要通过 `refs.relation` 表达

例如：

```yaml
refs:
  - relation: foreshadows
    target: plot:old-key-payoff
    visibility: author
    note: 旧钥匙第一次出现，但正文不解释用途
```

或：

```yaml
refs:
  - relation: setup_for
    target: scene:orphanage-fire-truth
    visibility: author
    note: 为后续真相揭示做铺垫
```

---

### 7. `pending` 引用

与 lorebook 一样，剧情模块也应支持 `pending` 引用。

含义：

- 当前剧情已经需要该对象
- 但该对象尚未正式落地为 lorebook 或剧情条目

这有助于：

- 让 Agent 发现“缺失设定”
- 支持先写剧情骨架，再补设定

---

### 8. Ref 继承规则

`Ref` 具有继承性质。

具体规则：

- `StoryThread.refs` 会被其下属 `StoryScene` 继承
- `StoryScene.refs` 只作用于当前 `Scene`
- 当前版本不支持 `StoryPlot.refs`

因此当 Agent 为某个 `Scene` 构造上下文时，至少应加载：

- 当前 `Scene` 自身的 `refs`
- 当前 `Scene` 所属 `Thread` 的 `refs`

可理解为：

```text
effectiveSceneRefs = inheritedThreadRefs + ownSceneRefs
```

其中：

- `Thread refs` 负责提供稳定背景、长期依赖、常驻相关设定
- `Scene refs` 负责提供该场独有的局部上下文

## 六、v1 数据库设计总览

建议采用以下模型命名，避免与现有对象冲突：

- `Story`
- `StoryPhase`
- `StoryThread`
- `StoryScene`
- `StoryPlot`
- `StoryThreadRef`
- `StorySceneRef`

说明：

- 领域概念里仍然写 `Thread`、`Scene`、`Plot`
- 数据库 / Prisma 模型层使用 `StoryThread` 等更安全
- 这样可以避免与现有 `AgentThread` 命名冲突

---

## 七、数据库字段设计

### 1. `Story`

#### 推荐字段

```yaml
id: Int
novelId: Int

title: String
summary: String
note: String | null

createdAt: DateTime
updatedAt: DateTime
```

#### 字段说明

##### `id`

- 数据库主键

##### `novelId`

- 对应的小说 ID
- 与 `Novel` 一一对应

##### `title`

- 剧情结构展示标题
- 默认可与小说标题相同

##### `summary`

- 整书级剧情摘要
- 用于检索、列表展示、Agent 整书级上下文

##### `note`

- 作者内部备注
- 为空表示无额外备注

#### 推荐索引

- `unique(novelId)`

---

### 2. `StoryPhase`

#### 推荐字段

```yaml
id: Int
storyId: Int
sortOrder: Int

name: String
title: String
summary: String
note: String | null

createdAt: DateTime
updatedAt: DateTime
```

#### 字段说明

##### `storyId`

- 所属 `Story`

##### `sortOrder`

- 在当前 `Story` 下的阶段顺序

##### `name`

- 稳定机器名
- 建议使用 kebab-case

##### `title`

- 展示名
- 允许中文

##### `summary`

- 阶段摘要
- 主要用于检索和浏览

##### `note`

- 作者内部备注
- 为空表示无额外备注

#### 推荐索引

- `index(storyId, sortOrder)`
- `unique(storyId, name)`

---

### 3. `StoryThread`

#### 推荐字段

```yaml
id: Int
storyId: Int
storyPhaseId: Int | null
sortOrder: Int

name: String
title: String

isMainThread: Boolean
status: "active" | "draft" | "paused" | "done" | "archived"

summary: String
tags: String[]
writingTip: String | null
note: String | null

createdAt: DateTime
updatedAt: DateTime
```

#### 字段说明

##### `storyId`

- 所属 `Story`

##### `storyPhaseId`

- 所属 `StoryPhase`
- 为空表示当前 Thread 暂未归入具体阶段

##### `sortOrder`

- 在 `StoryPhase` 内的显示顺序
- 若 `storyPhaseId` 为空，则表示未分组线程区内的顺序

##### `name`

- 稳定机器名
- 建议在同一 `Story` 内唯一

##### `title`

- 展示名称

##### `isMainThread`

- 是否为主线 Thread
- `true` 表示主线
- `false` 表示非主线

##### `tags`

- 自定义标签
- 用于作者自行分类、检索、筛选
- 不内建固定语义枚举

##### `status`

- 线程状态
- `draft`：草稿中
- `active`：正在推进
- `paused`：暂时搁置
- `done`：已完成
- `archived`：归档

##### `summary`

- Thread 摘要

##### `writingTip`

- 给 Writer / Planner / Critic 的写作指导
- 不属于剧情正文真相本身
- 为空表示没有额外指导

##### `note`

- 补充备注
- 为空表示无额外备注

#### 推荐索引

- `index(storyId, storyPhaseId, sortOrder)`
- `index(storyId, isMainThread, status)`
- `unique(storyId, name)`

---

### 4. `StoryScene`

#### 推荐字段

```yaml
id: Int
storyId: Int
threadId: Int
chapterId: Int | null

threadSortOrder: Int
chapterSortOrder: Int | null

title: String
status: "draft" | "active" | "written" | "revised" | "archived"

summary: String
purpose: String | null
writingTip: String | null
note: String | null

createdAt: DateTime
updatedAt: DateTime
```

#### 字段说明

##### `storyId`

- 所属 `Story`
- 用于方便按整书过滤，不必每次都经过 `Thread` 反查

##### `threadId`

- 所属 `StoryThread`
- v1 明确规定一个 Scene 只能属于一个 Thread

##### `chapterId`

- 对应正文中的 `Chapter`
- 为空表示该 Scene 还没有被挂入具体章节

##### `threadSortOrder`

- 在 `Thread` 中的因果顺序

##### `chapterSortOrder`

- 在 `Chapter` 中的正文顺序
- 为空表示当前 Scene 尚未分配进具体章节顺序

##### `title`

- Scene 标题

##### `status`

- `draft`：剧情草稿
- `active`：当前正在编辑或规划
- `written`：正文已完成
- `revised`：完成修订
- `archived`：归档

##### `summary`

- Scene 核心摘要
- 应尽量能回答“这一场发生了什么”

##### `purpose`

- 该 Scene 的功能说明
- 例如：推进冲突、引入角色、埋伏笔、兑现伏笔
- 为空表示尚未填写

##### `writingTip`

- 该 Scene 的写作指导
- 例如节奏、情绪、表现方式、保留信息策略
- 为空表示无额外指导

##### `note`

- 编辑备注
- 为空表示无额外备注

#### 推荐索引

- `index(threadId, threadSortOrder)`
- `index(chapterId, chapterSortOrder)`
- `index(storyId, status)`
- `unique(threadId, threadSortOrder)`

说明：

- `unique(chapterId, chapterSortOrder)` 不建议在 v1 直接加数据库唯一约束
- 原因是 `chapterId` 允许为空，且拖拽重排时常需要短时间中间态
- v1 可先由服务端事务逻辑保证章节内顺序稳定

---

### 5. `StoryPlot`

#### 推荐字段

```yaml
id: Int
sceneId: Int
sortOrder: Int

kind: "setup" | "action" | "conflict" | "despair" | "relief" | "reward" | "mystery" | "reveal" | "twist" | "payoff" | "result"
summary: String

effect: String | null
writingTip: String | null
note: String | null

createdAt: DateTime
updatedAt: DateTime
```

#### 字段说明

##### `sceneId`

- 所属 `StoryScene`

##### `sortOrder`

- 在当前 Scene 内的顺序

##### `kind`

- Plot 类型
- `setup`：铺垫
- `action`：动作
- `conflict`：冲突
- `despair`：低谷 / 压迫到接近失败
- `relief`：释放 / 缓解压力后的情绪兑现
- `reward`：爽点 / 奖励兑现
- `mystery`：悬念 / 信息缺口
- `reveal`：揭示
- `twist`：反转
- `payoff`：伏笔回收 / 铺垫兑现
- `result`：结果

##### `summary`

- 当前 Plot 的简述

##### `effect`

- 当前 Plot 的结果
- 为空表示未显式记录

##### `writingTip`

- 当前 Plot 的写作提示
- 用于提醒表现手法、信息密度、节奏控制
- 为空表示无额外指导

##### `note`

- 额外说明
- 为空表示无额外备注

#### 推荐索引

- `index(sceneId, sortOrder)`
- `unique(sceneId, sortOrder)`

---

### 6. `StoryThreadRef`

#### 推荐字段

```yaml
id: Int
threadId: Int
sortOrder: Int

relation: String
rawTarget: String
targetKind: "content" | "thread" | "scene" | "plot"

targetThreadId: Int | null
targetSceneId: Int | null
targetPlotId: Int | null

visibility: "author" | "reader"
note: String | null

createdAt: DateTime
updatedAt: DateTime
```

#### 字段说明

- `rawTarget`：原始目标字符串
- `targetKind`：解析后的目标类型
- `content` 目标使用 `rawTarget` 保存内容节点路径；剧情内部目标使用对应 `target*Id` 外键
- `visibility`：该关系在作者视角还是读者视角可见
- `note`：关系补充说明

#### 推荐索引

- `index(threadId, sortOrder)`
- `index(targetThreadId)`
- `index(targetSceneId)`
- `index(targetPlotId)`

---

### 7. `StorySceneRef`

#### 推荐字段

```yaml
id: Int
sceneId: Int
sortOrder: Int

relation: String
rawTarget: String
targetKind: "content" | "thread" | "scene" | "plot"

targetThreadId: Int | null
targetSceneId: Int | null
targetPlotId: Int | null

visibility: "author" | "reader"
note: String | null

createdAt: DateTime
updatedAt: DateTime
```

#### 推荐索引

- `index(sceneId, sortOrder)`
- `index(targetThreadId)`
- `index(targetSceneId)`
- `index(targetPlotId)`

---

## 八、关系与约束总结

### 1. 结构关系

```text
Story 1 -> 1 Novel
Story 1 -> N StoryPhase
StoryPhase 1 -> N StoryThread
StoryThread 1 -> N StoryScene
Chapter 1 -> N StoryScene
StoryScene 1 -> N StoryPlot
StoryThread 1 -> N StoryThreadRef
StoryScene 1 -> N StorySceneRef
```

---

### 2. v1 允许为空的关键外键

#### `storyPhaseId`

- 为空表示当前 Thread 尚未完成阶段归类

#### `chapterId`

- 为空表示当前 Scene 还处于剧情规划阶段，尚未挂入正文章节

#### `chapterSortOrder`

- 为空表示该 Scene 尚未进入某个 Chapter 的正文顺序

---

### 3. v1 明确不支持的复杂关系

以下能力暂不进入 v1：

- 一个 `Scene` 属于多个 `Thread`
- 一个 `Plot` 跨多个 `Scene`
- 自动根据依赖关系拓扑排序 `Scene`
- 条件剧情分支 DSL
- 自动根据 refs 推断全文剧情网

---

## 九、服务端实现架构

为了避免剧情模块继续演化成单文件工具集，服务端实现应固定采用分层结构。

推荐依赖方向：

```text
server/api/novels/[novelId]/plot/**
        -> PlotFacade
            -> PlotInputParser
            -> StoryService / ThreadService / SceneService / PlotService
                -> PlotScopeGuard
                -> StoryRepository / ThreadRepository / SceneRepository / PlotRepository
            -> RefResolverService / OrderService
            -> PlotDtoAssembler
```

### 1. 分层职责

- `route`：只负责 HTTP 参数读取、请求体校验、调用 facade
- `PlotFacade`：作为剧情模块唯一入口，负责事务边界与对象图装配
- `PlotInputParser`：把 public DTO 解析成内部 `number / null` 输入，service 不直接处理 string ID
- `StoryService`：负责 `Story / StoryPhase / Story scope` 相关规则
- `ThreadService`：负责 `StoryThread` 的 CRUD、重排与 refs 写入
- `SceneService`：负责 `StoryScene` 的 CRUD、重排与 `effectiveRefs`
- `PlotService`：负责 `StoryPlot` 的 CRUD 与重排
- `PlotScopeGuard`：负责跨 service 复用的存在性、归属关系、唯一性校验
- `RefResolverService`：统一解析 `lorebook / thread / scene / plot / pending` 引用
- `OrderService`：统一管理 bucket 排序、连续性校验、normalize 规则
- `Repository`：只负责 Prisma 数据访问，不直接拼 DTO
- `PlotDtoAssembler`：只负责对外 DTO 组装，不写数据库

### 2. 事务规则

- 所有写操作由 `PlotFacade` 统一开启事务
- service 不直接开启事务
- repository 构造时绑定当前 `PrismaClient / TransactionClient`
- 同一个 facade 写操作中的所有 service / repository 必须共享同一个事务执行器

### 3. 关键规则归属

- public DTO 到内部 command 的 ID 解析：归 `PlotInputParser`
- `ensureStory`：归 `StoryService`
- 作用域校验、唯一性校验：归 `PlotScopeGuard`
- refs 解析与规范化写入：归 `RefResolverService`
- `Scene.effectiveRefs = thread.refs + scene.refs` 的拼装：归 `PlotDtoAssembler`
- `delete/move/reorder` 后的排序压缩：归 `OrderService`

### 4. 目录建议

推荐目录：

```text
server/plot/
  assemblers/
  contracts/
  core/
  facade/
  http/
  repositories/
  services/
```

核心原则：

- 不再往 `server/utils/plot-system.ts` 回填功能
- 剧情模块后续扩展统一进入 `server/plot/`
- 单个文件只承载单一职责，不再允许一个文件同时承担 DTO、Prisma、事务、排序、HTTP helper

---

## 十、最小可用版本建议

如果要先做最小可用版本，建议只先实现以下字段：

### 1. `StoryThread`

```yaml
id
storyId
storyPhaseId
sortOrder
title
isMainThread
tags
status
summary
writingTip
```

### 2. `StoryScene`

```yaml
id
storyId
threadId
chapterId
threadSortOrder
chapterSortOrder
title
status
summary
purpose
writingTip
```

### 3. `StoryPlot`

```yaml
id
sceneId
sortOrder
kind
summary
effect
writingTip
```

### 4. `StorySceneRef`

```yaml
id
sceneId
sortOrder
relation
rawTarget
targetKind
targetThreadId
targetSceneId
targetPlotId
visibility
note
```

原因：

- `Thread`、`Scene`、`Plot` 是真正高频操作的核心
- 第二版的高阶能力建立在 `refs` 之上
- `Story`、`StoryPhase` 仍然可以保持轻量

---

## 十一、后续扩展方向

后续如果确实有需求，可以再补以下能力：

- ref 反向索引与“谁引用了我”查询
- 伏笔卡片 / 回收状态面板
- `SceneOutcome` / `SceneStateChange`：更细的状态变更结构
- `PlotConstraint`：条件触发或限制条件
- 基于 `refs` 的写作检查器
- 基于 `pending` 的缺失设定补全流程

但这些都不应阻塞 v1 先落地核心表结构。

---

## 十二、作者工作流建议

这一节用于回答一个更实际的问题：

- 作者如何从一个模糊灵感开始，逐步落到 `Thread / Scene / Plot`
- 剧情模块在创作流程中应该如何被使用

该工作流不是强制规则，但建议作为后续前端和 Agent 工作流设计的默认模型。

### 1. 从驱动点开始，而不是从数据库字段开始

作者构思一段剧情时，通常先有的是驱动点，而不是完整结构。

常见驱动点包括：

- 爽点 / `Reward`
- 冲突 / `Conflict`
- 反转 / `Twist`
- 悬念 / `Mystery`
- 某个具体灵感画面、关系变化、设定兑现

因此建议创作流程的起点是：

```text
驱动点 / 灵感
    -> Thread
        -> Scene
            -> Plot
```

而不是反过来从表结构倒推内容。

---

### 2. `Thread` 负责承载“这条线要讲什么”

当作者已经确定一条剧情线时，应优先创建 `Thread`，并补齐：

- `title`
- `summary`
- `isMainThread`
- `tags`
- `writingTip`
- 必要的 `refs`

这一层主要回答：

- 这条线在讲什么
- 它是否是主线
- 它依赖哪些设定、角色、物品、地点
- 它的长期写作策略是什么

也就是说：

- `Thread` 负责“长期因果线”
- `Scene` 负责“这一场具体怎么发生”

---

### 3. `Scene` 是作者日常工作的核心单位

作者在日常编排和写作时，应主要围绕 `Scene` 工作。

创建一个 `Scene` 时，至少应明确：

- 它属于哪条 `Thread`
- 它是否已经挂入某个 `Chapter`
- 这一场的 `summary`
- 这一场的 `purpose`
- 必要的局部 `refs`

建议用 `purpose` 回答以下问题之一：

- 这一场推进了什么冲突
- 这一场埋下了什么伏笔
- 这一场回收了什么铺垫
- 这一场满足了什么爽点
- 这一场新增了什么悬念

如果这些问题答不出来，通常说明当前 Scene 还不够清楚。

---

### 4. `Plot` 用于拆开一场内部的节奏

当一个 `Scene` 已经确定，但内部节奏仍然混乱时，再继续拆 `Plot`。

建议一个 `Plot` 只回答一个很小的问题，例如：

- 一个动作
- 一次冲突升级
- 一次信息揭示
- 一次反转
- 一次爽点兑现
- 一个结果

因此 `Plot.kind` 的意义不是“分类好看”，而是帮助作者和 Agent 理解：

- 这一场的节奏是怎么推进的
- 哪一段在负责铺垫
- 哪一段在负责兑现

---

### 5. 推荐创作顺序

建议默认采用以下顺序：

1. 先记录灵感 / 驱动点
2. 再决定它属于哪条 `Thread`
3. 再拆成一个或多个 `Scene`
4. 最后只在必要时把 `Scene` 拆成 `Plot`

反过来说：

- 不建议一开始就细拆 `Plot`
- 不建议先写大量 `StoryPhase`
- 不建议把 `StoryPhase` 当成剧情主结构

`StoryPhase` 更适合用于整理，而不是驱动创作。

---

### 6. `refs` 在工作流里的定位

在工作流中，`refs` 不是补充装饰，而是上下文约束。

建议：

- `Thread.refs` 记录稳定背景、长期依赖、常驻设定
- `Scene.refs` 记录该场独有的局部约束、伏笔、铺垫、回收

这意味着：

- 先有剧情对象
- 再补它依赖什么 / 铺垫什么 / 指向什么

而不是把所有信息都堆进 `summary` 和 `note`。

---

## 十三、Agent 上下文装配建议

这一节用于约束后续 Writer / Planner / Critic 等 Agent 如何消费剧情模块。

### 1. `Scene` 是 Agent 的最小稳定工作单元

对于写作相关 Agent，默认不应直接以整章作为唯一上下文单元。

更合理的最小工作单元是：

- 当前 `Scene`

原因：

- 章往往太大，信息噪声高
- `Scene` 同时连接剧情结构和正文结构
- `Scene` 更适合规划、生成、审阅

---

### 2. Writer 处理某个 `Scene` 时的最小上下文

当 Agent 写某一个 `Scene` 时，至少应加载：

1. 当前 `Scene`
2. 当前 `Scene.plots`
3. 当前 `Scene.refs`
4. 当前 `Scene.effectiveRefs`
5. 当前 `Scene` 所属 `Thread` 的基础信息

其中：

- `effectiveRefs = thread.refs + scene.refs`
- 顺序固定为：先 `Thread refs`，后 `Scene refs`
- 当前版本不去重

这是当前版本最小且稳定的上下文规则。

---

### 3. 章节上下文属于补充，不是替代

如果当前 `Scene` 已挂入 `Chapter`，则可补充加载：

- 当前 `Chapter` 的前一个 `Scene`
- 当前 `Chapter` 的后一个 `Scene`
- 当前 `Chapter` 的摘要信息

这部分上下文的作用是：

- 保持正文衔接
- 减少场与场之间的断裂感

但它不能替代剧情上下文本身。

也就是说：

- `Chapter` 邻近上下文` = `正文连续性上下文
- `Thread / Scene / refs` 上下文` = `剧情逻辑上下文

---

### 4. Thread 级信息适合 Planner，不适合直接替代 Scene

对于 Planner 类 Agent，可以提高到 `Thread` 视角工作，例如：

- 梳理这条线还缺哪些 Scene
- 判断某个伏笔是否已经有回收位点
- 判断某条线是否中断太久

但即使如此，真正落到写作时，仍建议回到 `Scene` 粒度。

因此：

- `Thread` 更适合规划
- `Scene` 更适合执行
- `Plot` 更适合细化节奏

---

### 5. Critic 的默认检查维度

后续如果接入 Critic / Reviewer 类 Agent，建议默认检查：

- 当前 `Scene.summary` 与正文是否一致
- 当前 `Scene.purpose` 是否实现
- 当前 `Plot.kind` 节奏是否合理
- 当前 `refs` 涉及的设定是否在正文中被误写
- 当前 `foreshadows / setup_for / payoff_of` 是否前后矛盾

也就是说，剧情模块不只是生成输入，还应该成为检查输入。

---

### 6. 当前版本先不做的 Agent 能力

以下能力不应阻塞当前版本：

- 自动根据 refs 推导完整剧情网
- 自动生成整书级剧情大纲
- 自动判断所有伏笔是否闭环
- 自动改写数据库结构以适配某个 Agent

当前版本只应先稳定：

- `Scene` 级上下文装配
- `effectiveRefs` 继承规则
- `Thread / Scene / Plot` 的基础读写与消费

---

## 十四、树图原型层说明

剧情树图当前处于快速迭代原型阶段。

这一层的目标是：

- 验证多线剧情可视化交互
- 验证 `Thread / Scene` 的画布编辑体验
- 验证主线、支线、游离灵感节点的操作模型

### 1. 原型层可以暂时突破正式 schema

正式剧情 schema 当前仍然采用：

```text
Thread 1 -> N Scene
Scene 只属于一个 Thread
```

但在树图原型层，允许存在：

```text
Scene.threadId = null
```

含义是：

- 这是一个尚未归组的游离 Scene
- 它只存在于前端树图 draft graph 中
- 目的是支持先摆灵感节点、后归组到 Thread

注意：

- 这不代表后端正式模型已经放开该约束
- 如果后续决定让后端也支持游离 Scene，需要单独修订数据库与 API 规范

### 2. 树图原型的编辑真相源

树图原型不再使用“自动布局结果 + 拖拽偏移”的模式。

当前前端 draft graph 直接记录：

- `Thread.position`
- `Scene.position`
- `Scene.sourceId`
- `Scene.threadId`

其中：

- 归属 Thread 的 Scene 使用组内局部坐标
- 游离 Scene 使用画布绝对坐标
- `sourceId = null` 表示当前 Scene 没有连线来源
- `sourceId = plot-root-start` 表示当前 Scene 直接从根节点起步

因此：

- 拖拽后只更新被拖节点
- 连线、新增、删除时再做结构性同步
- 不再把拖拽结果交给整图重建器回算

### 3. 原型层的连线与删除限制

当前原型只允许：

- `root -> scene`
- `scene -> scene`

并限制：

- 游离 Scene 可以没有任何连线
- `Thread` 内 `Scene` 必须保持单链
- 跨 `Thread` 连线只能接到目标 `Thread` 的入口 `Scene`
- 不允许形成循环
- 同一父节点下最多只有一个主线子节点
- 删除 Scene 前必须先处理其子节点
- 删除 Thread 前必须保证其为空

这些限制不是为了保守，而是为了避免在原型阶段把交互复杂度提前拉高。

### 4. 原型层的布局触发规则

当前自动布局只是前端原型工具，不是正式剧情排序语义。

规则固定为：

- 只允许通过 toolbar 手动触发自动布局
- 新增、连线、删除、拖拽之后不自动重排
- 自动布局只改 `position`
- 自动布局不改 `threadId`、`sourceId`、主支标记或其他剧情字段

### 5. 原型层的编辑入口约束

当前树图原型把编辑入口拆成两层：

- 全局 toolbar：`新建 Thread`、`新建游离 Scene`、`自动布局`、`Fit View`
- 节点快捷操作：`Thread` 新增 Scene / 删除空 Thread，`Scene` 新增子节点 / 主支切换 / 脱离 Thread / 删除

这样做是为了把“全局图操作”和“节点局部操作”明确分开，避免前端树图组件再次演变成一个塞满所有入口的大型单文件实现。

### 6. 时间轴原型层说明

除树图外，前端还允许存在一种“正文顺序时间轴”原型视角。

当前规则固定为：

- 它是独立 preview，不是正式剧情编辑器
- 一次只看一个 `StoryPhase`
- 横轴按正文顺序排列
- 每条泳道代表一条 `Thread`
- 同一横向槽位允许不同 `Thread` 并行放置 `Scene`
- `Chapter` 通过背景分段表达
- 未挂章 `Scene` 统一进入末尾草稿尾区
- 首版不做拖拽，不直接修改 `chapterSortOrder` 或 `threadId`

它的主要用途不是编辑因果结构，而是帮助作者把多条剧情线编排成正文展示顺序。

---

## 十五、一句话总结

> `Story` 是整书级剧情作用域  
> `StoryPhase` 是轻量分组层  
> `Novel / Volume / Chapter` 更接近读者视角  
> `Story / StoryPhase / StoryThread / StoryScene / StoryPlot` 更接近作者视角  
> `Thread` 是因果逻辑线  
> `Scene` 是剧情与正文之间的桥梁  
> `Plot` 是 Scene 内的最小动作单位  
> `refs` 是第二版的基础能力  
> 数据库表达力应主要集中在 `StoryThread`、`StoryScene`、`StoryPlot` 及其 `Ref` 表
