# Plot System

Plot System 是 Project Workspace 内的作者视角剧情结构系统。它保存未来规划、因果线、场景安排、章级写作指令、伏笔和写作提示；不保存正文，也不替代 lorebook 或 World Engine。

Plot 组织为**两棵树**：

- **承载树(结构)**:`Story → StoryAct(卷) → StoryChapter(章) → Prose(正文)`。表达「这本书由哪些卷、哪些章组成,每章怎么写」。
- **因果树(剧情)**:`Story → StoryPhase(阶段) → StoryThread(线) → StoryScene(场)`。表达「有哪些剧情线,每条线由哪些场推进」。

两棵树在 **Scene 挂章**处交汇:每个 `StoryScene` 通过 `chapterId` 外键挂到一个 `StoryChapter`,决定它在正文里的呈现位置。事实推进、状态变化和时间线真相由 World Engine slice / patch 表达,Plot System 只保存作者视角的结构、目的、写作提示、章级指令和与 World Engine 的连接点。

两棵树之上另有**规划层**(Promise / Decision):`StoryPromise` 是对读者的债务账本(含伏笔),`StoryDecision` 是 ADR 式决策记录。两者按 Story 平铺、不进树结构;Promise 经 beat 挂 Scene 连到两棵树,Decision 经 anchor 锚到任意剧情对象或内容节点。详见下文 Promise / Decision 两节。

Chapter 与 manuscript 文件**切割**:章是 Plot 实体,正文(Prose)是 manuscript 内容节点,通过 Prose 的 frontmatter `chapter: <StoryChapter.name>` 反指所属章。文件移动/改名不影响章;一个章可关联多份 Prose(通常一份,草稿/重写版可共存)。章节顺序权威在 `StoryAct.sortOrder` / `StoryChapter.sortOrder`,manuscript 目录名前缀退化为装饰。

## Storage

Plot 数据保存在当前 Project Workspace 的 Project SQLite：

```text
workspace/{project}/.nbook/project.sqlite
```

App SQLite 不保存 Story / Plot 数据；Plot 工具必须以 `projectPath` 定位 Project Workspace。

## Core Objects

| Object | Meaning |
| --- | --- |
| `Story` | 单个 Project Workspace 的剧情根作用域。 |
| `StoryAct` | 承载树:卷。对应 manuscript volume 层,但与文件系统切割。 |
| `StoryChapter` | 承载树:章一等实体。带 ChapterBrief 字段组(章级写作指令);Prose 通过 frontmatter 反指。 |
| `StoryPhase` | 因果树:剧情阶段分组，用于整理 Thread。 |
| `StoryThread` | 因果树:一条长期剧情线、冲突线或成长线。伏笔不再当 Thread 建,归 Promise。 |
| `StoryScene` | 因果树最小单位;一场戏或连续叙事单元。经 `chapterId` 挂章,是两棵树的交汇点,也是 Plot 与 World Engine 的桥梁。 |
| `StorySceneRef` | Scene 到内容节点或剧情对象的结构化关系。 |
| `StoryPromise` | 规划层:对读者的债务账本(含伏笔)。不设 kind 分类,形态由字段有无驱动;存储态仅 open/fulfilled/abandoned,中间态从 beats 派生。详见 Promise 一节。 |
| `StoryPromiseBeat` | Promise 在某场戏上的推进记录(kind: plant/advance/setback/payoff),挂 Scene,同场同线仅一条;计划/事实/不参与三态由所在 Scene.status 派生。 |
| `StoryDecision` | 规划层:ADR 式决策记录。open 态防 writer 写死,decided 态必填 risk(刹车点)供审查与接手;经 anchor 锚到剧情对象或内容节点。详见 Decision 一节。 |

