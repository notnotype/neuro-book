# 仓库内的现状（2026-10-31）

t01 问题发现时查到的现状。代码行为凡未注明运行证据的，都是从代码推断。旧应用部分由一个只读调研子代理整理，主会话抽查了关键出处。

## 一、nb-story（读者视角）

数据模型见 [V9 小说记忆图](../../../../docs/proposals/novel-memory-v9.md) 与 `packages/nb-story/src/core/dataset.ts`。要点：

- 两条轴：**阅读位置**（每条记录的 `at: {chapter, paragraph}`，查询按它过滤后文，防剧透）与**故事时间**（时间点 `TimeAnchor`：`day` 主线第几天、`part` 时段、`rel` 与别的点的先后、程序排出的 `order`）。
- 每条记录都有原文出处；模型只写章草稿，知情推导、数值累加与核对、称呼可见位置由程序生成。
- 马甲（化身、代号）与同名不同人都是单独的对象，用“身份同一”的说法相连；转世、失忆的身份默认本人不知道（`packages/nb-story/src/ingest/rules.md` 的知情例外）。

### 平行宇宙与死亡回档

两条轴都只有一条线，记录上没有“哪条世界线、哪一轮”。以“第 5 天死亡、回到第 1 天”为例：

| 部分 | 现在的做法 | 回档时的表现 |
|---|---|---|
| 时间线 | 按第几天、时段、`order` 排（`packages/nb-story/src/core/queries/timeline.ts` 的 `compareStory`） | 第二轮的第 1 天与第一轮的第 1 天混排 |
| 补叙判定 | 故事时间早于前面章节写到的时间即为补叙（同文件 `timeline`） | 第二轮整段被标成补叙 |
| 数值流水 | 按阅读顺序逐笔累加，与原文核对 | 回档后余额该重置，实际继续累加，核对报 mismatch |
| 知情与秘密矩阵 | 按阅读位置累积 | 第一轮知情的角色在第二轮仍显示“知道” |
| 世界事实 | 说法没有世界线限定 | “南小风死了”与“南小风活着”只能用 `contradicts` 连，意思变成其中一条错了 |
| 同一人在两个世界 | 马甲机制：两个对象加“身份同一” | 基本可用 |

阅读位置这条轴不受影响。没有用真实的回档或平行宇宙题材的书跑过。

## 二、旧应用 WorldEngine（作者视角的世界状态）

- **模型**：抽象的主体（subject）、切面（slice）、patch、`instant`。属性由项目里的 Zod schema 声明（模板 `packages/neuro-book-legacy/assets/workspace/.nbook/templates/project-directory-templates/world-engine/schema/index.ts`，内置 world、character、location、faction、item）。属性分 scalar、list、collection、object，操作有 replace、increment、append、remove。引用是 `subject://<id>` 字符串，单向，反查靠 `findRefs`。
- **时间**：事件溯源，没有“当前状态”存储，任意时刻的状态是截至该 `instant` 的 patch 按 `(instant, seq)` 折叠。`instant` 全库唯一（一个时刻只有一个切面），bigint，配项目日历 `world-engine/calendar.ts`（gregorian、simple、custom）。
- **存储**：schema 与日历是项目文件；切面与 patch 在 `.nbook/project.sqlite`（与 Plot 共库，`prisma/project.schema.prisma` 的 `WorldSubject`、`WorldSlice`、`WorldPatch`）。
- **Agent**：一个 `execute_world` 工具，在 CodeAct 沙箱里调 `world.time`、`world.subject`、`world.slice`、`world.search`（向量检索）；写手只拿只读（`server/agent/tools/world-engine-tools.ts`）。
- **分支与回退**：没有。`assets/reference/world-engine/subject-lifecycle.md` 写明切面物理删除、第一版没有 rollback；`.agents/tasks/42-simulation-rollback-mechanism/` 的回滚草案只管 simulation，明确排除 Plot 与 World。

## 三、旧应用剧情工坊（Plot）

