# Plot 两棵树重设计 + Writer 双模式 + ChapterBrief

## Relative documents refs

- [reference/plot/system.md](../../../reference/plot/system.md)：Plot 两棵树、StoryAct/StoryChapter/ChapterBrief、frontmatter 反指契约。
- [reference/plot/writer-brief.md](../../../reference/plot/writer-brief.md)：writer brief 格式规范与两种防全知模式。
- [reference/world-engine/workflow.md](../../../reference/world-engine/workflow.md) §6：简化原则两轴 + Leader-Writer 协作。
- [reference/agent/leader-default.md](../../../reference/agent/leader-default.md)：leader 调用 writer 的协议。
- [archived/chapter-override-writer-brief](../archived/chapter-override-writer-brief/README.md)：被本任务吸收的 Task 80（ChapterOverride）。

## User Request / Topic

起点是「leader 给 writer 的 brief 哪里做得不好」，层层挖出三个系统性问题：

1. **章在系统里没有身份**：Chapter 只是 `StoryScene.chapterPath` 字符串，章级写作指令（POV / 信息控制 / 开头收尾 / 禁写）无处持久化，只活在 leader 当轮 message 里，换会话 / 换模型即蒸发，也无法事后拿指令对照成稿审查。Task 80 规划的 `ChapterOverride` 从未落地。
2. **防全知全靠自觉**：writer 持有 god-view 只读 `execute_world` + 通用 `file.read` + `bash`，lorebook（全知作者视角）全能读；信息控制只有提示词软约束，没有任何结构化机制。
3. **brief 契约与实现漂移**：refs 存了但编译器不用；`effectiveRefs` 文档承诺合并 Thread refs 但代码只是 Scene refs 换壳；编译出的 brief 缺信息控制 / 章节目标 / 建议读取段。

## Goal

把「章级 writer 指令」从提示词软约束升级为**入库、外键化、编译器强制**的系统层：建立承载树（Story→Act→Chapter→Prose）与因果树（Story→Phase→Thread→Scene）两棵树，在 Scene.chapterId 交汇；`ChapterBrief` 作为 `StoryChapter` 字段组落地；brief 编译器支持防全知双模式（autonomous 默认 / curated 延后）；信息控制缺失时 brief status 降级到 `needs_chapter_brief` 阻断 handoff。验证方式为 `bun test server/plot server/agent/profiles` 全绿 + bootstrap 实测 + 双模式 brief 对照。

## Current State

- **Slice 1（Schema + 服务层）已落地**：`prisma/project.schema.prisma` 新增 `StoryAct` / `StoryChapter`（含 `brief*` 字段组），`StoryScene.chapterPath` → `chapterId Int?` 外键（`onDelete: SetNull`）。新增 `PrismaChapterRepository` / `ChapterService` / `ChapterProseService`（frontmatter 反指，复用 `ProjectWorkspaceIndex`）/ `ChapterBootstrapService`。`plot-scope.guard.ts` 改 assertAct/assertChapter。workspace validate 新增 chapter-pointer 校验规则。
- **Slice 2（brief 编译器双模式）已落地**：`chapter-writer-brief.service.ts` 重写，签名 `getChapterWriterBrief(projectPath, chapterId, mode)`；7 段骨架（本章目标 / 参数 / 信息控制 / 节奏 / 禁写 / 剧情点 / 建议读取）；status 链增加 `needs_chapter_brief`；autonomous 出查询提示、curated 展开状态摘要。`plot-tools.ts` 新增 Act/Chapter CRUD + 新签名。
- **Slice 3（writer profile 双模式，只做 autonomous）已落地**：writer profile toolset 加 Plot 只读；PayloadSchema 删 `threadIds/sceneIds/plotIds`，加 `chapterId?`；`description` 指向 `reference/plot/writer-brief.md`；SKILL 双模式说明。
- **Slice 4（文档）已落地**：system.md / writer-brief.md / workflow.md §6.2 / leader-default.md / leader.default.profile.tsx / manuscript.md 已改写；Task 80 归档。
- **前端 Plot 面板迁移已落地**：Scene DTO `chapterPath → chapterId` 的重命名破坏了前端 Plot 面板 typecheck（面板原本从 manuscript 文件树派生章、用路径当 id）。用户选择「完整前端迁移」，已完成：
  - `NovelPlotPanel` 的 `chapters` 改从 PlotTree DTO 的 `acts[].chapters + ungroupedChapters`（StoryChapter 实体）派生，不再扫 manuscript 文件树；Scene 挂章、排序、快速编辑全链路 `chapterId` 化。
  - 面板子树（`plot-thread-panel.types.ts`、PlotThreadDetailPanel/EditorDialog/ScenePanel、Workbench Inspector/SceneList、两个 PreviewWorkspace 桥接组件）本地 `chapterPath` 字段统一改名 `chapterId`。
  - 新增 `PlotChapterEditorDialog`（承载树章节 + 完整 ChapterBrief 表单：目标/POV/语气/节奏/信息控制四项/开场收尾/禁写）+ 章节管理条（芯片点开编辑，圆点标记是否已填 brief）+ 新建卷对话框。
  - 新增只读接口 `GET /api/projects/plot/chapters/:id/prose`（经 chapter.name 调 `findProseForChapter`），章节编辑器展示 frontmatter 反指本章的正文列表。
  - `bun run typecheck` 全绿（0 error）。

