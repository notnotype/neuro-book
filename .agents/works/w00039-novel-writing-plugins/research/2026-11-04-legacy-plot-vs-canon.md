# 旧应用剧情侧概念 vs nb-canon

路径缩写：`L/` = `packages/neuro-book-legacy/`；`R/` = `L/assets/reference/`；`T/` = `L/.agents/tasks/`；`S/` = `.worktree/w00039-t29-canon-kernel/docs/specs/canon/`。凡"推断"均为我的判断，未读到原文。

## 一、旧应用的剧情概念

规模：Plot 10 张表共 136 个标量字段，World 3 张表共 22 个；服务端 Plot 7308 行、WorldEngine 7252 行（不含测试）；前端两处 46 个 vue，连同相邻 ts 共 19305 行；Plot 15 个 Agent 工具，World 1 个（`execute_world`）。

| 概念 | 字段与生命周期 | 作者与 Agent 怎么用 | 出处 |
|---|---|---|---|
| 时间与切面 | `WorldSlice` 6 字段、`WorldPatch` 12 字段；`instant` 是 bigint 秒，全库唯一（一刻一个切面）；日历 `calendar.ts` 三种（gregorian、simple、custom）；slice 的 `kind`（event、init、backstory）只是标签。op 四种：replace、increment、remove、append | 某刻状态 = 取 instant ≤ at 的 patch 按 (instant, seq) 折叠；补过去 = 往更早 instant 插切面。Agent 在 CodeAct 里 `world.time.parse` 后读写；作者用 2227 行的 Workbench | `L/prisma/project.schema.prisma:388-419`；`L/server/world-engine/world-engine.service.ts:312-339,679-707`；`R/world-engine/calendar-system.md` |
| 实体经历 | 没有独立对象。模板 5 类主体各有一个 `events: EmbeddingText[]`（只增有序流）；另有 `memory` 开放字典 | 查某主体经历三条路：读 `events`、`world.slice.list({subjectIds})`、`world.search.text`（向量，可限 `attrs:["events"]`）。写入时状态 patch 和 `events` 文本要各写一次 | `L/assets/workspace/.nbook/templates/project-directory-templates/world-engine/schema/index.ts:73-138`；`L/server/world-engine/codeact-api.ts:140-192`；`R/world-engine/workflow.md:250-253` |
| 知情、秘密、信息控制 | 三处互不相连：(1) `StoryChapter` 上 4 个自由文本 `briefReaderKnows`、`briefProtagonistKnows`、`briefMustHide`、`briefHintOnly`；(2) `state.md` frontmatter 的 `knowledge[]` 自由文本；(3) 角色 `memory`。旧 RP 工作流的 `subjects/*/memory.jsonl`、`mind.md` 已归档 | brief 的"信息控制（必填）"段：作者或 leader 手填，程序不推导；四项全空则 status=`needs_chapter_brief`，阻断交接；writer 经 `get_chapter_writer_brief` 消费，另靠提示词"三层视角隔离"自觉遵守 | `L/prisma/project.schema.prisma:171-174`；`L/server/plot/services/chapter-writer-brief.service.ts:270-292,396-425`；`L/server/workspace-files/content-node-schema.ts:39`；`R/content/information-control.md:140-149`（"Deferred Schema"：谁知道什么尚未设计） |
| 伏笔 | `StoryPromise` 13 字段（存储态仅 open、fulfilled、abandoned；importance 三档；`deadlineChapterId`、`cadenceChapters`、`payoffExpectation`、`tags` 四词表 setup_payoff、prophecy、motif、mirror）。`StoryPromiseBeat` 7 字段，一场一线一条，kind=plant、advance、setback、payoff。阶段 unplanted、planted、echoed、paid_off 从 beat 派生；beat 的计划或事实由所在 Scene.status 派生；payoff 默认自动置 fulfilled，最后一个 payoff 消失则回退 | 规划时 `save_promise_beat` 登记；brief 的"本章 Promise 任务"段按 kind 下发固定指令加 `note`；工作台有账本 tab（616 行） | `L/prisma/project.schema.prisma:295-334`；`R/plot/system.md:180-209`；`L/server/plot/services/chapter-writer-brief.service.ts:170-200,483-515` |
| 计划与结构 | 承载树 Story→Act（卷，9 字段）→Chapter（20 字段）；因果树 Phase→Thread（15 字段）→Scene（20 字段，含 outcomeType 8 值、pacingRole 5 值、status 5 值）。Scene 有 `threadSortOrder` 与 `chapterSortOrder` 两套排序。`StoryDecision` 25 字段，open→decided→superseded 或 dropped，decided 必填 decision、motivation、risk | 章级 brief 共 11 个自由文本字段（目标、POV、语气、节奏、开场、结尾、禁写加上面 4 个）；决策用 `save_story_decision`，触及本章的 open 决策进 brief 的"未决决策警告" | `L/prisma/project.schema.prisma:137-376`；`T/87-plot-two-trees-and-writer-modes/README.md`；`T/93-plot-planning-layer/README.md` |
| 场景与世界的连接 | `StoryScene.startInstant`、`endInstant`、`subjectIdsJson`、`locationSubjectId`，全是字符串 id，无外键；未登记主体显式标 `resolved=false` | `get_scene_world_context` 取闭区间内相关切面加终点状态；缺时间或缺主体时 brief 状态降为 `needs_world_anchor`、`needs_world_context` | `L/prisma/project.schema.prisma:249-252`；`L/server/plot/services/scene-world-context.service.ts:23-95` |
| 动机、目标、内心、记忆 | 无专门结构。模板 `Character` 共 11 字段，没有 goal、motivation、mind；文档示例里的 `mind`、`relationships`、`knowledge` 模板里都没有（schema 宽松，可动态加） | 靠 Scene 的 `summary`（要求写目标、压力、隐藏条件）和 `memory` 文本 | `L/…/world-engine/schema/index.ts:79-104`；`R/world-engine/schema-system.md:192`；`R/plot/agent-spec.md:60-66` |