**ChapterBrief**(`StoryChapter` 上的 `brief*` 字段组)是章级 writer 指令:章节目标/落点、POV、语气、节奏、信息控制(读者已知/主角已知/必须隐藏/可暗示)、开场钩子、禁写事项。全部可选、自由文本为主(防限死创造力);不保存动态世界状态(那是 World Engine),不替代 Scene 剧情点。它是 writer brief 里「信息控制」等段的来源,详见 [writer-brief.md](writer-brief.md)。

## DTO Fields

当前公开 DTO 的核心字段：

| DTO | Important Fields |
| --- | --- |
| `Story` | `id`、`title`、`summary`、`note`、`createdAt`、`updatedAt` |
| `StoryAct` | `id`、`storyId`、`sortOrder`、`name`、`title`、`summary`、`note` |
| `StoryChapter` | `id`、`storyId`、`actId`、`sortOrder`、`name`、`title`、`note`、`brief`(ChapterBrief 对象) |
| `ChapterBrief` | `goal`、`pov`、`tone`、`pacing`、`readerKnows`、`protagonistKnows`、`mustHide`、`hintOnly`、`opening`、`ending`、`doNotWrite`(全部 nullable) |
| `StoryPhase` | `id`、`storyId`、`sortOrder`、`name`、`title`、`summary`、`note` |
| `StoryThreadSummary` | `id`、`storyId`、`storyPhaseId`、`sortOrder`、`name`、`title`、`isMainThread`、`status`、`miceType`、`summary`、`tags`、`writingTip`、`note` |
| `StorySceneSummary` | `id`、`storyId`、`threadId`、`chapterId`、`chapter`(轻量摘要)、`threadSortOrder`、`chapterSortOrder`、`title`、`status`、`outcomeType`、`pacingRole`、`summary`、`purpose`、`writingTip`、`note`、`worldAnchor` |
| `StorySceneDetail` | Scene summary fields + `refs`、`effectiveRefs`、`promiseBeats`(本场服务哪些 Promise) |
| `StoryPromise` | `id`、`storyId`、`name`、`title`、`status`、`derivedStage`(派生)、`importance`、`summary`、`payoffExpectation`、`cadenceChapters`、`deadlineChapterId`、`deadlineChapter`(轻量摘要)、`tags`、`beatStats`(有效 beats 按 kind 计数 + planned/factual/archived 三态计数) |
| `StoryPromiseDetail` | Promise fields + `beats` |
| `StoryPromiseBeat` | `id`、`promiseId`、`sceneId`、`kind`、`note`、`state`(派生)、`scene`(所在场轻量摘要,含章位) |
| `StoryDecision` | `id`、`storyId`、`name`、`title`、`status`、`question`、`options`、`deadlineChapterId`、`deadlineChapter`(轻量摘要)、`decision`、`motivation`、`rejectedAlternatives`、`risk`、`serves` / `dependsOn`(读取视图 `{target, valid}`,死引用标 `valid=false`)、`supersededById`、`anchorKind`、`anchorTargetId`、`anchorPath`、`note` |
| `SceneWorldContext` | `slices`、`subjectStates`、`unresolvedSubjectIds` |
| `ChapterPlotDetail` | `chapter`、`scenes`、`totalScenes` |
| `PlotTree` | `story`、`phases`(因果树)、`ungroupedThreads`、`acts`(承载树)、`ungroupedChapters`、各 total 计数、`openPromiseCount` / `openDecisionCount`(规划层入口提示) |

Status values：

```text
StoryThread.status     = active | draft | paused | done | archived
StoryThread.miceType   = milieu | idea | character | event                     (nullable;提示这条线怎样才算关)
StoryScene.status      = draft | active | written | revised | archived
StoryScene.outcomeType = yes_but | no_and | yes_and | no_but | yes | no | no_conflict | passive (nullable;null 仅=未填写)
StoryScene.pacingRole  = setup | escalation | breather | climax | resolution   (nullable)
StoryPromise.status    = open | fulfilled | abandoned          (中间态 unplanted/planted/echoed/paid_off 从 beats 派生)
StoryPromiseBeat.kind  = plant | advance | setback | payoff    (state 三态 planned/factual/archived 由所在 Scene.status 派生)
StoryDecision.status   = open | decided | superseded | dropped (dropped=问题因剧情改道失效,失效原因写 note)
```