## Decisions / Discussion

见下表（与用户逐条确认，来自 plan `1-writer-tidy-hamster.md`）：

| # | 决策 |
|---|---|
| D1 | **两棵树**。承载树 Story→Act→Chapter→Prose；因果树 Story→Phase→Thread→Scene。Scene 由 `chapterPath` 字符串改为 `chapterId` 外键。 |
| D2 | **Chapter 与 manuscript 切割**：一个 Chapter 可有多份 Prose；manuscript 文件任意变动不影响 Chapter。 |
| D3 | **Chapter↔Prose = frontmatter 反指**：prose `index.md` frontmatter 写 `chapter: <name>`；查询复用 `ProjectWorkspaceIndex`。 |
| D4 | **ChapterOverride 更名 ChapterBrief**，作为 Chapter 上字段组；字段全可选、自由文本为主；兼作事后审查依据。Task 80 被吸收，不是废案。 |
| D5 | **Beat 不引入**；Scene.summary 承担节拍。Phase 不改名，Act/Phase 分属两树。 |
| D6 | **Writer 双模式，lowcode 设置切换**。默认 `autonomous`（world/文件/bash + Plot 只读）；`curated`（剥掉 world/bash/plot，file 限 scope，保留反问逃脱口）。**本轮只做 autonomous**（tool-gating 架构限制，见下）。 |
| D7 | **两种 brief 分开命名**：Autonomous Brief（框架 + 查询提示）/ Curated Brief（框架 + 过滤后状态摘要）。 |
| D8 | **brief 骨架**：章节目标 / 落点、Scene 剧情点（默认粗）、信息控制（必填，缺失降级 status）、节奏 / 下一章牵引、本章覆盖参数、查询提示或状态摘要、建议读取。删「写作约束」段、删「基本设定」复述。 |
| D9 | **简化原则拆两半**：状态不变量是 autonomous 规则（curated 反转）；剧情精细度是档位（默认粗）。 |
| D10 | **brief spec 留在 reference/**，writer profile `description` 只放文件引用指针。 |

**架构限制（tool-gating）**：profile `tools`/`toolKeys` 在定义期静态；`ProfileTurnPlan` allowlist 拒绝按 settings 门控工具；harness 绑定 `toolKeys = [...runProfile.rootToolKeys]` 无 settings 过滤。单 writer profile + lowcode 开关做硬工具门控在不新增 harness seam 或第二个 profile 的前提下不可行。用户拍板：**本轮只做 autonomous 模式**，curated + 反问逃脱口延后。

## Verification / Test

- `bun test server/plot` 64 pass；`bunx vitest run server/agent/profiles` 167 pass；`server/agent/tools/plot-tools.test.ts` + `server/api/projects/plot` 15 pass。**注意**：full `server shared` 并跑会因并行加载污染出现无关模块失败（auth / harness / catalog），须按 shard 隔离跑。
- `bun run typecheck` 全绿（0 error），含前端 Plot 面板迁移与新增 Chapter/Act/Brief/Prose UI。
- 前端 profile 编译：编辑 `leader.default.profile.tsx` 后须跑 `bun run profile:metadata` 重编译 stale artifact，否则 `leader-assets-profile.test` 的 catalog freshness gate 会拒绝加载。
- **bootstrap 实测已完成**（《命定之诗2》`workspace/ming-ding-zhi-shi-2`）：核心迁移逻辑验证正确——2 Act + 2 Chapter 建成、4 Scene 全挂 `002-volume-001-chapter`、frontmatter 反指回写、**0 迁移孤儿**、幂等重跑无副作用（Act/Chapter/frontmatter 均 0 新建）。实测炸出并已彻底修复 2 个单测覆盖不到的真实 bug（见下「bootstrap 实测修复」）。
- 双模式对照：同章 `get_chapter_writer_brief` 两种 mode，autonomous 无状态展开、curated 有；信息控制空时 status = `needs_chapter_brief`。
- 浏览器 / UI 与真实 Agent 模型行为 smoke 按惯例交给用户，不自动执行（新 Chapter/Act/Brief/Prose UI 尚未浏览器验证）。

## Implementation Walkthrough

- Schema breaking 变更后需分别 `bun x prisma generate --schema prisma/project.schema.prisma`（`bun run generate` 只处理 App schema）。
- `StoryChapter.name` 唯一（per story），供 Prose frontmatter 反指；`chapterIdentityFromPath('manuscript/002-volume/001-chapter/')` → `name=002-volume-001-chapter`。
- brief 编译器 `chooseStatus` 在 `isInfoControlEmpty(brief)`（readerKnows/protagonistKnows/mustHide/hintOnly 四字段全空）时停在 `needs_chapter_brief`——这是防全知唯一的结构化按章控制面。
- 所有 plot 测试 fixture 已从 chapterPath 契约改写为 chapterId 契约；writer-profile-contract / leader-assets-profile 测试重写为 autonomous 契约。
- **bootstrap 实测修复（事务边界 + 进程退出）**：真实项目跑 `bootstrapCarrierTree` 炸出两个单测测不到的 bug，均已彻底修（非 hack）——
  1. **事务超时**（`A query cannot be executed on an expired transaction ... 10309ms passed`）：facade 把「manuscript 目录扫描 + frontmatter 回写」整个塞进 Prisma interactive transaction，真实项目文件 I/O 耗时超过默认 5s 事务超时。**修法**：拆事务边界——`readProjectWorkspaceTreeSnapshot`（扫描）移到事务**前**；事务内 `ChapterBootstrapService.applyCarrierTree(projectPath, nodes)` 只做 Act/Chapter 纯 DB 写入 + 收集待写 `pendingPointers`；`writeProsePointers`（frontmatter 落盘 + 索引失效，模块级导出）移到事务**提交后**。facade `bootstrapCarrierTree` 负责三段编排。系统性保证：事务体内不再有任何文件 I/O，超时结构上不可能复发。`applyCarrierTree` 内的 create/link 逻辑与旧 `bootstrapCarrierTree` 逐字一致，只挪调用位置，故不破坏已验证的迁移正确性。
  2. **进程不退出 / SQLITE_BUSY**：libsql native 在 bun/Windows 上 `close()` 后仍挂 event-loop 句柄，一次性 CLI 进程不自然退出，残留 SQLite 文件锁让下次运行报 SQLITE_BUSY。查明 `closeProject` / `initProjectDatabaseAtRoot` 已有 `$disconnect` + `closeTrackedClients` + `collectReleasedSqliteHandles` 清理却仍压不住 native 句柄——这是**库层限制**；常驻 server 无此问题（进程不退出、连接复用 facade 缓存），故 `process.exit` 是 CLI 场景的正解而非兜底。**修法**：CLI `main()` 返回退出码，末尾 `process.exit(await main())` 强制释放句柄（同样修了复测脚本 `.agent/workspace/verify-plot-bootstrap.ts`）。
  - **复测**：连跑 bootstrap CLI + verify 两个进程，均 `EXIT_CODE=0`、无 SQLITE_BUSY、事务 3.9s 内完成不超时、树完整 0 孤儿。完整 create 路径未做破坏性重跑——因 `migrateStorySceneChapterEntity` 一次性消费 `StoryScene.chapterPath` 列（迁移后该列即被 drop），清空重跑会把 4 个 scene 永久孤立；create/link 逻辑本轮未改，结构性保证足矣。

## TODO / Follow-ups

- **[遗漏·未接线] 孤儿 Prose 指针检测无可触发入口**：`ChapterProseService.findOrphanPointers` + `facade.findOrphanProsePointers`（检测 frontmatter `chapter:` 指向不存在的 StoryChapter）**无任何调用方**（API/CLI/UI 都没接）；`validateChapterPointers` 的 orphan 分支在 workspace 索引路径（`project-workspace-index.ts:251`）不喂 `knownChapterNames`（by design，纯文件层无 DB 上下文），只做指针**格式**校验。结果:孤儿检测能力已实现但目前跑不起来。Slice 1 计划说「孤儿检测挂 validate 体系」未落地接线。修法:给 `findOrphanProsePointers` 接一个入口（validate CLI 子命令 / 一个 GET route / Plot 面板告警）。低优。
- **[已订正·非回归] `NovelChapterPanel` 是无引用 legacy 死代码**：审查初判它的「本章剧情」widget（`loadChapterPlotDetail` 仍传旧 `{chapterPath: selectedChapterId}` 给已改为要 `chapterId` 的 `/plot/chapter`）是「🔴 高优先级回归」，**核实后推翻**：全仓无任何 `.vue`/page 引用 `NovelChapterPanel`（只有本 walkthrough 与 PROJECT-STATUS 提及），左栏 `NovelIdeToolPanel` 用的是 `WorkspaceCharacterPanel` + `NovelPlotPanel`，git 停在 `07f9b8ad prepare 0.5 canary` 后未动 —— 它是写作模式迁移到 Project Workspace 前的 legacy novel-model 视图。**那个 400 运行时永不触发**，故不为它建后端反向桥（=给死代码服务=过度设计，用户拍板）。typecheck 抓不到是因为 `$fetch` query 无类型（见下「typed query」条）。
- **[follow-up·独立任务] 清理 legacy novel-chapter view 子系统**：死簇（仅被 `NovelChapterPanel` 用）= `NovelChapterPanel.vue` + `NovelChapterSortableRow.vue` + `NovelChapterVolumeCard.vue`（+ `novel-chapter-dnd.ts` 若独占）。**勿删**：`NovelBookshelfDialog.vue`（`app/pages/index.vue:2297` 渲染中）仍依赖 `shared/dto/novel-chapter.dto.ts` → dto 保留；store `novelTree`/`loadNovelTree`/volume CRUD 与 legacy `/api/novels/:id/tree` 的活消费者清理前须逐一确认。不与本任务混做。
- **[防再犯] 给 plot 前端 `$fetch` 配 typed query**：本次死调用漏网的元原因是 `$fetch` query 是无类型 `Record`，改路由契约时 typecheck 抓不到旧调用方。收尾方向是给 plot 这些 `$fetch` 配 typed query（或薄 typed API client），让契约变更能在编译期炸出所有调用点。独立收尾。**部分已由 [Task 99](../99-plot-planning-ui/README.md) 收口**：新端点（promises/decisions）走 `planning/plot-planning-api.ts` typed client；存量 23 个 `$fetch` 调用点仍未迁移。
- **OpenAPI route-map 补全**：`server/openapi/route-map.ts` 缺 `projects/plot/acts`、`projects/plot/chapters`（CRUD）、`chapters/:id/prose` 的路由条目（phases 有、acts/chapters 从 Slice 1-2 起就没进）。只影响 OpenAPI 文档完整性，不影响运行（agent 工具走独立 `plot-tools.ts`）。**注**：审查中已修复 route-map 里 `plot/chapter` + `chapter-writer-brief` 的 `chapterPath → chapterId` 漂移并给 brief 加 `mode`。
- **UX papercut**：全新项目（无章无卷）时章节管理条 `v-if="chapterChips.length || actNodes.length"` 整体隐藏 → "+ 卷" 够不着（"+ 章节" 在 header 常驻，可先建章让条出现再建卷）。可把 "+ 卷" 也挪到 header 或常显条。
- **curated 模式 + 反问逃脱口**：需要第二个 profile 或新 harness seam（`RunToolSnapshotResolver` 类）才能做硬工具门控；延后。
- **Plot Workbench UI 深化**：核心 Act/Chapter/ChapterBrief 编辑 + Prose 关联视图已在本轮落地（`PlotChapterEditorDialog` + 章节管理条 + 新建卷）。后续可做：章节拖拽排序、卷编辑/删除、孤儿 Prose 指针告警面板、ChapterBrief 的 AI 批注。新 UI 尚未浏览器验证。**工作台已由 [Task 99](../99-plot-planning-ui/README.md) 重组为 3 个真 tab**（线程规划/承诺账本/决策记录，装饰 tab 删除），refs 目标候选硬编码 demo 数据同轮清除（改接 workspace tree 真实内容节点 + 按 query 即时搜索）。
- **Thread 级 refs**：泛化 StoryRef owner；当前 effectiveRefs 只有 Scene refs，文档已如实描述。
- **精细分镜级 brief 档位**：本轮只做粗粒度。
- `docs/modules/plot/functional-description.md` 仍有旧 `chapterPath` 模型描述，待后续按 chapterId 过一遍（本轮 Slice 4 只覆盖 reference/）。