## 二、对照 nb-canon

| 旧概念 | nb-canon | 依据 |
|---|---|---|
| 任意时刻状态折叠 | 有，位置精度降为"章加排序键，另加前史" | `S/model.md` 输出 2、5 |
| 日历、故事时间 | 没有，明确不承诺（t04 搁置） | `S/model.md` 目标与非目标 |
| 补过去后相对操作断裂 | 有，且更好：整条套不上、不完整标记、核对点、根因合并 | `S/model.md` 输出 7、8、11、22 |
| 切面（一刻一批变更） | 有，剧情变更带多个补丁，原子 | `S/model.md` 输出 7 |
| 实体经历 | 部分：`changes` 可按涉及的条目筛，本章涉及条目可算；"情节"视图字段另行定义 | `S/project.md:55`；`S/model.md` 输出 20；`S/components.md:22` |
| 知情、秘密 | 没有（第二版，t06） | `S/model.md` 目标与非目标 |
| 章级信息控制、写作指示 | 没有对象；提案说挂在章上，Spec 的未决问题 `about` 不含章（推断：缺口） | 提案第八节"日常循环"；`S/model.md` 未决问题 |
| 伏笔 | 部分：剧情线条目加计划与兑现；无埋设、推进、受挫分类，无期限与节奏 | `S/model.md` 输出 13、18 |
| 计划、兑现 | 有，且强于旧版（拆分、被替代、取消，进展由实际结果算出） | `S/model.md` 输出 13 |
| 卷、阶段 | 没有（卷、章在宿主活页夹；阶段可用剧情线条目树近似，推断） | `S/model.md` 输入 |
| 场景与 worldAnchor | 没有场景；`involves` 加章位置部分替代 | `S/model.md` 剧情变更表 |
| StoryDecision | 部分：未决问题只有 open、answered、dropped 与 `hints`，没有候选、期限、理由、风险 | `S/model.md` 未决问题 |
| 动机、目标、内心、记忆 | 没有专门结构；语义档字段可作载体（推断） | `S/model.md` 输出 9 |
| 节奏标注（outcomeType、pacingRole、miceType） | 没有 | 无 |
| E1-E5、A1-A2 诊断 | 有，6 个诊断码加待处理 | `S/model.md` 失败与恢复 |

## 三、好用与痛点

**好用的设计（读到的证据）**

- 事件溯源满足"往前插切面补历史"，第 198 轮真实驾驶测试结论是核心后端模型"站得住"（`T/56-world-engine/walkthroughs/2026-06-20-round-198-p0-real-driving-test.md`）。
- Promise 用"字段有无驱动形态"，阶段从 beat 派生不落库，避免漂移（`T/93.../README.md` D2、D5）；账本任务和未决决策直接进 brief，数据有消费端。
- Decision 的 `risk` 是 writer 的刹车点。依据：模拟实测里"开放决策蒸发"被定为事故级（同文件"User Request"第 5 条）。
- 枚举不用 null 表示业务状态（D29）。