## Thread

Thread 表达一条因果线，不等于章节。

常见字段：

- `title`
- `summary`
- `isMainThread`
- `status`
- `miceType`(MICE 线型 milieu/idea/character/event;提示这条线怎样才算关——idea=谜底揭晓,character=自我认知达成)
- `tags`
- `writingTip`
- `refs`
- `sortOrder`
- `phaseId`

Thread refs 表达长期依赖、常驻设定和冲突对象。

## Scene

Scene 是一场戏或一个连续叙事单元，也是 Plot System 与 World Engine 的连接点。

常见字段：

- `title`
- `summary`
- `purpose`
- `status`
- `outcomeType`(本场主要行动者主动尝试的结果;null 仅=未填写,非冲突场显式填 no_conflict,被动承受场填 passive)
- `pacingRole`(张弛角色;节奏检查按承载树章序投影消费,不按因果树)
- `threadSortOrder`
- `chapterId`
- `chapterSortOrder`
- `writingTip`
- `worldAnchor`
- `refs`

`chapterId` 是 `StoryChapter` 外键(nullable),把 Scene 挂到承载树上的某个章；这是两棵树的交汇点。Scene 不再直接持有 manuscript 路径字符串——正文承载关系由 Chapter 与 Prose 的 frontmatter 反指表达(见下)，Scene 只认章实体。

`chapterId` 校验规则：

- 必须指向当前 Story 下真实存在的 `StoryChapter`。
- 可以为 `null`：Scene 先规划、稍后挂章。
- `onDelete: SetNull`——删除 Chapter 时挂在它上面的 Scene 退回未挂章状态，不级联删 Scene。

**Chapter ↔ Prose(frontmatter 反指)**:章不直接存正文路径；正文(manuscript content-node)在自己的 `index.md` frontmatter 写 `chapter: <StoryChapter.name>` 反指所属章。查询复用 `ProjectWorkspaceIndex`(watcher 重建的内存快照，节点已含解析好的 frontmatter)，`ChapterProseService` 过滤 `frontmatter.chapter === chapter.name` 解析 Chapter→Prose。文件移动/改名不影响章；一个章可关联多份 Prose(通常一份，草稿/重写版可共存)；指向不存在章名的 Prose 记为孤儿。

Scene 有两套排序：

- `threadSortOrder`：Scene 在线程内的因果顺序。
- `chapterSortOrder`：Scene 在同一章节内的正文呈现顺序；`chapterId = null` 时为 `null`。

## Scene World Anchor

`worldAnchor` 让 Scene 连接 World Engine：

| Field | Meaning |
| --- | --- |
| `startTime` / `endTime` | HTTP / 前端使用的项目日历字符串；`null` 表示尚未连接时间线。 |
| `startInstant` / `endInstant` | raw instant 的字符串形式，用于稳定排序、调试和避免 JSON BigInt 问题。 |
| `subjectIds` | 该 Scene 相关的所有 World Engine subjects，不区分 POV / active / mentioned。 |
| `locationSubjectId` | 可选的地点 subject。 |
| `subjects` | 读取 DTO 专用；将 `subjectIds` 解析为 `{id,name,type,resolved}`。 |
| `locationSubject` | 读取 DTO 专用；地点 subject 的解析结果，未设置地点时为 `null`。 |
| `unresolvedSubjectIds` | 读取 DTO 专用；所有尚未接入 World Engine 的占位 subject ID。 |

服务层使用 World Engine 的 `Instant = bigint`，持久化使用 Prisma `BigInt`。HTTP / 前端不直接传 BigInt。

读取解析规则：