- **定位**：“讲什么、怎么排”的作者结构层，不存正文，也不是世界状态的真相源（`packages/neuro-book-legacy/assets/reference/plot/system.md`）。
- **两棵树**：承载树 Story → StoryAct（卷）→ StoryChapter（章，带 writer brief 字段组）→ 正文（manuscript 文件用 frontmatter `chapter:` 反指）；因果树 StoryPhase → StoryThread（剧情线）→ StoryScene（场景，挂章，两树交汇）。
- **规划层**：StoryPromise 伏笔账本（open、fulfilled、abandoned）与 StoryPromiseBeat（埋下、推进、受挫、回收，挂场景）；StoryDecision（ADR 式决策，锚到任意对象）。
- **写作**：每章编译一份 writer brief（章目标、参数、信息控制、节奏、禁写、剧情点、建议读取，`server/plot/services/chapter-writer-brief.service.ts`）。
- **与 World 的连接**：场景上的 `worldAnchor`（起止 `instant`、在场主体 id 列表、地点），全是字符串 id、无外键。
- 都在 `.nbook/project.sqlite`。v2 里还没有剧情工坊与 WorldEngine（仓库根 `README.md`）。

## 四、旧应用的设定与人物

- 新建项目复制整棵模板树（`server/workspace-files/novel-workspace.ts` 的 `copyNovelDirectoryTemplate`）：`AGENTS.md`、`agents/`（各 Profile 的 context、memory）、`lorebook/` 七类、`manuscript/` 示范章、`world-engine/`、`manual/`、`reference/`、`upload/` 等。
- 设定一条一个目录，正文在 `index.md`，frontmatter 有 `type`、`subtype`、`status`、`aliases`、`tags`、`summary`、`refs`（相对路径）、`retrieval`、`governance`、`ext`；类型枚举固定在 `server/workspace-files/content-node-schema.ts`。
- 有表单：`app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue`（745 行）把 frontmatter 字段画成表单、写回文件，字段写死在组件里。
- `variable-sdk`（Agent 运行时变量）与 `profile-sdk`（写 Profile 的 SDK）与设定无关。

## 五、旧设计里看得出的痛点

1. 状态两份真相源：`lorebook/character/index.md` 说人物是无状态原型，人物模板却带 `state.md`（当前状态、持有物、风险）。
2. 没有回退与分支；切面物理删除，patch 不存旧值。
3. 相对操作（increment、append）在补写过去或删切面后断，报 `broken-relative`（`assets/reference/world-engine/issues.md`）。
4. schema 不做版本化与迁移；Zod schema 只能单文件、不能 import。
5. Plot 与 World 之间全靠字符串 id，共用一个 SQLite。
6. Agent 门槛高：bigint `instant`、日历字符串、CodeAct API、两套问题码。
7. 工具在 Profile 定义期固定，写手的 curated 模式因此延后（旧 `.agents/tasks/87-plot-two-trees-and-writer-modes/`）。

## 六、新应用现状

- **项目**：新建作品只建目录与 `.nbook/project.json`，没有模板（[`runtime/projects.md`](../../../../docs/specs/runtime/projects.md) 第 14 条）。
- **三类文件夹已实现**（[`workspace/folder-kinds.md`](../../../../docs/specs/workspace/folder-kinds.md)）：普通、`*.content/`（`content.xml`）、`*.binder/`（`binder.xml`，归剧情插件，章节编号即稳定 id）。约定的目录名 `manuscripts.binder/`、`lorebook.content/`。
- **剧情的方向**（[项目文件底座](../../../../docs/proposals/project-file-foundation.md) 的“后续重构”）：剧情插件注册 `chapter://`（真实目录型）与 `plot://`（虚拟型，数据在数据库），StoryAct、StoryChapter 退役，场景挂章节编号；剧情模型与迁移另起设计，至今没有。
- **nb-form**：代码与测试已有，Spec [`ui/forms.md`](../../../../docs/specs/ui/forms.md) 仍为 `planned`。支持按 JSON Schema 画表单、自定义控件登记、条件显示、对象列表与左列表右详情；Agent 生成的描述用 `policy: "agent"` 检查（不许 `$ref` 等）。
- **nb-memory**（episode、facts、主体注册表）存在，nb-story 不依赖它（[剧情图谱提案](../../../../docs/proposals/novel-story-app.md) 第七节第 3 条）。
- **Agent**：w00032 正在设计实施；工具原则“一个工具只做一件事”（w00032 t04、t14），内置 Profile 第一批是主创、会话标题、adhoc（t18）。