**痛点（读到的证据）**

1. 同一时刻只能有一个切面，写入撞上就 409；示例世界建好后的第一次写入就撞（同上 round 198；`world-engine.service.ts:122-124`）。
2. 相对操作在补过去后断（`broken-relative`），为此长出 7 种 issue 码，`T/56-world-engine/README.md` 908 行，另有 427 份 walkthrough 逐轮打磨输入边界与 issue 定位。
3. 无回退：切面物理删除，patch 不存旧值（`R/world-engine/subject-lifecycle.md` 第 6 节）。
4. 手工双维护：Scene 变了要同步改 Thread 滚动摘要，Scene 摘要不能与 patch 矛盾（`R/plot/agent-spec.md:118-123`）；经历要写状态与 `events` 两遍。
5. 信息控制只能按章手填，curated 模式因工具门控架构限制从未做出（`T/87.../README.md`"架构限制"）；curated brief 的"Subject states"只输出名字与类型，没有状态（`chapter-writer-brief.service.ts:476`），与文档"展开状态摘要"不符。
6. 文档与实现漂移：`knowledge`、`relationships` 模板里没有；`effectiveRefs` 文档称合并 Thread refs，实际不合并（T/87 背景第 3 点）；两份文档称 Plot 不属于写作模式，后来又接上（`R/world-engine/subject-lifecycle.md:5`）。
7. 规划层只做了一半：10 条 lint、`get_promise_ledger`、`get_planning_report` 全部暂缓，代码里查不到；采用"默认 writer 完美执行 brief"，写后不核对（T/93 D2a）。**真实项目实测被降级为单测覆盖**（T/93 "Verification"），所以缺少真实写作中伏笔与决策是否被用起来的证据。
8. 引用无外键：worldAnchor 与 Decision 的 `deadlineChapterId`、`serves` 会悬空（`R/plot/system.md:225-226`）。

## 四、建议

| 概念 | 建议 | 落点与理由 |
|---|---|---|
| 实体经历 | 搬，成本最低 | 不新增对象。定"情节"视图：`changes` 按 `involves` 分页，可含无补丁的变更。数据已具备，缺视图 Spec |
| 伏笔 | 搬意图，不搬表 | 剧情线条目加"伏笔"Component：状态、重要度、期限章、节奏、兑现预期。埋设、推进、受挫、兑现作为变更上的标记（推断：`links` 增一种 beat，带线与种类）。旧 beat 状态靠 Scene.status 派生，canon 的已写、计划天然区分，更好 |
| 规划检查（逾期、无埋设就兑现、密度） | 第二批搬 | 作为待处理的新种类，纯读取即可算，数据已有；旧版没实现过，先观察 |
| Decision | 搬，扩展未决问题 | 加候选、期限章、结论、理由、风险、被取代。理由：防下个 Agent 擅自写死或重议 |
| 章级写作指示（目标、POV、语气、节奏、结尾、禁写） | 搬，但放在章上 | 属活页夹侧，不进 canon 六种对象（提案已定"不进世界状态"）。canon 只提供涉及条目与计划的读取 |
| 信息控制四字段 | 不原样搬 | 手填自由文本会与知情推导重复。`mustHide`、`hintOnly` 是作者意图，可留在章级写作指示里 |
| 知情、秘密 | 第二版新建 | 旧版只有原则，无可复用结构（`information-control.md:22`：引用不等于授权）。落点（推断）：条目间"知道"的边，或带知情类补丁的 Component |
| 动机、目标、内心、记忆 | 第二版，先不设计 | 旧版没有；canon 的语义档字段已能装"现在的目标或态度"，别急着加对象（推断） |
| 场景 | 不搬 | 旧版 Scene 是 Plot 与 World 两套数据的桥；canon 只有一套，章内排序键加 `involves` 已够。要分镜时再说 |
| 卷、阶段 | 不搬 | 卷用活页夹分组；阶段用剧情线条目的父子（推断） |
| 日历与唯一 instant | 不搬 | 一刻一切面与 bigint 秒是 Agent 门槛的主要来源。要故事时间，做成变更上的可选字段，别做全局唯一键 |
| outcomeType、pacingRole、miceType、tension | 不搬 | 无使用证据，lint 未实现，tension 旧稿自己也砍了 |