- Plot 聚合读取通过 `SceneWorldAnchorResolutionService` 解析 `subjects/locationSubject/unresolvedSubjectIds`，使用 World Engine 的 subject identity 表，不加载 schema/calendar。
- 如果 Project 尚未创建 `world-engine/calendar.ts`，Plot 读取仍应成功：保留 `startInstant/endInstant`，`startTime/endTime` 降级为 `null`，subject 按已登记身份解析，未登记 subject 继续显示 `resolved=false`。
- 如果 `calendar.ts` 存在但加载失败，且读取需要格式化 `startInstant/endInstant`，错误必须继续抛出；不得把损坏配置伪装成未初始化 Project。

校验规则：

- `startInstant` / `endInstant` 可以为 `null`，表示 Scene 先规划、稍后连接 World Engine。
- 当两者都存在时，`startInstant <= endInstant`。
- `subjectIds` 必须去重，不能包含空字符串。
- `locationSubjectId` 可以为空；若填写，允许先作为占位 subject ID 存在，但读取 DTO、UI 和 Agent 工具必须通过 `resolved=false` / `unresolvedSubjectIds` 显式暴露，不得静默写入幽灵锚点。

Scene World Context 通过服务端 API 查询：

```text
GET /api/projects/plot/scenes/:sceneId/world-context
```

查询策略：

- 使用 Scene 的闭区间 `[startInstant, endInstant]` 查询相关 slices。
- 查询前先解析 `subjectIds` 和 `locationSubjectId`；只用已存在的 World Engine subjects 查询 slices 和 subject states。
- subject 身份解析使用 calendar-free 读取，因此占位判断不依赖 `world-engine/calendar.ts`。
- 只返回涉及已解析 subjects 的 patches / slices 摘要。
- 查询已解析 subjects 在 `endInstant` 时刻的状态，用于 Inspector 上下文预览。
- 若部分 subject 尚未接入 World Engine，返回已解析上下文和 `unresolvedSubjectIds`。
- 若全部 subject 都是占位，返回空 `slices` / `subjectStates` 和 `unresolvedSubjectIds`，不报错。
- 未连接时间范围的 Scene 仍可正常编辑，但无法查询 World Engine 上下文。
- `SceneWorldContext` 是实际 World Engine 查询能力；当需要真实 slices、state reduce 或时间格式化而 Project 缺少/损坏 calendar 配置时，可以返回配置错误。

前端打开完整 World Engine Workbench 不通过 `SceneWorldContext` DTO 返回路径字段；Plot Workbench 通过显式 UI 事件关闭当前剧情工作台并打开真实 World Engine Workbench。

## Promise

Promise 是规划层的读者债务账本:向读者许了什么愿(感情线发糖、伏笔揭露、人物弧里程碑),之后必须兑现。伏笔划入 Promise,不单独建系统——「太久没发糖」和「伏笔悬置太久」是同一类检查。Thread 与 Promise 正交:推动事件因果的是 Thread(回答「接下来发生什么」),约束读者体验的是 Promise(回答「我欠读者什么」);Scene 是交点,因果上属于一个 Thread,可同时服务多个 Promise。区分口诀与写法密度见 [agent-spec.md](agent-spec.md)。

Promise **不设 kind 分类,形态由字段有无驱动**:有 `deadlineChapterId` 才有逾期概念,有 `cadenceChapters` 才有节奏提示,两者可同时存在;`cadenceChapters` 是提示性参考节奏,不是硬约束。分类语义由 `tags` 承担,伏笔按兑现机制用四个推荐词(词表非枚举,可自由扩展):

- `setup_payoff`:契诃夫之枪。具体元素、因果性回收、单点触发,公平性要求最严格(必有 plant)。
- `prophecy`:预言/悬念。明确断言,字面式或反讽式兑现,兑现方式写进 `payoffExpectation`。
- `motif`:象征/母题。意象重复、累积式兑现,不要求单点触发;典型形态=无 deadline、有 cadence、advance 累积。
- `mirror`:镜像/平行。两条以上线索互相映照;beats 挂 Scene 而 Scene 分属不同 Thread,关联由 beats 分布天然表达,不需要新结构。

自由文本三层分工,消费点互斥:

- `summary` = 向读者许了什么(账本列表与规划上下文展示用)。
- `payoffExpectation` = 兑现时预期的戏剧效果(只给兑现场的 writer,让它知道这条线「图什么」)。
- beat 的 `note` = 单次推进的具体指示(只给该场的 writer,如「本次只写到发烫,不许发光」);强度阶梯天然分布在各 beat 的 note 上,不设线级计划字段。

### PromiseBeat

PromiseBeat 是 Promise 在某场戏上的推进记录,挂 Scene 不挂 Chapter:埋/呼/收都发生在具体一场戏里,粒度比章细,自动继承 Scene 的 World Engine 时间锚。同一 Scene 对同一 Promise 只有一条 beat,重复 set 覆盖 kind/note。

- `kind`:`plant`(建立)/ `advance`(推进、呼应、投喂)/ `setback`(反挫,含伏笔的假揭露)/ `payoff`(兑现)。
- `state`(派生只读):beat 不设计划/事实存储字段,三态由所在 `Scene.status` 派生——draft/active=`planned`(计划),written/revised=`factual`(事实),archived=`archived`(不参与派生,记录保留)。

状态与派生规则:

- Promise 存储态仅 `open / fulfilled / abandoned`(作者意图);`derivedStage` 从有效 beats(所在 Scene 非 archived)派生,结构上不可能漂移:有 payoff=`paid_off`,否则有 advance/setback=`echoed`,否则有 plant=`planted`,否则 `unplanted`。
- 打 payoff beat 时服务层默认自动置 `fulfilled`;`autoFulfill: false` 可关,用于里程碑式兑现后线仍延续的场合(感情线「在一起」之后还有后续)。
- 归档/删除 Scene、删除 Thread 或移除 beat 后,若不再存在任何有效 payoff beat,`fulfilled` 自动回退 `open`;多里程碑(多个 payoff beat)删其一不回退,且只回退 fulfilled,不动 abandoned。
- 计划 beats 经 writer brief 的「本章 Promise 任务」段送达 writer(见 [writer-brief.md](writer-brief.md);archived 场与 abandoned 线不下发)。系统默认 writer 完美执行 brief——Scene 标 written/revised 后计划即视为事实,写后核对交后续 critic。

## Decision

Decision 是规划层的 ADR 式决策记录:把「为什么这里要这么安排」从思维链持久化,防止下个会话的 Agent 擅自写死未决问题,或重新纠结已拍板的问题。何时记的启发式:**如果这个决策的理由不写下来,换一个 Agent 接手时大概率做出不同或更差的选择,就必须记。**

生命周期 `open → decided → superseded / dropped`。状态不变式由服务层对合并后的最终态校验,HTTP 直改 status 与工具 action 同受约束,无绕过面:

- **open**:`question`(待决问题,创建必填)+ `options`(候选方案)+ `deadlineChapterId?`(必须在此章前拍板)。open 态本身就是给 writer 的警告——不得擅自写死。
- **decided**:`decision` + `motivation` + `risk` 三者必填。risk 是 writer 的刹车点:没有 risk 的决策只告诉 Agent 往哪走,没告诉哪停。decide 转换把 options 未选项自动转 `rejectedAlternatives` 骨架(`whyRejected` 事后补):`chosenOption` 指名被选项则排除之,不传=结论是全新方案、全部候选转骨架;显式传 `rejectedAlternatives` 则整体替换、跳过骨架生成(与 `chosenOption` 互斥)。
- **superseded**:被新决策取代,`supersededById` 必填且不得自指。
- **dropped**:问题因剧情改道失效——既没拍板也没被取代;失效原因必须写 `note`。

挂靠与引用:

- 主锚点 `anchorKind`(story/act/chapter/thread/scene/promise/content):story 不带载体(锚在全书层),content 用 `anchorPath` 存内容节点路径(如 `lorebook/character/chen-yao/`),其余 kind 带对应实体 id。写入用嵌套 `anchor: {kind, id?, path?}` 整体替换,防 kind 与载体错配;读取时归一化——载体被删(外键 SetNull)后视同 story,不回写数据库。
- `serves` / `dependsOn` 存轻量引用:`promise://{id}` / `decision://{id}` / `thread://{id}` / `scene://{id}` 或 Project Workspace 相对内容节点路径。写入时校验格式与同 story 存在性;读取时死引用(目标已删,JSON 引用无 SetNull 保护)容错标注 `valid=false`,不做级联清理。
- `deadlineChapterId` 无外键保护:id 非空而 `deadlineChapter` 摘要为空,表示期限章已被删除。

## Refs

Plot refs 用结构化关系连接剧情对象和内容节点。

推荐使用：

- `lorebook/.../`：角色、地点、物品、势力、机制等内容节点。
- `manuscript/.../`：章节或正文承载。
- `thread://{id}`、`scene://{id}`：剧情内部对象。

内容节点路径应优先使用 Project Workspace 相对路径，不要恢复旧 `lorebook://` 心智。

`refs` 当前只存在于 Scene 层；`effectiveRefs` 是 Scene 自身有效结构化引用的规整视图(去重、解析 gloss)，**当前实现不合并所属 Thread 的 refs**——Thread 级 refs 泛化是后置项，文档不承诺。`visibility` 只表达 author / reader 侧的参考可见性，不是 lorebook information-control 授权系统。

推荐关系标签：

- `defines`
- `constrains`
- `depends_on`
- `part_of`
- `contains`
- `conflicts_with`
- `derived_from`

伏笔的埋设/回收不再用 refs 表达（D9 已删 `foreshadows` / `pays_off` 推荐标签）：该职责由规划层 PromiseBeat 结构化承载——用 `save_promise_beat`（kind: plant/advance/setback/payoff）在 Scene 上登记，refs 退回纯引用职责。存量 `foreshadows` / `pays_off` 数据不迁移（快速开发期）。

不要把所有出场角色、地点和普通提及都塞进 structured refs；普通自然提及优先使用正文、summary 或 `worldAnchor.subjectIds/locationSubjectId`。

## Agent Tools

读取：

- `get_story_tree`（输出两棵树：`acts`/`ungroupedChapters` + `phases`/`ungroupedThreads`，附规划层摘要 `openPromiseCount`/`openDecisionCount`）
- `get_story_thread`
- `get_story_scene_context`（Scene 详情含 `promiseBeats`：这场戏服务哪些读者债务线）
- `get_story_chapter`（入参 `chapterId`；chapter 详情含 ChapterBrief + 挂章 scenes）
- `get_scene_world_context`
- `get_chapter_writer_brief`（入参 `chapterId` + `mode`，`mode` 默认 `autonomous`）
- `get_story_promise`（`promiseId` 可选；无 id = 摘要列表，open 优先、importance 高优先，含派生阶段与 beat 计数；有 id = 详情含 beats 及各 beat 所在场/章位）
- `get_story_decision`（`decisionId` 可选；无 id = 列表，open 优先，含死引用标注；规划前必查，防止重议已拍板问题或擅自写死 open 决策）

写入（`action` 必填枚举显式声明意图；执行层按 action 校验必填字段）：

- `save_story_act`（action: `create` / `update`）
- `save_story_chapter`（action: `create` / `update`；含 ChapterBrief 字段组）
- `save_story_thread`（action: `create` / `update` / `archive`）
- `save_story_scene`（action: `create` / `update` / `archive`；Scene patch 用 `chapterId` 挂章）
- `save_story_promise`（action: `create` / `update` / `abandon` / `fulfill`；重开用 update + status=open）
- `save_promise_beat`（action: `set` / `remove`；同场同线仅一条；kind=payoff 默认自动置 fulfilled，`autoFulfill: false` 可关）
- `save_story_decision`（action: `create` / `update` / `decide` / `drop`；create 需 name + title + question 且拒收 decided 态字段；decide 强制 decision + motivation + risk（刹车点）并把 options 未选项转 rejectedAlternatives 骨架，`chosenOption` 可指名被选项；drop 需在 note 写失效原因；取代走 update + status=superseded + supersededById）

使用规则：

- 需要 `projectPath` 时传 `workspace/{project}`。
- 章级查询用 `chapterId`（不再传 manuscript 路径字符串）；正文承载由 Prose frontmatter 反指，不经 Scene。
- `get_story_thread` / `get_story_scene_context` / `get_scene_world_context` 可以在未传 id 时使用 session 的 `plot.selection` 焦点；`save_story_thread` / `save_story_scene` 的 update/archive 目标与 `save_promise_beat` 的 `sceneId` 缺省时同样取 `plot.selection`。
- 创建或更新 Thread / Scene 会刷新 `plot.selection`。
- Writer 写章节前，Leader 应优先用 `get_chapter_writer_brief` 编译 Chapter Writer Brief。若 status 不是 `ready`，再用 `get_story_chapter` / `get_story_scene_context` / `get_scene_world_context` 和 save_* 工具补 Plot、ChapterBrief、World Anchor 或 World Context 后重新编译。
- Plot refs 帮助检索上下文，但不自动授权 writer 读取隐藏 lorebook 或 subject 私密 knowledge。

Thread / Scene 的 agent-facing 写法、摘要密度和 World Engine 连接规则见 [agent-spec.md](agent-spec.md)。

After plot edits, check continuity: character motivation, causal chain, reader information and protagonist information should not be accidentally mixed.

## Agent Consumption

Agent 写作或规划时按这个顺序读 Plot：

1. 调用 writer 前，用 `get_chapter_writer_brief`(传 `chapterId` + `mode`)编译目标章节的 writer brief。brief 已含「本章 Promise 任务」段与未决决策警告段，不需要为 writer 另行摘抄账本。
2. 如果 brief status 不是 `ready`，用 `get_story_chapter`(传 `chapterId`)获取目标章节承载的 scenes。
3. 如果需要更完整的线索，用 `get_story_scene_context` 读取 scene、parent thread 和同章 scene view。
4. 如果目标 Scene 已连接 World Engine，用 `get_scene_world_context` 读取相关 slices 和 subject states。
5. 如果要调整长期因果线，用 `get_story_thread` 或 `get_story_tree`。
6. 规划或复盘时，用 `get_story_promise` 盘点读者债务(哪些线该推进、该兑现，避免建重复线)，用 `get_story_decision` 查未决与已拍板决策——防止重议已拍板问题，也防止擅自写死 open 问题；规划某场戏时用 `save_promise_beat` 登记这场推进哪些线。
7. 修改后用对应 save_* 工具（`action` 显式声明意图：create/update/archive/abandon/fulfill/set/remove/decide/drop），不要直接用 SQL 绕过业务校验，除非用户明确要求数据库级维护。

`execute_sql` 可查看 Project SQLite，但它是低层工具；普通剧情编辑优先用 Plot tools。

## Boundary

Plot System 适合：

- 未来规划。
- 章节承载关系。
- 多线剧情。
- 伏笔埋设 / 回收与对读者的承诺(Promise + PromiseBeat)。
- 规划决策与理由链(Decision)。
- scene purpose 和 writing tips。
- 作者视角的信息差。
- Scene 到 World Engine 时间、地点和 subjects 的连接。

不适合：

- 正文 prose。
- 稳定世界 canon。
- subject 主观知识。
- entity 当前状态。
- 临时 run scratch。

稳定事实落定后，可以由作者或 Agent 整理同步进 `lorebook/`。当前动态世界状态应进入 World Engine。
