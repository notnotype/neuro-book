# Plot Scene / World Engine Bridge

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [reference/plot/system.md](../../../reference/plot/system.md): 当前 Plot System 合同，定义 Story / StoryPhase / Thread / Scene、Scene World Anchor、World Engine 查询桥接和 Agent 消费方式。
- [reference/world-engine/README.md](../../../reference/world-engine/README.md): World Engine 稳定参考入口，定义动态世界状态与时间线真相源。
- [reference/world-engine/workflow.md](../../../reference/world-engine/workflow.md): 写作模式中 World Engine / Lorebook / Manuscript 的职责边界。
- [docs/tasks/56-world-engine/README.md](../56-world-engine/README.md): World Engine 核心模型、API、Workbench 与阶段收尾记录。
- [docs/tasks/59-world-engine-workbench-redesign/README.md](../59-world-engine-workbench-redesign/README.md): World Engine 三栏 Workbench 设计记录。
- [docs/tasks/61-world-engine-workbench-real-api/README.md](../61-world-engine-workbench-real-api/README.md): World Engine 真实主 IDE Workbench 接入记录。
- [app/components/novel-ide/plot/NovelPlotPanel.vue](../../../app/components/novel-ide/plot/NovelPlotPanel.vue): 当前 Plot 面板入口。
- [app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue](../../../app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue): 当前 Plot Workbench Dialog。
- [server/plot/](../../../server/plot/): 当前 Plot 后端模块。
- [shared/dto/plot.dto.ts](../../../shared/dto/plot.dto.ts): 当前 Plot DTO。

## User Request / Topic

- 重新设计 Plot 工作台，使最近新做的 World Engine 与 Plot 剧情工作台结合。
- World Engine 继续负责动态世界状态、时间线和 patch 真相源。
- Plot 工作台以 Scene 为基础，Scene 成为连接 World Engine 的桥梁。
- Scene 通过时间范围连接 World Engine，并显式包含时间、地点、人物 subject 三要素。
- 保留 `Story -> StoryPhase -> Thread -> Scene` 层级；Chapter 独立于该层级，负责声明章内包含哪些 Scene。
- 暂不引入新的 canon / 草稿 / 待确认状态；保持现状，避免无用状态影响实现。
- 考虑删除 `Plot / Plot Beat`，让 Scene 成为 Plot 最小单位；Scene 可查询当前世界状态和当前时间范围内的 World Engine patches。
- Chapter 覆盖独立于 Scene，负责叙事节奏、POV、语气、章节收尾等 writer-facing 指令；本 Task 78 不实现 `ChapterOverride`，只把它明确单列为后续任务。

## Goal

设计并逐步落地一个以 Scene 为核心的 Plot / World Engine 桥接方案：Scene 通过时间范围、地点 subject 和出场 subject 连接 World Engine；Plot Workbench 从旧剧情节点编辑器转型为 Scene 编排器；Chapter 负责正文承载和 writer 指令覆盖层；World Engine 保持动态状态与时间线唯一真相源。

- Outcome: Plot 工作台能以 Scene 为最小叙事单位组织剧情，并能从 Scene 查询相关 World Engine 状态、slice 和 patch；Chapter 按顺序承载 Scene。章节级 writer 指令层后续由 `ChapterOverride` 单列实现。
- Verification surface: 先以设计文档和现有代码调研确认数据模型与 UI 路径；进入实现后用聚焦测试验证 Scene 时间字段、Chapter-Scene 关联、World Engine 查询桥接和旧 Plot Beat 退场路径。
- Constraints: 不让 Plot 保存第二份动态世界状态；不破坏 World Engine 的 slice / patch 真相源；不引入暂时无效的草稿 / canon 新状态；避免一次性重写所有 Plot UI。
- Boundaries: 优先调研和修改 `reference/plot/`、`server/plot/`、`shared/dto/plot.dto.ts`、`app/components/novel-ide/plot/` 以及必要的 World Engine 查询适配；不自动浏览器验证，除非用户明确要求。
- Iteration policy: 先细化模型和迁移策略，再做最小垂直切片；每轮记录实际结果、设计出入和后续 TODO。
- Blocked stop condition: 如果 Scene 时间范围与 World Engine instant / slice 查询语义无法在不制造双状态源的前提下对齐，停止实现并报告所缺契约与建议方案。

## Current State

- World Engine 是写作模式动态世界状态与时间线唯一真相源；Plot System 不保存第二份动态世界状态。
- 当前 Plot System 已收敛为 `Story / StoryPhase / StoryThread / StoryScene / StorySceneRef`，Scene 是最小剧情单位。
- Project Prisma schema 已删除 `StoryPlot`；旧项目升级时会备份并合并旧 `StoryPlot.summary/effect/writingTip` 到 Scene 字段，然后删除旧表和 `plot://` refs。
- `StoryScene` 已持久化 World Anchor：`startInstant/endInstant/subjectIdsJson/locationSubjectId`。
- Scene World Anchor 写入 DTO 保持时间、subject id 和地点 id；读取 DTO 额外暴露 `subjects`、`locationSubject` 和 `unresolvedSubjectIds`，占位 subject 是显式一等状态。
- Plot 聚合读取已通过 `SceneWorldAnchorResolutionService` 统一解析 World Anchor；subject identity 读取不加载 World Engine schema/calendar，旧 Project 或未初始化 World Engine 的 Project 仍可打开 Plot。
- Plot 读取遇到缺失 `world-engine/calendar.ts` 时只降级展示字段：保留 `startInstant/endInstant`，`startTime/endTime` 为 `null`；`calendar.ts` 存在但损坏且需要格式化时间时继续抛出配置错误。
- Plot DTO、Repository、Service、Facade、HTTP parser 和 Agent tools 已支持 Scene World Anchor。
- 服务端已提供 `GET /api/projects/plot/scenes/:sceneId/world-context`，按 Scene 时间范围和已解析 subjects / location 收窄 World Engine 上下文；未解析占位 subject 通过 `unresolvedSubjectIds` 返回，全部未解析时返回空上下文而不报错。
- Plot Workbench Inspector 已接入 World Engine 连接编辑、Subject 选择器和 World Engine Context Panel；Scene Card、Inspector 和 Context Panel 会显示 subject name 与 unresolved 警告态。
- Chapter / Thread / Workbench / Timeline 的预览与主面板已经去掉 Scene 内部 Plot Beat 展示，改为 Scene-only。
- 当前 World Engine slice 是时间点；Scene 范围查询采用闭区间 `[startInstant, endInstant]`，复用 `worldEngineFacade.listSlices({from, to})` / repository 查询语义。
- World Engine 的底层时间类型是 `Instant = bigint`，Prisma 中 `WorldSlice.instant` / `WorldPatch.instant` 均为 `BigInt`；`WorldCalendar.format(instant)` / `parse(input)` 是统一转换入口。
- World Engine HTTP 公开边界只接收和返回项目日历字符串，不直接暴露 raw instant；Agent CodeAct 内部才直接使用 `bigint` instant。

## Decisions / Discussion

- Scene 是 Plot 与 World Engine 的主要桥梁。
- Scene 显式表达时间范围和出场 subjects；地点是可选的单个 subject。
- Scene 时间范围 `[startInstant, endInstant]` 允许 nullable：Scene 可以先创建（规划阶段），稍后再连接到 World Engine 时间线。`null` 表示"尚未确定时间"。
- Scene `subjectIds` 记录所有相关 subjects，不区分 POV/active/mentioned（简化第一版实现）。
- Scene 地点使用单个 `locationSubjectId`，通常 Scene 只涉及一个地点。
- 保留 `Story -> StoryPhase -> Thread -> Scene`，用于作者视角的剧情阶段、长期线索、因果线和场景组织。
- Chapter 独立于 Story 层级，负责正文呈现顺序和 writer-facing 指令；通常一章一个 Scene，但设计上允许一章包含多个 Scene。
- 暂不设计新增 `draft / pending / canon` 状态机。
- **`StoryPlot / Plot Beat` 立即删除**：事实推进由 World Engine patch 表达；叙事节奏、POV、语气、章节钩子等非事实指令放入 Chapter 覆盖或 Scene 字段。编写数据迁移脚本，将 Plot 的 `summary/effect/writingTip` 合并到对应 Scene。
- **Chapter 覆盖后续单列**：Task 78 不实现 `ChapterOverride`。后续任务会把它作为 Project SQLite 中的章节级 writer 指令层设计和实现。
- **Scene 查询 World Engine 使用服务端封装 API**：`GET /api/projects/plot/scenes/:sceneId/world-context`，封装查询逻辑，前端简单调用。
- **Scene 查询按时间范围 + subjects 收窄**：只返回涉及 `subjectIds` 或 `locationSubjectId` 的 patches，UI 提供"在 World Engine Workbench 中打开"查看完整上下文。
- **Plot 读取缺 World Engine 配置时降级**：Plot tree/workbench/thread/scene/chapter 聚合读取为了显示 subject name，只允许使用 calendar-free subject identity；缺少 `calendar.ts` 不阻断 Plot，坏 `calendar.ts` 在需要格式化时间时继续报错。
- Scene 底层时间字段对齐 World Engine：持久化使用 Prisma `BigInt`，服务层类型复用 `Instant = bigint`，不要自创 number / Date 时间源。
- Scene HTTP / 前端 DTO 不直接传 BigInt；主要展示字段使用项目日历字符串，若需要携带 raw instant 只用字符串形式，避免 JSON BigInt 序列化问题。
- Scene 时间范围第一期对齐现有 World Engine 查询能力，采用闭区间 `[startInstant, endInstant]` 查询相关 slices / patches；若后续要改成半开区间，应集中封装在 Scene / World Engine 桥接查询 Module 内，不让 UI 或 Agent 分散处理。
- 第一版实现重点：Plot Workbench 接入 World Engine，让 Scene 能查询和展示 World Engine 上下文。
- 后续设计问题先做本地文档与代码调研，再提出需要用户决策的问题。

## Open Design Questions

- ~~Scene 的 `startInstant` / `endInstant` 是否都必填？是否允许点状 Scene？~~ **已决策（2026-06-29）**：允许 nullable。Scene 可以先创建规划，稍后再连接到 World Engine 时间线。
- ~~Scene 出场 subject 是否区分 POV subject、active subjects、mentioned subjects？~~ **已决策（2026-06-29）**：不区分，只用一个 `subjectIds` 字段记录所有相关 subjects。
- ~~Scene 地点是单个还是多个？~~ **已决策（2026-06-29）**：单个地点，`locationSubjectId String?`。
- ~~第一版实现重点？~~ **已决策（2026-06-29）**：优先实现 Plot Workbench 接入 World Engine，让 Scene 能查询和展示 World Engine 上下文。
- ~~Chapter 覆盖是否本轮实现？~~ **已决策（2026-06-29）**：不在 Task 78 实现。后续单列 `ChapterOverride`，并倾向存放在 Project SQLite。
- ~~删除 `StoryPlot` 的策略？~~ **已决策（2026-06-29）**：立即删除。编写数据迁移脚本，将 Plot 的 `summary/effect/writingTip` 合并到对应 Scene 字段。
- ~~Scene 查询 World Engine API 设计？~~ **已决策（2026-06-29）**：服务端封装专用 API `GET /api/projects/plot/scenes/:sceneId/world-context`。
- ~~Scene 查询 World Engine 的收窄策略？~~ **已决策（2026-06-29）**：按时间范围 + `subjectIds / locationSubjectId` 收窄，UI 提供"在 World Engine Workbench 中打开"查看完整上下文。
- Writer brief 应由 Chapter 覆盖生成，还是由 Chapter 覆盖 + Scene + World Engine 查询结果共同组装？（留待后续迭代决策）

## Architecture Options Considered

| 方案 | 核心思路 | 一致性 | Agent 易用性 | 实现/迁移成本 | 结论 |
| --- | --- | --- | --- | --- | --- |
| A. Plot 独立保存剧情事实状态 | Plot 继续维护 `StoryPlot / Plot Beat`，事实推进也写入 Plot；World Engine 只作为可选参考。 | 差：会形成 Plot 状态和 World Engine 状态双真相源。 | 中：Agent 写 Plot 很方便，但必须额外同步 World Engine。 | 低到中：延续旧结构，短期改动少。 | 否决。它正是本轮要消除的双状态源问题。 |
| B. Plot 直接引用 World Slice / Patch | Scene 不存时间范围，只保存 sliceId / patchId 列表，由 World Engine 切片组成剧情。 | 强：事实全部在 World Engine。 | 差到中：Agent 规划未来 Scene 时必须先造 slice，先规划后落定不自然。 | 中到高：UI 需要切片编排器，历史 Scene 迁移复杂。 | 暂不采用。适合后续高级时间线编辑，不适合第一版作者工作台。 |
| C. Scene World Anchor 桥接 | Scene 保持作者视角结构，新增时间范围、出场 subjects、地点 subject；事实推进仍由 World Engine patch 表达。 | 强：Scene 只保存连接点和作者意图，不保存动态状态。 | 强：Agent 可先建 Scene，再用 `worldAnchor` 和 `get_scene_world_context` 读取上下文。 | 中：需要 Scene 字段、查询 API、UI Inspector、旧 Plot 迁移。 | 采用。当前实现落点。 |
| D. Chapter 驱动桥接 | Chapter 成为写作调度中心，Chapter 覆盖直接聚合 Scene + World Engine 上下文生成 writer brief。 | 中到强：取决于 Chapter 是否误存状态。 | 强：Writer 使用最直接。 | 高：需要 Chapter 覆盖模型、brief 生成器和章节级 UI。 | 后置。可在 C 稳定后作为 writer brief 层继续建设。 |
| E. Agent Profile/Prompt 编排桥接 | 不改 Plot 数据模型，只通过 profile 提示词要求 Agent 同时读 Plot 和 World Engine。 | 差：约束只在提示词层，不能阻止工具误用。 | 中：短期最轻，但长期不稳定。 | 低：主要改 prompt / tool catalog。 | 否决为主方案。可作为 C 的辅助说明，不作为架构边界。 |

### Final Architecture Choice

最终选 C，并保留 D 作为后续 writer-facing 生成层。原因：

- Scene 是作者自然理解的最小剧情单位，适合规划、重排、挂章和写作协作。
- World Engine 保持动态事实唯一真相源；Scene 只保存 `worldAnchor`，不保存第二份当前状态。
- Agent 可以先用 Plot tools 规划结构，再用 `execute_world` 推进事实，最后用 `get_scene_world_context` 把两边重新对齐。
- 旧 `StoryPlot / Plot Beat` 通过迁移合并进 Scene 字段，能直接减少 Agent 工具面和 UI 复杂度。
- Chapter 覆盖不抢 Scene / World Engine 职责，后续只作为 writer brief 和正文呈现顺序的组合层；本轮不创建 `ChapterOverride` 表、API 或 UI。

### Profile Architecture Recommendation

当前普通写作主链采用 **Leader-owned Plot / Scene** 拓扑：

- `leader.default`：用户协作入口、canon 决策入口、World Engine readwrite owner，也是普通写作主链的 Plot / Scene owner；直接持有 Thread / Scene 读写、Scene World Context 和 `get_chapter_writer_brief` 工具。
- `director`：保留为高级或手动剧情导演 profile；本轮不删除、不重构，但普通章节写作、剧情推进和 writer brief 编译不再默认路由到 director。
- `writer`：正式正文执行者，仍不持有 Plot tools；只通过 `invoke_agent.message` 接收上游编译后的 Scene / World Context brief，并用 readonly `execute_world` 自查状态。
- `world.engine`：复杂 World Engine schema / calendar / state 维护 specialist，不接管 Plot 结构或正文写作。

普通写作主链固定为：**剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> 调用 writer**。leader 调 writer 前必须先用 `get_chapter_writer_brief` 编译 brief；若 status 不是 `ready`，先补 Plot、World Anchor 或 World Context，再重新编译。

Round 142 进一步补齐稳定 reference 与测试门禁：`reference/agent/novel-writing-workflow.md`、`reference/plot/system.md` 和 `reference/plot/agent-spec.md` 已同步 leader-owned Plot / Scene 主链；不再使用不被 Vitest 收集的 assets writer test，writer profile contract 改由 server 侧测试覆盖。历史 Round 记录中 director-only 设计保留为当时过程，不代表当前合同。

> 下面 Round 记录按时间保留历史推演与当时状态；其中“当前仍缺”“下一步进入 Slice”等表述指对应 Round 发生时的 worktree，不代表本文档顶部 `Current State` 或 Round 136-140 之后的当前状态。

`get_chapter_writer_brief` 的实现边界按 Round 14 收敛为两段：Task 78 可先实现 scene/world-only v1（Chapter scenes + Thread summary + Scene World Context + warnings），用于降低 Agent 手动串工具成本；Task 80 再把 ChapterOverride 的 POV、tone、信息控制、禁写事项和章节收尾合入同一个 brief。新增该 HTTP route 前，应先按 Round 16 修正 OpenAPI catch-all route 的显式 path 表达能力，避免 route-map 中同一 catch-all file/method 互相覆盖或生成错误路径。Round 18/19 进一步收敛：brief v1 应落在 `ChapterWriterBriefService` + repository 查询层，而不是 Agent tool 层串调用；Round 23/24 重新核对后确认 `SceneWorldAnchorResolutionService` 已落地，brief v1 应复用现有 resolved/unresolved 语义，不再新增第三套解析规则。

Round 20-22 将 profile 架构收束为调用合同：`create_agent.initial` 只放稳定创建语义，`invoke_agent.message` 放本轮任务或完整 writer brief，`invoke_agent.input` 只放目标 profile 的结构化 payload。leader 调 director 时传 `projectPath/mode/defaultChapterPath`，director 通过 `writer_handoff/world_engine_requests/open_questions` 回报；leader 处理 World Engine 后再调用 writer。`get_chapter_writer_brief` v1 的关键输出是可编辑的 `suggestedBriefMarkdown`，不是只给工具看的 JSON；writer 完成后由 leader 判断是否回补 World Engine，并让 director 更新 Scene / Thread summary。

Round 24-26 把后续落地顺序进一步校正为：先修 `leader.default` / `director` / `writer` 及 reference 中的普通写作路由，移除 simulator gate；再给 OpenAPI catch-all route 增加显式 `path`；最后实现 `ChapterWriterBriefService`、HTTP route、Agent tool 和 director tool binding。brief v1 的状态合同为 `ready | needs_plot | needs_world_anchor | needs_world_context`，核心交付是 `suggestedBriefMarkdown`。

Round 27-29 从 Module 深度和工具暴露矩阵继续收敛：第一阶段采用 **Director-only brief**，不把 Plot write tools 或 brief tool 直接交给 writer；`leader.default` 暂不持有 Plot tools，后续仅在真实往返成本过高时考虑只读 `get_chapter_writer_brief`。实现切片固定为：Profile Contract Cleanup -> OpenAPI Explicit Path -> Chapter Writer Brief Module -> Agent Tool Binding；可选 Leader Readonly Brief 不进入第一阶段。

Round 30-32 将 profile architecture 固化为第一阶段规范，并用典型场景和完成审计矩阵校验。当前结论是：架构设计已经足够明确，但实现证据仍缺失；不能把 Agent 易用性目标判定完成，直到 director contract、OpenAPI explicit path、`ChapterWriterBriefService`、`get_chapter_writer_brief` tool 和 profile tests 全部落地。

Round 33-35 将前三个实现切片进一步细化为 blueprint：Profile Contract Cleanup 明确 reference/profile/schema/test 的逐文件改动；OpenAPI Explicit Path 明确 `RouteMetaEntry.path?: string`、world-context 与 chapter-writer-brief 的目标 path；Brief Service Blueprint 明确 `ChapterWriterBriefService` 的输入、依赖、repository 查询、状态聚合、markdown renderer 和测试面。

Round 36-38 继续补齐实现前细节：`get_chapter_writer_brief` 作为 Agent tool 不依赖 selection、不写状态、不传 raw world state；`suggestedBriefMarkdown` 是 leader 可编辑草案，包含 Scene/World query hints 但排除 raw patch JSON、完整 attrs 和伪造 ChapterOverride；go/no-go 检查显示继续纯设计的边际收益下降，下一步应进入 Slice 1 `Profile Contract Cleanup`，但 goal 仍不能完成，因为业务实现尚未落地。

Round 39-41 将实现前最后一组风险收口：旧 `simulator_requests` / `plot` kind 不做兼容 alias，Slice 1 直接硬删除并改为 `world_engine_requests`；测试证据路线拆到 profile schema/prompt、OpenAPI explicit path、brief service/DTO/HTTP、Agent tool selection 四层；实际实现必须按 Profile Contract Cleanup -> OpenAPI Explicit Path -> Chapter Writer Brief Module -> Agent Tool Binding 四个原子补丁推进。下一步若继续推进，应进入业务实现，而不是继续扩写纯设计。

Round 42-44 从 Module / Interface / Depth / Locality 角度复查了实现前隐藏约束：director contract 与当前 profile System 是最该加深的 Module；reference 文件通过 `HistorySet` 注入，旧 Agent Session 不会自动刷新历史前缀，所以 Slice 1 不能只改 reference，必须让 leader/director/writer 的当前 `System` 明确覆盖旧路由；此外 profile source、compiled runtime、tool registry 和 profile binding 是不同证据面，`get_chapter_writer_brief` 落地时必须同步 `plot-tools.ts`、`tools/index.ts`、`profile-tools.ts` 和 director profile，并最终确认 profile build/status 不是 stale/failed。

Round 45-47 进一步校准 director 输出合同的机械约束：`report_result` 会用 profile `outputSchema` 校验 `data` 并在失败后重试，但 TypeBox `Type.Object` 默认允许额外字段，所以 `DirectorOutputSchema` 必须在 root 和 `plot_updates` item 上显式 `additionalProperties: false`；当前 runtime 只能校验“提供的 data 正确”，不能强制 director 必须提供 data，这一点暂不阻塞 Slice 1，但不能在验收中夸大；`get_agent_profile` 只向 leader 暴露 output schema summary 和 toolKeys，因此 `world_engine_requests` 等字段 description 也是 Agent-facing Interface 的一部分。

Round 48-50 补齐 brief v1 实现前的 HTTP 与调用边界：`chapterPath` 是 Plot/Chapter ordering 的 Project Workspace 内部章节目录，writer 的实际写入目标仍由 `invoke_agent.input.path` 单独承担，brief tool 不新增 `writerPath`；brief status 聚合采用固定优先级 path error -> `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready`，空 World Context 可作为 warning，但全部 unresolved 和查询错误必须阻断；`get_chapter_writer_brief` 可继续落在 `projects/plot/[...segments].ts`，但必须先给 OpenAPI route map 增加 explicit `path`，HTTP 层只做 query 非空，业务路径归一化继续由 `PlotScopeGuard.assertChapterPath()` 统一承担。

Round 51-53 按当前 worktree 把实现证据链落到具体文件：`director.profile.tsx` 仍有 simulator gate / `simulator_requests`，`builtin-contracts.ts` 仍允许 `plot_updates.kind = "plot"` 且不 strict，`profile-routing.md` / `leader-default.md` 仍把 director 排除在普通写作主链外，writer 仍有“写作模式不使用 Plot 系统”的注释；Slice 1 应用 TypeBox `Value.Check()` 机械证明新 `DirectorOutputSchema` 通过、旧 `simulator_requests` / `plot` kind / 额外字段被拒绝；未来 `get_chapter_writer_brief` 落地必须同步 `plot-tools.ts` runtime、`tools/index.ts` global registry、`profile-tools.ts` typed binding、director exposure 和 compiled runtime 证据。

Round 54-56 将 brief v1 的 DTO/service/OpenAPI 验收继续收口：`ChapterWriterBriefDtoSchema` 应归属 `shared/dto/plot.dto.ts` 并复用 `ChapterPlotSceneDtoSchema` / `SceneWorldContextDtoSchema`；`ChapterWriterBriefService` 应作为 Plot 模块只读深接口，推荐新增轻量 `findChapterScenesForBrief()` 一次拿到 Scene + thread summary/writingTip，再逐 Scene 查询 World Context；OpenAPI 验收必须证明 `/api/projects/plot/scenes/{sceneId}/world-context` 和 `/api/projects/plot/chapter-writer-brief` 两个 catch-all GET operation 生成独立 path，不再被 `/api/projects/plot/{...segments}` 覆盖。

Round 57-59 将验收边界从 source 扩展到 runtime：当前 profile build system 已有 `ProfileBuildCoordinator`、boot sweep、build-status、content-addressed artifacts 和 publish lock，但当前 director compiled manifest 仍指向含 `simulator_requests` / `Simulation gate` 的旧 artifact，且没有 `get_chapter_writer_brief`。后续不能只用源码测试证明 Agent 可用，必须区分 source profile、schema tests、runtime tool registry、profile binding、catalog/build-status、manifest `profiles.director.artifactSha` / artifact 内容和真实 Agent smoke。`leader.default -> director -> writer` 场景的静态 gate 已明确：leader 可路由 director，director 输出 `world_engine_requests`，brief service/tool 生成 `suggestedBriefMarkdown`，writer 只消费完整 message brief 和 `input.path`；只有真实 Agent smoke 或等价回放通过后，才可声称真实 Agent 行为已验证。继续纯设计收益下降，下一步应进入 Slice 1 `Profile Contract Cleanup`。

Round 60-62 将 Slice 1 的实现前验收继续具体化：`simulation-director-profiles.test.ts` 是 director prompt/toolset 主测试落点，但需要新增 schema-only `Value.Check()` 负例证明旧 `simulator_requests`、旧 `plot` kind 和额外字段被拒绝；profile 编译验收必须先用 `scripts/build/profile.ts check/compile builtin/director.profile.tsx --system` 更新 system manifest 的 `profiles.director.artifactSha`，再检查 active user root manifest 的同名 entry；当前本地 `workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 也存在旧 director source，user profile 会覆盖 system profile，且 `system_profile_shadowed` 仍可能是 loaded 状态，所以实现后如果不处理 user root，可能出现旧 prompt 搭配新 schema 的错配。下一步验收必须显式检查 user assets shadow。

Round 63-65 将后续三个切片的测试与发现路径补齐：OpenAPI 需要新增 `server/openapi/generate-spec.test.ts`，证明 `RouteMetaEntry.path?: string` 能让 world-context 与 chapter-writer-brief 两个 catch-all GET 生成独立公开 path；`ChapterWriterBriefService` 需要新增专用 repository 查询拿 Scene + thread summary/writingTip，并用 fixture 覆盖 `needs_plot / needs_world_anchor / needs_world_context / ready` 以及 `suggestedBriefMarkdown` 信息边界；Agent tool binding 必须同时进入 `plot-tools.ts`、`tools/index.ts`、`profile-tools.ts`、director toolset、`get_agent_profile` 可发现路径和 compiled artifact，brief tool 不应写 `plot.selection`，writer 仍不暴露 Plot tools。

Round 66-68 将实现前审计更新到 Task 79 之后的新 runtime 证据口径：Slice 1 `Profile Contract Cleanup` 的补丁面已经收敛为 director prompt、`DirectorOutputSchema` strict、writer 注释和普通写作 reference 四组；compiled profile 验收应检查 `profiles.director.artifactSha` 和 `.compiled/artifacts/<sha>.mjs` 内容，而不是旧 current pointer。当前 system/user director manifest 都指向同一个旧 artifact，artifact 仍含 `simulator_requests` / `Simulation gate`，且 active user root 也存在旧 director source，会 shadow system。继续纯探索收益很低，下一步应进入 Slice 1；但在 profile contract、OpenAPI explicit path、brief service、Agent tool binding 和 compiled artifact 全部落地前，Agent 易用性改造不能判定完成。

Round 69-71 将后续三条 Interface 再次压实到当前代码证据：OpenAPI explicit path 不只是文档修正，而是 catch-all route 的机器可读 Interface，应让 world-context 与 chapter-writer-brief 两个 GET path 独立存在并带 path/query params；brief v1 不能复用现有 `findChapterScenes()` 和 `ChapterPlotSceneDtoSchema`，因为它们缺 thread summary/writingTip 和 Scene writingTip，推荐新增 `findChapterScenesForBrief()` 形成章节级只读深 Module；`get_chapter_writer_brief` 从可实现到可发现必须同步 runtime tool、global registry、typed profile binding、director toolset、`get_agent_profile` schema summary 和 compiled artifact，单改 `plot-tools.ts` 不构成 Agent 可用。

Round 72-80 将实现前验收继续压到 profile 激活和 Agent-facing Interface：user profile 会覆盖 system profile，因此 Slice 1 不能只验 system source/artifact；`DirectorOutputSchema` strict 测试必须证明旧 `simulator_requests`、旧 `plot` kind、root extra 和 item extra 被拒绝；Agent smoke 结论必须区分 static proof、faux harness 和真实模型行为；当前 leader reference/profile 仍把 Plot/director 排除在普通写作主链外，这是 Slice 1 的首要合同 gap；`world.engine` 的 specialist 边界基本正确，director 的 World Engine 未决问题应通过 `world_engine_requests` 交回 leader，而不是直接转交 `world.engine`；`get_agent_profile` 只暴露 toolKeys 和 schema summary，不暴露目标 profile 完整 prompt，所以 tool description 与 TypeBox field description 是后续 `get_chapter_writer_brief` 和 director handoff 的 Agent-facing Interface。

Round 81-83 用 Module / Interface / Depth / Locality 口径复审三个实现 seam：`simulation-director-profiles.test.ts` 应加深为 profile contract 测试 seam，把 prompt/tool/schema strict 负例放到同一验收面；OpenAPI explicit `path?: string` 是 catch-all route 的机器可读 Interface，`generate-spec.ts` 还应加 duplicate operation guard，防止两个 GET operation 静默覆盖；`ChapterWriterBriefService` 应作为 Plot 模块的深 read model Module，配套 `findChapterScenesForBrief()` 一次取得 thread summary/writingTip 与 Scene writingTip，Agent tool 只做 adapter，不承载 status precedence、warnings 和 markdown 信息边界。

Round 84-86 将最后一组 runtime 证据和实现切线固化：`AgentProfileCatalog` 先加载 system 再用 user 覆盖，且 `.compiled/manifest.json -> artifacts/<sha>.mjs` 是运行真相源；当前 system/user director source 和 compiled artifact 都仍含旧 `simulator_requests` / `Simulation gate`，因此 Slice 1 验收必须覆盖 active user source、manifest artifactSha、artifact 内容和 `get_agent_profile` discovery；`get_chapter_writer_brief` 必须是 selection-free read adapter，不读写 `plot.selection`；当前 architecture choice 和四个实现切片已经足够明确，下一步应进入 Slice 1，除非新证据推翻既定设计。

Round 87-89 补齐 Slice 1 的操作证据和最终入口 checklist：profile CLI 支持 `check/compile/status`，默认 user root、`--system` 切 system root；非 force `prepare-system-assets --sync-user-assets` 会更新仍跟随上游的 user profile 并通过 Publisher 同步 compiled artifact，手改 user profile 会保留并 warning；当前 director user sync state 看起来仍跟随上游，但验收必须以 sync 输出、sync state、user source 和 user artifact 为准。Slice 1 的最终 patch order 是 schema -> director profile -> leader profile -> writer profile -> reference -> profile tests -> system/user compile/sync verification。

Round 90-106 将后续切片继续压到当前代码证据：OpenAPI explicit path 需要同时服务静态 spec 与 route-local `defineRouteMeta`，但 canonical proof 是 `generateOpenAPISpec()` / `/_openapi.json`；route-local metadata 只能作为物理 route 的 representative operation 摘要，必须补 explicit path params 并避免同文件多 entry 时 last-wins 静默覆盖，不能被当成同一 catch-all file 多 logical operation 的完整真相源。Round 103 建议为 `RouteMetaEntry` 增加 `emitRouteMeta?: boolean`，canonical spec 使用所有 entry，`generate-openapi-meta.ts` 按 file 分组且每组只允许一个 representative。Slice 1 测试面必须覆盖 director、leader.default 和 writer；`get_agent_profile` 只能证明 toolKeys/schema summary，不能证明 tool description；brief tool 必须穿过 runtime tool、global registry、profile typed binding、director toolset 和 compiled artifact；brief HTTP route 推荐 `GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=`；当前 system/user director artifact 仍是旧 `33e5a16f...`。Round 104-106 将 `ChapterWriterBriefService` 的 read model 与状态矩阵收拢：新增 `findChapterScenesForBrief()`，一次取得 Thread `summary/writingTip` 与 Scene `writingTip`；保留 `getSceneWorldContext(sceneId)` HTTP strict 语义，同时在 `SceneWorldContextService` 内新增 Scene 实体级 helper 供 brief 复用；brief status fixture 按 path error -> `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready` 聚合，空但有效的 World Context 不阻断 writer handoff。Round 96 进一步确认 `ChapterWriterBriefService` 应作为 Plot 模块内的深 read model Module，同级接入 `SceneWorldContextService`，通过专用 `findChapterScenesForBrief()` 一次取得 thread summary/writingTip 与 Scene writingTip，DTO 归属 `shared/dto/plot.dto.ts`，HTTP/tool 层只做 adapter。Round 97 确认现有 `getSceneWorldContext(sceneId)` 是 HTTP 严格入口，brief 不应逐 Scene 直接串它；应在 `SceneWorldContextService` 内新增 Scene 实体级 context helper 供 brief 复用，缺 anchor 由 brief 主动聚合为 status/warning，暂不提前引入批量 Interface。Round 98 修正 Round 54 的 DTO 草案：`ChapterWriterBriefSceneDtoSchema` 不应只复用 `ChapterPlotSceneDtoSchema`，因为后者缺 Scene `writingTip`；brief scene item 应显式携带 Scene writingTip 与 Thread summary/writingTip，tool text 应返回 `suggestedBriefMarkdown`，完整 DTO 放 `details`。Round 99 固定 renderer seam：`suggestedBriefMarkdown` renderer 第一版是 `ChapterWriterBriefService` 内部 implementation detail，用 section marker、positive/negative assertions 锁信息边界，暂不抽 shared Module。Round 100 确认这些修正不改变实现入口顺序：仍应先做 Profile Contract Cleanup，再做 OpenAPI Explicit Path、Chapter Writer Brief Module 和 Agent Tool Binding。Round 101 锁定 Slice 1 当前补丁面：`builtin-contracts.ts`、system/user director、leader.default、writer、三份 reference 和 profile tests 都要同步，不能留下 active user shadow。

Round 125-127 将 Slice 2 的 OpenAPI explicit path 门禁继续压实到当前代码缺口：`RouteMetaEntry.file` 只能表示物理 route file，新增 `path?: string` 表示公开 OpenAPI path，新增 `emitRouteMeta?: boolean` 表示该 entry 是否可作为 route-local representative。canonical spec 必须使用所有 entry，并通过 `buildOpenAPISpecForRoutes(entries)` 这类测试友好 Interface 证明 explicit path 覆盖 catch-all file、同一物理 file 可拥有多个 public paths、path/query params 同时生成且 duplicate `path + method` 直接失败。route-local `defineRouteMeta` 不是 canonical proof，`generate-openapi-meta.ts` 应按 file 分组，每组 0 个 representative 跳过、1 个注入、多个直接失败，避免当前同文件多 entry silent last-wins。未来 `chapter-writer-brief` entry 可先标记 `emitRouteMeta: false`，不影响 world-context representative，但 `/_openapi.json` 仍应能表达两个 logical operation。

Round 128 进一步确认 Slice 2 已经有两个真实 Adapter：canonical `generateOpenAPISpec()` 与 route-local `generate-openapi-meta.ts`。因此 public path、path params、query/body/response 规则应集中到一个共享 OpenAPI operation builder Module，而不是在两个文件中各写一套。实现顺序应为 `RouteMetaEntry.path/emitRouteMeta` -> 共享 operation builder -> `buildOpenAPISpecForRoutes()` + duplicate guard -> route-local representative selector -> 窄测试。`generate-openapi-meta.ts` 当前 `main()` 无条件执行，不适合直接 import 测试；实现时应先抽纯函数或加 ESM main guard，文件写入保留在 CLI Adapter 内。

Round 129-130 回到 Slice 1 / Slice 3 的当前实现差距：Profile Contract Cleanup 的强证据应分散在三个测试 seam 上，director 证明 `DirectorOutputSchema` strict 和旧 simulator gate 消失，leader.default 证明 Scene / Chapter / writer brief 结构任务可路由 director 且不持有 Plot tools，writer 证明无 Plot tools但可消费上游 Scene / World Context brief。Brief Module 方面，当前 `ChapterPlotDetailDto` 是 UI Interface，缺 Thread summary/writingTip 与 Scene writingTip；`SceneWorldContextService.getSceneWorldContext()` 是 HTTP strict Adapter，缺时间会抛错，不适合由 brief service 捕获 error message 串调用。`ChapterWriterBriefService` 应新增 `findChapterScenesForBrief()` read model，并在 `SceneWorldContextService` 内复用 Scene 实体级 helper，集中 status precedence、warnings 和 `suggestedBriefMarkdown` renderer。

Round 131 回到 Slice 4 的当前实现差距：源码中仍无 `ChapterWriterBriefService`、`ChapterWriterBriefDtoSchema`、`PlotFacade.getChapterWriterBrief()` 或 `get_chapter_writer_brief` runtime tool；`buildAgentTools()`、`builtin.plot`、director toolset 和 compiled artifact 也都未接入。brief tool 必须是 selection-free 浅 Adapter：参数只含 `{projectPath, chapterPath}`，调用 facade，`content[0].text` 返回 `suggestedBriefMarkdown`，完整 DTO 放 `details`；业务状态、warnings 和 markdown renderer 必须留在深 `ChapterWriterBriefService` Module 内。`get_agent_profile` 只能证明 director `toolKeys` 可发现，不能证明 tool description 或 workflow 文案；后者要由 runtime definition 和 director prompt/reference 单独验收。

Round 132 将 Slice 1 的开工入口压到当前 worktree：`DirectorOutputSchema`、system/user director source、leader.default prompt/reference、writer prompt/comment、profile tests、active user compiled manifest 都仍处于旧合同状态。实现 `Profile Contract Cleanup` 时应先改 schema strict，再改 director source，再改 leader/reference，再改 writer 语言，随后补 director / leader / writer 三层测试，最后用 profile sync/compile 验证 active user source 与 compiled artifact；当时 assets 侧已有 `writer.profile.test.ts` 覆盖 writer tool isolation，但缺少 server 侧 writer profile contract test，Scene / World Context brief consumption 断言仍需要新增或明确放入现有测试面。Round 142 已将 writer profile contract 迁移到 server 侧测试，assets 侧该测试不再作为门禁。

Round 133 将 Slice 2 的实现入口压到当前 OpenAPI 源码：`RouteMetaEntry` 仍无 `path/emitRouteMeta`，`generate-spec.ts` 仍从 file 推导 path 且同 path/method silent overwrite，`generate-openapi-meta.ts` 仍复制 operation 生成逻辑、无条件执行 `main()`，同一 physical file 多 entry 会 route-local last-wins；`server/api/projects/plot/[...segments].ts` 当前 `defineRouteMeta` 只有 query `projectPath`，没有 path `sceneId`。实现时应先拆 `file` 与 public `path`，抽共享 operation builder，再分别改 canonical spec Adapter 和 route-local representative Adapter；`chapter-writer-brief` entry 应等 Slice 3 DTO 存在后再加，Slice 2 可用 synthetic entries 测同 file 多 public path。

Round 137 已完成 Slice 2 `OpenAPI Explicit Path`：`RouteMetaEntry` 新增 `path?: string` / `emitRouteMeta?: boolean`，canonical spec 与 route-local metadata 共用 `server/openapi/operation-builder.ts`，`buildOpenAPISpecForRoutes(entries)` 会拒绝重复 `path + method`；`generate-openapi-meta.ts` 改为按 physical file 选择唯一 representative 且测试导入不执行写文件。Plot route-map 已从旧 `novels/[novelId]/plot/**` physical files 迁到真实 `projects/plot/[...segments].ts` + explicit `projects/plot/**` public paths；`bun run generate:openapi` 结果为 40 updated / 0 failed，`server/api/projects/plot/[...segments].ts` 的 generated metadata 已包含 `sceneId` path param。下一步进入 Slice 3 `Chapter Writer Brief Module`，不要跳到 Agent tool binding。

Round 134 将 Slice 3 的实现入口压到当前 Plot Module：`ChapterPlotDetailDto` 是 UI Interface，缺 Scene `writingTip` 和 Thread `summary/writingTip`；`findChapterScenes()` 只 select thread `id/title/isMainThread`；`SceneWorldContextService.getSceneWorldContext()` 是 HTTP strict Adapter，缺时间会抛错，不适合 brief service 捕获错误 message 进行状态聚合。`ChapterWriterBriefService` 应作为 `SceneWorldContextService` 同级深 Module 接入，落地顺序为 DTO -> repository `findChapterScenesForBrief()` -> Scene entity-level World Context helper -> service/status/markdown renderer -> facade -> HTTP route -> route-map/OpenAPI。

Round 138 已完成 Slice 3 `Chapter Writer Brief Module`：新增 `ChapterWriterBriefDtoSchema` / `ChapterWriterBriefSceneDtoSchema` / status schema，`SceneRepository.findChapterScenesForBrief()` 一次取得 Scene + Thread `summary/writingTip`，`SceneWorldContextService` 新增 `getSceneWorldContextForScene()` 实体级 helper，`ChapterWriterBriefService` 集中 status/warnings/`suggestedBriefMarkdown` renderer，`PlotFacade.getChapterWriterBrief()` 与 `GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=` 已落地。OpenAPI canonical spec 已包含 brief route，`emitRouteMeta: false`，route-local representative 仍为 world-context。聚焦测试 21 项通过，DTO 测试 2 项通过，`generate:openapi` 为 40 updated / 0 failed。随后进入 Slice 4 Agent Tool Binding，并已在 Round 139 完成。

Round 139 已完成 Slice 4 `Agent Tool Binding`：新增 `get_chapter_writer_brief` runtime tool，并同步 `buildAgentTools()` registry、`builtin.plot.getChapterWriterBrief` typed binding、system/user director toolset 和 prompt；tool text 返回 `suggestedBriefMarkdown`，完整 DTO 放 `details`，且不读写 `plot.selection`。server 侧 writer isolation 已补断言，当前 system/user writer artifact 的 `rootToolKeys` 仍只有 `read/write/edit/bash/execute_world/report_result`。聚焦 agent tool/profile tests 22 项通过，builtin tools smoke 2 项通过；profile artifact compile/status/check 均通过，当前 system/user director artifacts 均含 `get_chapter_writer_brief` / `suggestedBriefMarkdown` 且不含旧 `simulator_requests` / `Simulation gate`。真实 Agent 模型行为 smoke 尚未执行，因此只能声明静态合同和 compiled runtime 证据成立。

Round 140 完成 completion audit：逐项核对 Task 78 原始桥接目标、Agent 易用性四个实现切片、profile architecture、runtime artifact 和剩余风险。聚焦回归测试 13 files / 62 tests passed。真实 Agent 模型行为 smoke 与浏览器验证未执行；前者仅影响“模型是否会主动选最优路由”的行为质量声明，后者不是当前完成门禁。ChapterOverride 明确不属于 Task 78，已交给 Task 80。Task 78 / active goal 可以判定完成。

## Draft Data Shape

### Scene World Anchor

**设计决策（2026-06-29）**：

1. `startInstant/endInstant` 允许 nullable —— Scene 可以先创建（规划阶段），稍后再连接到 World Engine 时间线。
2. 只用一个 `subjectIds` 字段记录所有相关 subjects，不区分 POV/active/mentioned。
3. 地点只需要一个 `locationSubjectId`，通常 Scene 只涉及单个地点。

服务层使用 World Engine 的 `Instant` 类型：

```ts
import type {Instant} from "nbook/server/world-engine/types";

type SceneWorldAnchor = {
    /** World Engine 时间范围起点（nullable） */
    startInstant: Instant | null;
    /** World Engine 时间范围终点（nullable） */
    endInstant: Instant | null;
    /** 出场的所有 subjects */
    subjectIds: string[];
    /** 地点 subject ID（nullable） */
    locationSubjectId: string | null;
};
```

Prisma 持久化形态：

```prisma
model StoryScene {
  // ... 现有字段 ...
  
  // World Engine 桥接字段
  startInstant       BigInt?           // World Engine 时间范围起点（nullable）
  endInstant         BigInt?           // World Engine 时间范围终点（nullable）
  subjectIdsJson     String   @default("[]")  // 出场 subjects JSON array
  locationSubjectId  String?           // 地点 subject ID（nullable）
  
  // ... 其他字段 ...
  
  @@index([startInstant])  // 支持按时间范围查询
}
```

约束规则：

- `startInstant` / `endInstant` 为 `null` 表示 Scene 暂未连接 World Engine 时间线。
- 当两者都存在时，`startInstant <= endInstant`（服务层校验）。
- `subjectIdsJson` 是 JSON array，第一版使用 JSON 存储；后续若需要强查询、约束和引用完整性，再考虑拆独立 `StorySceneSubject` join table。
- `locationSubjectId` 为 `null` 表示该 Scene 未指定地点（如抽象场景、内心独白等）。

HTTP / 前端 DTO 使用项目日历字符串：

```ts
type StorySceneWorldAnchorDto = {
    /** 项目日历字符串（nullable） */
    startTime: string | null;
    /** 项目日历字符串（nullable） */
    endTime: string | null;
    /** instant 字符串形式（用于调试、排序或避免精度损失） */
    startInstant: string | null;
    /** instant 字符串形式（用于调试、排序或避免精度损失） */
    endInstant: string | null;
    /** 出场 subjects */
    subjectIds: string[];
    /** 地点 subject ID（nullable） */
    locationSubjectId: string | null;
    /** 读取 DTO：解析后的出场 subject 展示对象 */
    subjects: Array<{id: string; name: string; type: string; resolved: boolean}>;
    /** 读取 DTO：解析后的地点 subject，未设置地点时为 null */
    locationSubject: {id: string; name: string; type: string; resolved: boolean} | null;
    /** 读取 DTO：尚未接入 World Engine 的占位 subject ID */
    unresolvedSubjectIds: string[];
};
```

DTO 规则：

- `startTime` / `endTime` 由 `worldEngineFacade.formatTime(projectPath, instant)` 生成；为 `null` 时表示未连接 World Engine。
- 缺少 `world-engine/calendar.ts` 时，Plot 读取保留 raw `startInstant/endInstant`，但 `startTime/endTime` 降级为 `null`；这表示 Project 尚未具备展示日历，不表示 anchor 被删除。
- 如果 `calendar.ts` 存在但配置损坏，且当前读取需要格式化 raw instant，应继续抛出错误，避免隐藏真实配置问题。
- 写入请求接收项目日历字符串，由 `worldEngineFacade.parseTime(projectPath, input)` 转成 `Instant`。
- 写入 DTO 不要求 `subjects/locationSubject/unresolvedSubjectIds`；这些字段只出现在读取 DTO 中。
- `startInstant` / `endInstant` 只作为调试、稳定排序或前端避免精度损失时的字符串字段；普通 UI 不展示 raw instant。
- `subjectIds/locationSubjectId` 允许先保存占位 ID；读取 DTO、Scene World Context、UI 和 Agent 工具必须显式暴露 unresolved 状态，不得静默吞掉。

## UI/UX Design

### 整体布局

Plot Workbench 保持三栏布局（Sidebar + Scene List + Inspector），在现有基础上增加 World Engine 连接功能。

### Scene Card 改动（中栏）

**新增 World Engine 连接状态指示器**：

- **已连接状态**：

  - 🕒 时间范围：`公元2020年4月12日 18:00 ~ 20:00`
  - 📍 地点：显示 subject name（如果有）
  - 👤 出场：显示 subjects 数量（如 `出场 2 人`）
- **未连接状态**：

  - 🔗 图标 + "未连接到世界引擎" 灰色提示

### Inspector 面板改动（右栏）

**新增 Scene 编辑时的 World Engine 连接区域**：

1. **时间范围选择**：

   - 两个文本输入框：startTime / endTime
   - 支持项目日历格式（如 `公元2020年4月12日 18:00`）
   - 留空表示未连接 World Engine
   - 格式提示文本
2. **出场 Subjects 选择**：

   - 多选下拉列表（`SubjectMultiSelect` 组件）
   - 调用 API 获取项目所有 World Engine subjects
   - 显示 subject name + ID
   - 支持搜索过滤
3. **地点选择**：

   - 单选下拉列表（`SubjectSingleSelect` 组件）
   - 可选过滤 `type="location"` 的 subjects
   - 可留空
4. **World Engine 上下文预览**：

   - 按钮："查看 World Engine 上下文"（手动触发）
   - 点击后展开 `WorldEngineContextPanel` 组件
   - 展示时间范围内的 slices 和角色状态
   - 提供快捷跳转："在 World Engine Workbench 中打开"

### 新增组件

#### `WorldEngineContextPanel`

展示 Scene 查询到的 World Engine 上下文：

- **时间线 Slices**：列表显示时间范围内的所有 slices（时间、summary、patch 数量）
- **出场角色状态**：显示每个 subject 的当前状态（位置、HP、关键属性）
- **快捷跳转**：按钮跳转到 World Engine Workbench

#### `SubjectMultiSelect` / `SubjectSingleSelect`

Subject 选择器组件：

- 下拉列表展示所有 World Engine subjects
- 显示 subject name + ID
- 支持搜索过滤
- 多选（SubjectMultiSelect）或单选（SubjectSingleSelect）

### 交互流程

#### 流程 A：创建 Scene 并连接 World Engine

1. 用户点击 "创建 Scene" 按钮
2. 弹出 Scene 创建对话框（现有字段 + World Engine 连接字段）
3. 用户可以：
   - 立即填写时间范围（如果已知）
   - 留空时间范围（先规划，稍后填充）
4. 保存后，Scene Card 显示连接状态

#### 流程 B：编辑 Scene 并查看 World Engine 上下文

1. 用户点击 Scene Card，右侧 Inspector 展开
2. Inspector 显示 World Engine 连接区域
3. 用户点击 "查看 World Engine 上下文" 按钮
4. 触发查询，展示 `WorldEngineContextPanel`
5. 用户可查看 slices、角色状态，或跳转到 World Engine Workbench

### UX 决策

1. **Subject 选择器**：第一版使用下拉列表（适合 subjects < 100），后续可升级为自动完成输入框。
2. **World Engine 上下文展示**：第一版使用手动触发（点击按钮），节省性能，后续可改为自动加载。
3. **时间范围输入**：第一版使用文本输入框 + 格式提示，后续可升级为日期时间选择器。

## Verification / Test / Continued Audit

- `bun run typecheck`：通过。
- 聚焦测试通过：
  - `bunx vitest run shared/reference-trigger.test.ts server/content/content-middleware.test.ts app/utils/plain-reference-text.test.ts server/plot server/workspace-files/project-workspace.test.ts server/agent/tools/plot-tools.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/simulation-director-profiles.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`
  - 结果：16 个测试文件通过，73 个测试通过。
- `server/plot/services/scene-world-context.service.test.ts` 直接覆盖 Scene World Context 的时间范围、subject/location 去重、无关 patch 过滤、未连接时间错误和空 subject 行为。
- `server/plot/services/scene-world-anchor-resolution.service.test.ts` 覆盖 Scene World Anchor 读取解析：resolved subject name/type、missing subject unresolved、location 三态、缺 calendar 降级和坏 calendar 抛错。
- `server/api/projects/plot/[...segments].test.ts` 覆盖无 `calendar.ts` 的 Project 仍可读取 `tree/workbench`、占位 subject unresolved、raw instant 保留，以及坏 calendar 在需要格式化时继续报错。
- `server/workspace-files/project-workspace.test.ts` 直接覆盖旧 `StoryPlot` 真实 SQLite 迁移：备份 JSON、合并到 Scene、删除旧表、清理 `plot://` ref、保留 scene ref。
- 默认 5 秒或 20 秒 Vitest timeout 下，`server/agent/profiles/leader-assets-profile.test.ts` 的 profile catalog 慢测可能超时；使用 `--testTimeout 60000` 后聚焦集合全部通过，判断为慢测预算问题，不是断言回归。
- 已补正的横向测试期望：
  - `server/agent/profiles/rp-profiles.test.ts`：同步 Scene-only 路由文案，并改读归档后的 `templates/archived/project-directory-templates/simulation/`。
  - `server/workspace-files/workspace-files.test.ts`：同步新 World Engine 默认模板（`types:` schema、gregorian calendar、EmbeddingText `{text}` 写入）。
  - `server/agent/profiles/profile-compile-worker.test.ts`：修复 `.compiled` 快照只还原 manifest、不还原 artifact 文件导致的 hash mismatch。
  - `server/agent/harness/neuro-agent-harness.test.ts`：同步当前 request_user_input skip 文案、invoke_agent tool result 结构和 compaction 持久化语义，并为 steer/followup race 用例补稳定 running 窗口。
- 已单独验证通过：
  - `bunx vitest run server/agent/profiles/rp-profiles.test.ts server/agent/profiles/simulation-director-profiles.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`：2 个测试文件通过，12 个测试通过。
  - `bunx vitest run server/workspace-files/workspace-files.test.ts -t "小说目录模板会创建最小 lorebook 骨架|创建 Project Workspace 时会写入 manifest" --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`：2 个目标用例通过。
  - `bunx vitest run server/workspace-files/workspace-files.test.ts -t "前端同步 preflight 会先刷新过期 system profile manifest" --testTimeout 120000 --hookTimeout 120000 --exclude "product/**"`：目标用例通过。
  - `bunx vitest run server/agent/tools/task-tools.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`：2 个测试通过。
  - `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts --testTimeout 120000 --hookTimeout 120000 --exclude "product/**"`：10 个测试通过。
  - `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts --testTimeout 120000 --hookTimeout 120000 --exclude "product/**"`：147 个测试通过。
  - `bunx vitest run server/agent/harness/neuro-agent-harness.black-box.test.ts --testTimeout 120000 --hookTimeout 120000 --exclude "product/**"`：17 个测试通过。
- 全量源测试通过：
  - `bunx vitest run --fileParallelism=false --testTimeout 120000 --hookTimeout 120000 --exclude "product/**"`
  - 结果：144 个测试文件通过、1 个跳过；1202 个测试通过、3 个跳过。
- 继续探索审计（2026-06-29 晚间）：
  - `bun run typecheck`：失败。
  - 当时真实失败面已收窄：前端 empty anchor helper、Preview workspace、`SceneWorldContextService` 和相关测试已经补齐 `subjects/locationSubject/unresolvedSubjectIds`；剩余失败只在 `PlotFacade.parseWorldAnchorDto()` 参数类型仍使用输出 DTO，导致写入请求的 `StorySceneWorldAnchorInputDto` 被错误要求携带只读 subject resolution 字段。
  - 该失败不是本轮文档探索引入的业务代码改动；详见 [Round 05](walkthroughs/2026-06-29-round-05-dto-drift-and-subject-resolution.md) 与 [Round 08](walkthroughs/2026-06-29-round-08-dto-drift-fix-plan.md)。
- 继续探索复核（2026-06-29 更晚，历史状态）：
  - `PlotFacade.parseWorldAnchorDto()` 当前已经接收 `StorySceneWorldAnchorInputDto`，Round 08 的 DTO P0 修复点已在当前 worktree 完成。
  - 当时 `bun run typecheck` 仍失败，但失败位置变为 `assets/workspace/.nbook/agent/skills/llmlint/src/reporter.ts` 与 `assets/workspace/.nbook/agent/skills/llmlint/src/rules.ts`，不再是 Plot / World Anchor DTO；详见 [Round 11](walkthroughs/2026-06-29-round-11-current-state-and-profile-contract-baseline.md)。本轮 Scene / World Engine 桥接补完验证已重新通过 `bun run typecheck`。
- 入口修复验证（2026-06-29）：
  - `bunx vitest run app/utils/novel-writing-mode-entries.test.ts app/components/novel-ide/rag/NovelRagPanel.contract.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`：2 个测试文件通过，7 个测试通过。
  - `bun run typecheck`：通过。
  - 本地 dev server + headless Edge CDP 浏览器验证通过：桌面 1440x900 下顶栏 `PLOT` / `剧本工作台` 可见；左侧侧栏 `Plot` 可见，点击后真实 DOM 切到“剧情”工具面板并显示 Thread / Scene 区域。
- 入口复验补修（2026-06-29）：
  - `bun test app/utils/novel-writing-mode-entries.test.ts`：4 个测试通过，覆盖顶栏 / Plot 面板入口、Agent 模式侧栏 Plot 快捷入口、Plot World Context 打开真实 World Engine Workbench 的事件链。
  - `bun run typecheck`：通过。
  - 本地 dev server + Chrome headless 浏览器验证通过：桌面 1440x900 下顶栏 `PLOT` 可见，点击后 `plot-panel-workbench-entry` 可见且 `剧本工作台` Dialog 弹出；移动窄屏 430x900 下 `PLOT` 按钮位于视口内（x=246,width=89），点击后 Plot 面板工作台入口可见。
  - 发现并修复实际偏差：启动初期 `currentNovelId` 尚未初始化时点击 Plot 会被旧保护条件吞掉；小屏下按钮虽未被 CSS 隐藏，但会被顶栏固定宽度内容挤出视口。
- Scene / World Engine 桥接补完验证（2026-06-29）：
  - `bunx vitest run server/api/projects/plot/[...segments].test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`：1 个测试文件通过，6 个测试通过。覆盖 `GET /api/projects/plot/scenes/:sceneId/world-context` 成功路径、缺 `projectPath`、非法 `sceneId`、Scene 不存在、时间未连接和 unresolved subject 响应 shape。
  - `bunx vitest run shared/dto/plot.dto.test.ts server/plot/assemblers/plot-dto.assembler.test.ts server/plot/services/scene-world-context.service.test.ts server/api/projects/plot/[...segments].test.ts server/agent/tools/plot-tools.test.ts app/utils/novel-writing-mode-entries.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`：6 个测试文件通过，23 个测试通过。覆盖 DTO/assembler、Scene World Context service、HTTP API、Agent 工具输出和前端入口/警告态。
  - `bun run typecheck`：通过。
  - 发现并修复实际偏差：Plot 写事务提交前解析 World Engine subjects 会在 SQLite 上触发 `SQLITE_BUSY`；已将 Scene 创建、更新和重排后的 World Anchor 展示解析移到事务提交之后。
  - `server/agent/profiles/leader-assets-profile.test.ts` 的单个 profile catalog 慢测仍可能按测试自身 20 秒预算超时；这与本轮 Plot 桥接断言无关，沿用既有慢测风险记录。

## Implementation Walkthrough

- 2026-06-29: 根据用户确认创建本任务。当前只记录设计方向，不修改业务代码。
- 2026-06-29: 调研 World Engine 时间契约后同步设计：Scene 底层时间对齐 `Instant = bigint` / Prisma `BigInt`，HTTP / DTO 继续使用项目日历字符串，第一期 Scene 范围查询采用闭区间以复用现有 World Engine `from/to` 语义。
- 2026-06-29: 整体审查任务现状，识别关键阻塞点与技术风险。
- 2026-06-29: 完成 Scene World Anchor 数据结构设计决策：`startInstant/endInstant` 允许 nullable（先规划后连接）、只用 `subjectIds` 不区分角色、单个 `locationSubjectId`。
- 2026-06-29: 完成 TypeScript 类型、DTO schema、Prisma schema 设计。
- 2026-06-29: 完成 Plot Workbench UI/UX 设计：Scene Card 新增 World Engine 状态指示器、Inspector 新增连接编辑区域、新增 `WorldEngineContextPanel` 和 Subject 选择器组件。第一版 MVP 范围明确。设计阶段完成。
- 2026-06-29: 落地 Scene World Anchor 数据层、DTO、Repository / Service / Facade / HTTP parser，Scene 创建和更新 payload 支持 World Anchor。
- 2026-06-29: 删除正式 `StoryPlot` 模型、后端 Plot CRUD、Agent Plot 写入工具和 `plot://` 新引用入口；旧项目迁移逻辑负责备份合并旧 StoryPlot 并清理旧 refs。
- 2026-06-29: 新增 `SceneWorldContextService` 和 `GET /api/projects/plot/scenes/:sceneId/world-context`，按 Scene 时间范围与 subjects / location 收窄 World Engine 上下文。
- 2026-06-29: Plot Workbench Inspector 接入 World Engine 连接编辑、Subject 选择器和上下文面板；单 Thread 面板、Chapter 视图、Timeline 预览和 Workbench 预览同步 Scene-only。
- 2026-06-29: 更新 `reference/plot` 和项目状态文档，重新定义 Scene 为最小剧情单位，World Engine patch 负责事实推进。
- 2026-06-29: 补强验证：新增 `SceneWorldContextService` 单元测试证明按时间范围 + subjects / location 收窄，并新增真实 SQLite 旧 `StoryPlot` 迁移测试。测试暴露旧库初始化时 `StoryScene_startInstant_idx` 早于补列创建的问题；已将该索引统一交给补列迁移创建，运行时入口和脚本入口同步修复。
- 2026-06-29: 收尾验证中清理旧 Plot 语义残留：`reference/agent/profile-routing.md` 和 `simulator.leader` profile 不再描述长期 `Thread / Scene / Plot` 或 `Plot 落库`，改为 Thread / Scene 与 Scene / Plot System；同步 RP profile 测试、World Engine 新模板测试和 profile compile worker 快照测试。
- 2026-06-29: 完成全量验收收尾：修正 agent harness 旧行为断言与 steer/followup race 测试，`bun run typecheck`、Task 78 聚焦集合和全量源测试全部通过。实际结果相对原计划的出入：未做浏览器验证；验收改用类型检查、服务/迁移/Agent/Profile/Workbench 相关单元测试和全量 Vitest 证明。
- 2026-06-29: 根据用户复验反馈“前端看不到 Plot 工作台入口”，恢复普通写作入口中的 Plot 可达性：`NOVEL_IDE_TABS` 增加 `plot`，左侧侧栏显示 Plot 图标并挂载 `NovelPlotPanel`，顶栏新增 `PLOT` / `剧本工作台` 按钮，点击时切到 Plot tab 并打开现有 `PlotWorkbenchDialog`。RAG / simulation 入口仍保持隐藏。实际结果相对前一轮 walkthrough 的出入：这次补做了浏览器验证，并确认旧记录中的“未做浏览器验证”已不再适用。
- 2026-06-29: 根据用户再次复验“前端甚至没有看到 plot 工作台入口”，补齐入口的真实可达性：顶栏 Plot 按钮取消 `md` 断点隐藏并压缩小屏 Header 布局；Agent 模式侧栏增加 Plot 快捷入口，点击后切回 IDE Plot 面板；Plot 面板内新增 `剧本工作台` 明确入口；`openPlotWorkbench` 不再因为 Project 初始化早期 `currentNovelId` 为空而吞掉点击；`WorldEngineContextPanel` 新增“打开”按钮并通过显式事件链关闭 Plot 工作台、打开真实 World Engine Workbench。实际结果相对上一轮 walkthrough 的出入：上一轮只证明桌面已可达，这轮补上了启动竞态、小屏视口和 Plot→World Engine 跳转。
- 2026-06-29: [Goal file current state audit](walkthroughs/2026-06-29-goal-file-current-state-audit.md) 读取 Codex goal objective 附件后按当前 worktree 审计 Task 78；确认实现证据仍成立，聚焦验证 `4` 个测试文件、`13` 个测试通过。本轮未改业务代码，只补齐 `walkthroughs/` 轮次记录。
- 2026-06-29: [Round 02 Agent tool routing audit](walkthroughs/2026-06-29-round-02-agent-tool-routing-audit.md) 继续探索 Agent 易用性。新发现：后端/UI 桥接完成，但 `leader.default` 没有 Plot tools 且 prompt 仍把 Plot 当旧系统排除；`director` 有 Plot tools 但没有 `execute_world`，且 prompt 残留 simulator gate；writer 保持只读 World Engine 且忽略 Plot payload。因此下一步重点应是 Agent 路由与提示词拓扑修正。
- 2026-06-29: [Round 03 Workflow reconciliation options](walkthroughs/2026-06-29-round-03-workflow-reconciliation-options.md) 对比 World Engine first、Plot Scene first、Chapter-centric brief、Unified Story Transaction 四种工作流；推荐采用“探索/规划 → canonization → chapter handoff → post-write reconciliation”的分阶段协议。
- 2026-06-29: [Round 04 Next architecture slices](walkthroughs/2026-06-29-round-04-next-architecture-slices.md) 提出后续架构切片：P0 文档/Prompt 对齐，P1 聚合 writer brief 工具，P2 director World Context 边界决策，P3 Chapter Override / WriterBriefService。
- 2026-06-29: [Round 05 DTO drift and subject resolution audit](walkthroughs/2026-06-29-round-05-dto-drift-and-subject-resolution.md) 原计划继续看聚合 brief 落点，实际先发现 DTO 契约漂移：World Anchor 输出 DTO 已加入 subject resolution 字段，但当时多处前端 mock、Facade 输入类型和 Scene World Context 服务未同步，导致 `bun run typecheck` 失败。后续 Round 08 重新核对后，当时失败面已收窄到 Facade 输入类型边界。
- 2026-06-29: [Round 06 Chapter writer brief design](walkthroughs/2026-06-29-round-06-chapter-writer-brief-design.md) 设计 `get_chapter_writer_brief` / `ChapterWriterBriefService`：作为只读聚合层，汇总 chapter scenes、thread summary、resolved anchors、Scene World Context、warnings 和 writer query hints，不写 Plot/World Engine，不替用户确认 canon。
- 2026-06-29: [Round 07 Profile reconciliation and test plan](walkthroughs/2026-06-29-round-07-profile-reconciliation-and-test-plan.md) 收敛 P0 profile/prompt 修正方案：优先保持 director specialist route，不急着给 `leader.default` 加 Plot tools；修正普通写作 workflow、leader prompt、director prompt 和对应 profile contract tests。
- 2026-06-29: [Round 08 DTO drift fix plan](walkthroughs/2026-06-29-round-08-dto-drift-fix-plan.md) 重新验证当时 worktree，确认 DTO drift 已被部分修复；当时 `bun run typecheck` 只剩 `PlotFacade.parseWorldAnchorDto()` 输入/输出 DTO 类型混用，应先以最小补丁改接 `StorySceneWorldAnchorInputDto`。
- 2026-06-29: [Round 09 Scene World Anchor Resolution Service](walkthroughs/2026-06-29-round-09-scene-world-anchor-resolution-service.md) 设计 `SceneWorldAnchorResolutionService`：统一 `subjectIds/locationSubjectId` 的 resolved/unresolved 解析，供 Facade 输出、Scene World Context 和后续 chapter writer brief 复用；推荐在 P0 typecheck 修复后单独落地。
- 2026-06-29: [Round 10 Chapter Writer Brief API Contract](walkthroughs/2026-06-29-round-10-chapter-writer-brief-api-contract.md) 把 `get_chapter_writer_brief` 推进到 HTTP route、DTO、OpenAPI、Agent tool 和测试合同；推荐作为 P2 只读聚合层，第一期只给 director 暴露。
- 2026-06-29: [Round 11 Current State and Profile Contract Baseline](walkthroughs/2026-06-29-round-11-current-state-and-profile-contract-baseline.md) 重新核对当时 worktree，确认 Round 08 的 Facade input DTO 修复点已完成；当时全局 typecheck 失败转移到 llmlint skill。记录 profile 合同基线：`builtin.plot` 还没有 `get_chapter_writer_brief`，leader prompt / routing 仍排除 Plot/director，director 仍有 simulator gate 和 `plot` kind。
- 2026-06-29: [Round 12 Profile Topology Options](walkthroughs/2026-06-29-round-12-profile-topology-options.md) 对比 Leader Monolith、Current Director Specialist、Director + Brief Compiler、Director Readonly World、新 Story Coordinator 五种 profile 拓扑；推荐 Director + Brief Compiler。
- 2026-06-29: [Round 13 Profile Migration and Acceptance Matrix](walkthroughs/2026-06-29-round-13-profile-migration-and-acceptance-matrix.md) 把推荐拓扑拆成 P1 prompt/routing 去 simulator 化、P2 director 输出合同清理、P3 `get_chapter_writer_brief` tool、P4 subject resolution consolidation 和测试矩阵。
- 2026-06-29: [Round 14 Brief Tool Implementation Boundary](walkthroughs/2026-06-29-round-14-brief-tool-implementation-boundary.md) 明确 `get_chapter_writer_brief` 可在 Task 78 先做 scene/world-only v1，Task 80 后续扩展 ChapterOverride；不把 POV/tone/info-control 提前塞回 Task 78。
- 2026-06-29: [Round 15 Profile Prompt Migration Patch Plan](walkthroughs/2026-06-29-round-15-profile-prompt-migration-patch-plan.md) 将 profile 迁移拆成 reference routing、builtin prompts、director output schema 和 profile tests 四组补丁；先修认知再加工具。
- 2026-06-29: [Round 16 OpenAPI Catch-all Route Risk](walkthroughs/2026-06-29-round-16-openapi-catch-all-route-risk.md) 确认当前 OpenAPI generator 不能正确表达 `projects/plot/[...segments].ts` 的多语义 GET route；实现 brief route 前应给 `RouteMetaEntry` 增加显式 `path` override。
- 2026-06-29: [Round 17 Profile Test Impact Map](walkthroughs/2026-06-29-round-17-profile-test-impact-map.md) 把 P1 profile/routing 迁移映射到 `simulation-director-profiles.test.ts`、`leader-assets-profile.test.ts` 和可选轻量 profile routing 测试；建议用 TypeBox `Value.Check()` 锁定 `DirectorOutputSchema`。
- 2026-06-29: [Round 18 Brief Service Data Flow](walkthroughs/2026-06-29-round-18-brief-service-data-flow.md) 核对当前 `findChapterScenes()` 只含 thread title/isMain，确认 brief v1 需要新增 `ChapterWriterBriefService` 和更重的 chapter scene 查询，避免把业务逻辑写进 Agent tool。
- 2026-06-29: [Round 19 Subject Resolution Reuse Strategy](walkthroughs/2026-06-29-round-19-subject-resolution-reuse-strategy.md) 确认 subject resolution 目前分散在 assembler、facade 和 Scene World Context；建议实现 brief 前抽 `SceneWorldAnchorResolutionService`，统一 resolved/unresolved 语义。
- 2026-06-30: [Round 20 Profile Architecture Final Shape](walkthroughs/2026-06-30-round-20-profile-architecture-final-shape.md) 将最终 profile 架构收束为 Director + Brief Compiler：leader.default 负责用户/canon/World Engine，director 负责 Plot 与 brief 编译，writer 负责正文，world.engine 负责复杂世界引擎维护。
- 2026-06-30: [Round 21 Delegation Protocol](walkthroughs/2026-06-30-round-21-delegation-protocol.md) 明确 `create_agent.initial`、`invoke_agent.message`、`invoke_agent.input` 的分工，以及 leader -> director -> leader -> writer 的调用协议和失败处理。
- 2026-06-30: [Round 22 Writer Handoff Contract](walkthroughs/2026-06-30-round-22-writer-handoff-contract.md) 定义 `suggestedBriefMarkdown` 的结构、v1 能自动填的内容、不能假装知道的 ChapterOverride 字段，以及 writer 完成后的 World Engine / Plot 回补流程。
- 2026-06-29: 根据“Task 78 系统性补完计划”补齐 Scene ↔ World Engine 桥接闭环：读取 DTO 显式解析 `subjects/locationSubject/unresolvedSubjectIds`，Scene World Context 只查询已解析 subjects，UI/Agent 暴露 unresolved 警告；新增 Plot HTTP 集成测试；修正 Plot 写事务内解析 World Engine subjects 导致的 SQLite 锁库问题；文档把 `ChapterOverride` 从 Task 78 已完成范围降级为后续单列任务。
- 2026-06-30: [Round 23 Calendar-free Plot Read](walkthroughs/2026-06-30-round-23-calendar-free-plot-read.md) 修复 Plot 读取对 World Engine Calendar 的强依赖。真实根因是 Plot 聚合读取为了显示 subject name 调用 `worldEngineFacade.listSubjects()`，该入口构建完整 World Engine module 并加载 `calendar.ts`，导致未初始化 World Engine 的旧 Project 无法打开 Plot。本轮新增 `worldEngineFacade.listSubjectIdentities()` 和 `SceneWorldAnchorResolutionService`：Plot 读取只在缺 `calendar.ts` 时降级 formatted time，不吞掉坏 calendar；Scene World Context 的 subject resolved/unresolved 判断也改用 calendar-free identity，但实际 slices/state/time 查询仍保留 World Engine 配置错误语义。
- 2026-06-30: [Round 24 Current Dependency Audit](walkthroughs/2026-06-30-round-24-current-dependency-audit.md) 重新核对当前 worktree，确认 `SceneWorldAnchorResolutionService` 已存在并被 Facade 复用；后续 brief v1 不应再新增 subject resolution 规则，Scene World Context 可按需进一步复用该 Interface。
- 2026-06-30: [Round 25 Profile Patch Sequence](walkthroughs/2026-06-30-round-25-profile-patch-sequence.md) 把 profile 落地拆为 reference 先行、builtin prompt、`DirectorOutputSchema` 三段；先修普通写作路由和 simulator gate，再加 brief tool。
- 2026-06-30: [Round 26 Brief V1 Status Contract](walkthroughs/2026-06-30-round-26-brief-v1-status-contract.md) 定义 `get_chapter_writer_brief` v1 的 `ready / needs_plot / needs_world_anchor / needs_world_context` 状态、DTO、service flow、HTTP/tool 落点和测试矩阵。
- 2026-06-30: [Round 27 Deepening Opportunities](walkthroughs/2026-06-30-round-27-deepening-opportunities.md) 用 Module / Interface / Depth / Locality 视角确认三个优先加深点：director contract、`ChapterWriterBriefService` 和 OpenAPI route metadata；query-oriented anchor resolution 仅在重复出现时再扩展。
- 2026-06-30: [Round 28 Tool Exposure Matrix](walkthroughs/2026-06-30-round-28-tool-exposure-matrix.md) 比较 Director-only、Director+leader readonly、Leader full Plot、Writer brief tool、world.engine brief tool 五种暴露方式；第一阶段采用 Director-only brief。
- 2026-06-30: [Round 29 Implementation Slices](walkthroughs/2026-06-30-round-29-implementation-slices.md) 把落地拆为 Profile Contract Cleanup、OpenAPI Explicit Path、Chapter Writer Brief Module、Agent Tool Binding 和后置可选 Leader Readonly Brief 五个切片。
- 2026-06-30: [Round 30 Profile Architecture Spec](walkthroughs/2026-06-30-round-30-profile-architecture-spec.md) 固化第一阶段 profile architecture spec：leader 负责 canon/World Engine，director 负责 Plot/brief，writer 只写正文，world.engine 只维护 World Engine；工具矩阵采用 Director-only brief。
- 2026-06-30: [Round 31 Scenario Walkthroughs](walkthroughs/2026-06-30-round-31-scenario-walkthroughs.md) 用规划并写一章、unresolved subject、缺时间范围、calendar 损坏、writer 写出新事实、leader 快速查看 brief 六个场景验证调用协议。
- 2026-06-30: [Round 32 Completion Audit Matrix](walkthroughs/2026-06-30-round-32-completion-audit-matrix.md) 建立完成审计矩阵：Scene/World Engine 桥接和架构设计已证明，profile/tool 改造仍未实现，goal 不能标记完成。
- 2026-06-30: [Round 33 Profile Contract Cleanup Blueprint](walkthroughs/2026-06-30-round-33-profile-contract-cleanup-blueprint.md) 将 Slice 1 拆成 reference、leader/director/writer profile、`DirectorOutputSchema` 和 profile tests 的逐文件改动方案。
- 2026-06-30: [Round 34 OpenAPI Explicit Path Blueprint](walkthroughs/2026-06-30-round-34-openapi-explicit-path-blueprint.md) 将 Slice 2 拆成 `RouteMetaEntry.path?: string`、`buildPath()` 优先级、world-context/brief 显式 path 和 spec 测试方案。
- 2026-06-30: [Round 35 Brief Service Blueprint](walkthroughs/2026-06-30-round-35-brief-service-blueprint.md) 将 Slice 3 拆成 `ChapterWriterBriefService` Interface、repository 查询、状态聚合、markdown renderer、错误处理和 service/facade/HTTP/tool/profile 测试面。
- 2026-06-30: [Round 36 Agent Tool Ergonomics Contract](walkthroughs/2026-06-30-round-36-agent-tool-ergonomics-contract.md) 定义 `get_chapter_writer_brief` tool 的参数、result shape、selection state、description、status handling、failure handling 和测试合同。
- 2026-06-30: [Round 37 Brief Markdown Boundaries](walkthroughs/2026-06-30-round-37-brief-markdown-boundaries.md) 定义 `suggestedBriefMarkdown` 的 include/exclude 信息边界，明确不输出 raw patch JSON、完整 attrs、不伪造 POV/tone/do-not-reveal。
- 2026-06-30: [Round 38 Implementation Go No-Go](walkthroughs/2026-06-30-round-38-implementation-go-no-go.md) 汇总进入实现的 go 条件、仍存在但不阻塞的风险、推荐下一步和 stop conditions；结论是应进入 Slice 1。
- 2026-06-30: [Round 39 Legacy Field Removal Compatibility](walkthroughs/2026-06-30-round-39-legacy-field-removal-compatibility.md) 审计 `DirectorOutputSchema` 旧字段调用面，决定不保留 `simulator_requests` / `plot` kind 兼容 alias，Slice 1 直接改为 `world_engine_requests`。
- 2026-06-30: [Round 40 Test Evidence Route](walkthroughs/2026-06-30-round-40-test-evidence-route.md) 将后续验收拆到 profile schema/prompt、writer prompt、OpenAPI spec、brief DTO/service/HTTP 和 Agent tool selection 测试。
- 2026-06-30: [Round 41 Atomic Patch Sequence](walkthroughs/2026-06-30-round-41-atomic-patch-sequence.md) 将实现顺序固化为四个原子补丁：Profile Contract Cleanup、OpenAPI Explicit Path、Chapter Writer Brief Module、Agent Tool Binding。
- 2026-06-30: [Round 42 Architecture Deepening Candidates](walkthroughs/2026-06-30-round-42-architecture-deepening-candidates.md) 按 Module / Interface / Depth / Locality 审查 director contract、当前策略注入、brief service、OpenAPI metadata 和 tool exposure 五个 deepening candidates。
- 2026-06-30: [Round 43 HistorySet Rollout Constraint](walkthroughs/2026-06-30-round-43-historyset-rollout-constraint.md) 确认 `HistorySet` 旧会话不会自动刷新 reference，因此 Slice 1 必须以 profile `System` 作为当前 Plot / World Engine 协作权威 Interface。
- 2026-06-30: [Round 44 Profile Build And Tool Registry Coupling](walkthroughs/2026-06-30-round-44-profile-build-and-tool-registry-coupling.md) 记录 profile source、compiled runtime、tool registry、profile binding 和 `plot.selection` 的不同证据面，避免 tool/source 改动假完成。
- 2026-06-30: [Round 45 Report Result Strictness Contract](walkthroughs/2026-06-30-round-45-report-result-strictness-contract.md) 确认 `report_result.data` 会按 profile `outputSchema` 校验，但 `DirectorOutputSchema` 必须显式 strict 才能拒绝混入旧 `simulator_requests`。
- 2026-06-30: [Round 46 Director Report Data Required Gap](walkthroughs/2026-06-30-round-46-director-report-data-required-gap.md) 记录当前 runtime 不能机械强制 director 提供 `report_result.data`，Slice 1 只能 prompt-level 要求，后续可按需加 required-data binding。
- 2026-06-30: [Round 47 Agent Profile Discovery Contract](walkthroughs/2026-06-30-round-47-agent-profile-discovery-contract.md) 确认 `get_agent_profile` 只暴露 output schema summary 和 toolKeys，字段 description 需要作为 Agent-facing Interface 认真编写。
- 2026-06-30: [Round 48 Chapter Path And Writer Target Contract](walkthroughs/2026-06-30-round-48-chapter-path-and-writer-target-contract.md) 明确 `chapterPath` 是 Plot 章节目录，不是 writer 写入文件；`get_chapter_writer_brief` 不新增 `writerPath`，writer 写入目标仍由 `invoke_agent.input.path` 指定。
- 2026-06-30: [Round 49 Brief Status Precedence](walkthroughs/2026-06-30-round-49-brief-status-precedence.md) 固化 brief status 聚合优先级，区分空 World Context warning、全部 unresolved、缺 anchor 和查询失败。
- 2026-06-30: [Round 50 HTTP Route Query Validation Contract](walkthroughs/2026-06-30-round-50-http-route-query-validation-contract.md) 明确 `get_chapter_writer_brief` route 可继续使用 catch-all，但必须先实现 OpenAPI explicit `path`，业务校验继续集中在 `PlotScopeGuard.assertChapterPath()`。
- 2026-06-30: [Round 51 Profile Contract Current Diff Map](walkthroughs/2026-06-30-round-51-profile-contract-current-diff-map.md) 按当前 profile/source/reference/test 状态列出 Slice 1 的真实差距和测试断言。
- 2026-06-30: [Round 52 Director Output Schema Verification](walkthroughs/2026-06-30-round-52-director-output-schema-verification.md) 明确用 TypeBox `Value.Check()` 证明新 director 输出合同拒绝旧字段、旧 kind 和额外字段，同时不夸大 runtime 对 `report_result.data` 的必填约束。
- 2026-06-30: [Round 53 Brief Tool Runtime Rollout Evidence](walkthroughs/2026-06-30-round-53-brief-tool-runtime-rollout-evidence.md) 梳理 `get_chapter_writer_brief` 从 service 到 Agent 可用的 runtime registry、typed binding、director exposure 和 compiled artifact 证据链。
- 2026-06-30: [Round 54 Brief DTO Ownership](walkthroughs/2026-06-30-round-54-brief-dto-ownership.md) 明确 `ChapterWriterBriefDtoSchema` 应放在 `shared/dto/plot.dto.ts`，复用现有 Chapter Plot 和 Scene World Context DTO。
- 2026-06-30: [Round 55 Brief Service Query Depth](walkthroughs/2026-06-30-round-55-brief-service-query-depth.md) 比较复用现有 Chapter Plot、专用 brief repository 查询和 Agent tool 串调用三种方案，推荐新增轻量 `findChapterScenesForBrief()`。
- 2026-06-30: [Round 56 OpenAPI And HTTP Acceptance Gate](walkthroughs/2026-06-30-round-56-openapi-and-http-acceptance-gate.md) 固化 OpenAPI explicit path 与 `chapter-writer-brief` HTTP route 的验收标准，要求两个 catch-all GET operation 不互相覆盖。
- 2026-06-30: [Round 57 Compiled Runtime Acceptance Boundary](walkthroughs/2026-06-30-round-57-compiled-runtime-acceptance-boundary.md) 核对当前 profile build/source/runtime 证据层；确认 director compiled manifest 仍指向旧 simulator gate artifact，后续必须检查 compiled artifact。
- 2026-06-30: [Round 58 Leader Director Writer Scenario Gate](walkthroughs/2026-06-30-round-58-leader-director-writer-scenario-gate.md) 将 `leader.default -> director -> writer` 调用链拆成可静态验证和必须真实 smoke 的 gate。
- 2026-06-30: [Round 59 Implementation Entry Checklist](walkthroughs/2026-06-30-round-59-implementation-entry-checklist.md) 固化 Slice 1 `Profile Contract Cleanup` 入口 checklist 和 stop conditions；继续纯设计收益已很低。
- 2026-06-30: [Round 60 Slice 1 Test Harness Map](walkthroughs/2026-06-30-round-60-slice-1-test-harness-map.md) 明确 Slice 1 测试落点：director prompt 负断言、schema-only `Value.Check()` strict 负例和 writer prompt/toolset 断言。
- 2026-06-30: [Round 61 Profile Compile Current Pointer Proof](walkthroughs/2026-06-30-round-61-profile-compile-current-pointer-proof.md) 明确 system/user `.compiled/manifest.json` current pointer 和 artifact 内容检查流程，避免 source tests 通过但 runtime 仍旧。
- 2026-06-30: [Round 62 User Assets Shadow Risk](walkthroughs/2026-06-30-round-62-user-assets-shadow-risk.md) 记录当前 user root 已有旧 director source；实现后必须处理或显式验收 user assets shadow，否则可能旧 prompt 搭配新 schema。
- 2026-06-30: [Round 63 OpenAPI Explicit Path Test Map](walkthroughs/2026-06-30-round-63-openapi-explicit-path-test-map.md) 将 OpenAPI explicit path 的验收落到 `server/openapi/generate-spec.test.ts`，证明 catch-all route 生成真实公开 path。
- 2026-06-30: [Round 64 Chapter Writer Brief Fixture Test Map](walkthroughs/2026-06-30-round-64-chapter-writer-brief-fixture-test-map.md) 明确 `ChapterWriterBriefService` 的 DTO、repository 查询、fixture 状态和 markdown 信息边界测试。
- 2026-06-30: [Round 65 Agent Tool Binding And Profile Discovery Acceptance](walkthroughs/2026-06-30-round-65-agent-tool-binding-profile-discovery-acceptance.md) 固化 brief tool 从 runtime registry 到 director 可发现、writer 不暴露 Plot tools、compiled artifact 验收的证据链。
- 2026-06-30: [Round 66 Profile Contract Cleanup Patch Surface](walkthroughs/2026-06-30-round-66-profile-contract-cleanup-patch-surface.md) 将 Slice 1 补丁面收敛到 director prompt、`DirectorOutputSchema` strict、普通写作 reference 和 writer 注释，并明确 schema/prompt 负断言。
- 2026-06-30: [Round 67 Profile Activation Evidence After Task 79](walkthroughs/2026-06-30-round-67-profile-activation-evidence-after-task-79.md) 修正 compiled runtime 验收口径：检查 `profiles.director.artifactSha` 和内容寻址 artifact，而不是旧 current pointer；当前 system/user artifact 仍是旧 simulator gate。
- 2026-06-30: [Round 68 Exploration Stop And Implementation Go-No-Go Refresh](walkthroughs/2026-06-30-round-68-exploration-stop-and-implementation-go-no-go-refresh.md) 刷新 go/no-go：继续纯探索收益很低，下一步应进入 Slice 1 `Profile Contract Cleanup`。
- 2026-06-30: [Round 69 OpenAPI Explicit Path Interface Proof](walkthroughs/2026-06-30-round-69-openapi-explicit-path-interface-proof.md) 确认 catch-all route 的 OpenAPI Interface 需要 `RouteMetaEntry.path?: string`、path param 和 duplicate guard。
- 2026-06-30: [Round 70 Chapter Writer Brief Batch Depth](walkthroughs/2026-06-30-round-70-chapter-writer-brief-batch-depth.md) 证明 brief v1 需要章节级只读深 Module 与 `findChapterScenesForBrief()`，不能让 Agent tool 层串调用承担业务逻辑。
- 2026-06-30: [Round 71 Tool Binding And Profile Discovery Interface](walkthroughs/2026-06-30-round-71-tool-binding-and-profile-discovery-interface.md) 固化 brief tool 从 runtime 到 `get_agent_profile` 可发现的完整 Interface 链。
- 2026-06-30: [Round 72 User Profile Shadow Rollout Strategy](walkthroughs/2026-06-30-round-72-user-profile-shadow-rollout-strategy.md) 明确 Slice 1 不能只验 system profile；user root 会覆盖 system，正常 sync 可更新未手改副本，但 force sync 会覆盖用户内容，runtime 验收必须检查 active user source/artifact。
- 2026-06-30: [Round 73 Director Output Schema Strict Test Shape](walkthroughs/2026-06-30-round-73-director-output-schema-strict-test-shape.md) 固化 `DirectorOutputSchema` strict 测试形态：新合同通过，旧 `simulator_requests`、旧 `plot` kind、root extra 和 item extra 都必须 `Value.Check()` 失败。
- 2026-06-30: [Round 74 Agent Smoke Boundary](walkthroughs/2026-06-30-round-74-agent-smoke-boundary.md) 区分 static proof、faux smoke proof 和真实 Agent 行为证明；harness smoke 可证明链路可走通，但不能替代真实模型规划质量。
- 2026-06-30: [Round 75 Deepening Opportunities Current Audit](walkthroughs/2026-06-30-round-75-deepening-opportunities-current-audit.md) 以 Module / Interface / Depth / Locality 重新审计当前入口，确认只需按四个既定切片推进，不新增第五个大 refactor。
- 2026-06-30: [Round 76 Director Writer Handoff Language Drift](walkthroughs/2026-06-30-round-76-director-writer-handoff-language-drift.md) 记录普通写作链路的语言漂移：应表达为 writer 不直接用 Plot tools、但可消费 director/brief compiler 生成的 Scene / World Context brief。
- 2026-06-30: [Round 77 Implementation Entry Test Gradient](walkthroughs/2026-06-30-round-77-implementation-entry-test-gradient.md) 固化四个切片的最小测试梯度和 stop conditions，避免窄测试替代大范围完成声明。
- 2026-06-30: [Round 78 Leader Default Contract Gap](walkthroughs/2026-06-30-round-78-leader-default-contract-gap.md) 确认当前 leader.default profile/reference 仍把 Plot/director 排除在普通写作主链外，Slice 1 必须先修 leader 合同。
- 2026-06-30: [Round 79 World Engine Specialist Boundary](walkthroughs/2026-06-30-round-79-world-engine-specialist-boundary.md) 确认 world.engine 不应成为 Plot owner 或 brief compiler；director 的 World Engine 未决问题应交回 leader，再由 leader 可选调用 world.engine。
- 2026-06-30: [Round 80 Profile Discovery Runtime Interface Acceptance](walkthroughs/2026-06-30-round-80-profile-discovery-runtime-interface-acceptance.md) 明确 `get_agent_profile` 只暴露 toolKeys 和 schema summary，tool description 与字段 description 必须作为 Agent-facing Interface 验收。
- 2026-06-30: [Round 81 Profile Contract Test Seam](walkthroughs/2026-06-30-round-81-profile-contract-test-seam.md) 用 Module / Interface / Depth / Locality 复审 Slice 1 测试入口，要求把 prompt/tool/schema strict 负例集中到 profile contract 测试 seam。
- 2026-06-30: [Round 82 OpenAPI Explicit Path Seam](walkthroughs/2026-06-30-round-82-openapi-explicit-path-seam.md) 确认 `RouteMetaEntry.path?: string` 和 duplicate operation guard 是 catch-all route 的机器可读 Interface。
- 2026-06-30: [Round 83 Brief Read Model Module](walkthroughs/2026-06-30-round-83-brief-read-model-module.md) 确认 brief v1 需要 `ChapterWriterBriefService` + `findChapterScenesForBrief()`，Agent tool 只做 adapter，不承载业务规则。
- 2026-06-30: [Round 84 Director Runtime Truth Source](walkthroughs/2026-06-30-round-84-director-runtime-truth-source.md) 确认 director runtime truth source 是 active catalog + user manifest/artifact；当前 system/user compiled artifacts 都仍含旧 simulator gate。
- 2026-06-30: [Round 85 Plot Selection Side Effect Contract](walkthroughs/2026-06-30-round-85-plot-selection-side-effect-contract.md) 固化 `get_chapter_writer_brief` 必须不读写 `plot.selection`，只按 `{projectPath, chapterPath}` 生成 brief。
- 2026-06-30: [Round 86 Implementation Cut Line](walkthroughs/2026-06-30-round-86-implementation-cut-line.md) 总结 profile 架构与四个实现切片已足够明确，下一步应进入 Slice 1 `Profile Contract Cleanup`。
- 2026-06-30: [Round 87 Profile Compile Command Evidence](walkthroughs/2026-06-30-round-87-profile-compile-command-evidence.md) 确认 profile CLI 的 `check/compile/status` 与 system/user root 选择，是 Slice 1 后 runtime artifact 验收的操作 Interface。
- 2026-06-30: [Round 88 User Assets Sync Decision](walkthroughs/2026-06-30-round-88-user-assets-sync-decision.md) 明确优先使用非 force user assets sync 更新仍跟随上游的 user director；手改冲突必须停下让用户决定。
- 2026-06-30: [Round 89 Slice 1 Entry Checklist Final](walkthroughs/2026-06-30-round-89-slice-1-entry-checklist-final.md) 固化 Slice 1 最终 patch order、最小测试、runtime activation 和 stop conditions。
- 2026-06-30: [Round 90 OpenAPI Meta Dual Consumer Gap](walkthroughs/2026-06-30-round-90-openapi-meta-dual-consumer-gap.md) 确认 `RouteMetaEntry.path?: string` 不只影响静态 spec，也必须同步 `generate-openapi-meta.ts` 的 route-local `defineRouteMeta` 注入，避免 catch-all route metadata 缺 path params。
- 2026-06-30: [Round 91 Profile Test Surface Split](walkthroughs/2026-06-30-round-91-profile-test-surface-split.md) 确认 Slice 1 测试面分散在 director、leader.default、writer 三处；实现时需同步 `simulation-director-profiles.test.ts`、`leader-assets-profile.test.ts` 和 writer profile 测试或等价集中断言。
- 2026-06-30: [Round 92 Profile Discovery Tool Description Limit](walkthroughs/2026-06-30-round-92-profile-discovery-tool-description-limit.md) 纠正 `get_agent_profile` 验收口径：它只返回 profile 摘要、schema summary 和 toolKeys，不返回每个 tool description；brief tool 可发现性需拆成 caller discovery 与 target execution guidance。
- 2026-06-30: [Round 93 Brief Tool Binding Stack](walkthroughs/2026-06-30-round-93-brief-tool-binding-stack.md) 确认 `get_chapter_writer_brief` 必须穿过 `plot-tools.ts`、`tools/index.ts`、`profile-tools.ts`、director toolset 和 compiled artifact 五层，单实现 service/route 不算 Agent 可用。
- 2026-06-30: [Round 94 Chapter Brief Route Shape](walkthroughs/2026-06-30-round-94-chapter-brief-route-shape.md) 建议 brief HTTP route 采用 `GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=`，沿用现有 chapterPath query + `PlotScopeGuard.assertChapterPath()` 语义。
- 2026-06-30: [Round 95 Compiled Director Artifact Current Evidence](walkthroughs/2026-06-30-round-95-compiled-director-artifact-current-evidence.md) 记录 system/user director 当前仍指向同一旧 artifact `33e5a16f...`，compiled artifact 仍含 `simulator_requests` / `Simulation gate`，Slice 1 后必须证明两端 source/manifest/artifact 都更新。
- 2026-06-30: [Round 96 Chapter Writer Brief Service Integration Point](walkthroughs/2026-06-30-round-96-chapter-writer-brief-service-integration-point.md) 确认 `ChapterWriterBriefService` 应作为 Plot 模块内同级只读 Module 接入 facade，配套专用 `findChapterScenesForBrief()`，不要扩写 UI 用的 `ChapterPlotSceneDtoSchema`。
- 2026-06-30: [Round 97 Scene World Context Reuse Boundary](walkthroughs/2026-06-30-round-97-scene-world-context-reuse-boundary.md) 确认 `getSceneWorldContext(sceneId)` 保持 HTTP 严格入口；brief service 应复用 Scene 实体级 context helper，缺 anchor 主动聚合为 status/warning，暂不提前抽批量 Interface。
- 2026-06-30: [Round 98 Brief DTO and Tool Text Contract](walkthroughs/2026-06-30-round-98-brief-dto-and-tool-text-contract.md) 修正 brief DTO 草案：scene item 必须显式包含 Scene `writingTip` 和 Thread `summary/writingTip`；brief tool text 应以 `suggestedBriefMarkdown` 为主体，完整 DTO 保留在 `details`。
- 2026-06-30: [Round 99 Brief Markdown Renderer Seam](walkthroughs/2026-06-30-round-99-brief-markdown-renderer-seam.md) 确认 `suggestedBriefMarkdown` renderer 第一版属于 `ChapterWriterBriefService` 内部 implementation detail，测试用 section marker 与负断言锁信息边界，暂不抽 shared Module。
- 2026-06-30: [Round 100 Implementation Entry Gate After Brief Corrections](walkthroughs/2026-06-30-round-100-implementation-entry-gate-after-brief-corrections.md) 确认 Round 96-99 的 brief 修正不改变四切片顺序；实现仍应从 Profile Contract Cleanup 开始，并按切片运行最小测试。
- 2026-06-30: [Round 101 Slice 1 Current Patch Surface](walkthroughs/2026-06-30-round-101-slice-1-current-patch-surface.md) 记录 Profile Contract Cleanup 的当前补丁面：`DirectorOutputSchema` strict、director/leader/writer prompt/reference、user root shadow 和测试负例。
- 2026-06-30: [Round 102 OpenAPI Route-local Multi-operation Ceiling](walkthroughs/2026-06-30-round-102-openapi-route-local-multi-operation-ceiling.md) 修正 Slice 2 验收口径：`/_openapi.json` 是完整 OpenAPI 真相源；route-local `defineRouteMeta` 只能做 representative metadata，必须避免同文件多 entry 静默覆盖。
- 2026-06-30: [Round 103 OpenAPI Meta Representative Flag](walkthroughs/2026-06-30-round-103-openapi-meta-representative-flag.md) 建议 `RouteMetaEntry.emitRouteMeta?: boolean`：canonical spec 使用所有 entry，route-local metadata 按 file 分组且每组只允许一个 representative。
- 2026-06-30: [Round 104 Brief Read Model Query Shape](walkthroughs/2026-06-30-round-104-brief-read-model-query-shape.md) 确认 brief v1 应新增 `findChapterScenesForBrief()` 专用 read model，拿到 Scene `writingTip` 与 Thread `summary/writingTip`，不扩胖 UI 用 `ChapterPlotSceneDtoSchema`。
- 2026-06-30: [Round 105 Scene World Context Helper For Brief](walkthroughs/2026-06-30-round-105-scene-world-context-helper-for-brief.md) 确认保留 `getSceneWorldContext(sceneId)` HTTP strict，同时新增 Scene 实体级 context helper 供 brief 聚合 warnings/status。
- 2026-06-30: [Round 106 Brief Status Fixture Matrix](walkthroughs/2026-06-30-round-106-brief-status-fixture-matrix.md) 固定 brief status fixture：path error 抛错，随后按 `needs_plot`、`needs_world_anchor`、`needs_world_context`、`ready` 聚合。
- 2026-06-30: [Round 107 Brief Tool Adapter Result Contract](walkthroughs/2026-06-30-round-107-brief-tool-adapter-result-contract.md) 确认 `get_chapter_writer_brief` tool text 必须是 `suggestedBriefMarkdown`，完整 DTO 放 `details`，且不读写 `plot.selection`。
- 2026-06-30: [Round 108 Profile Discovery Visibility Contract](walkthroughs/2026-06-30-round-108-profile-discovery-visibility-contract.md) 校正 profile discovery 验收：`get_agent_profile` 只证明 `toolKeys/schema summary`，tool description 与 brief workflow 需由 runtime tool definition 和 director prompt/reference 证明。
- 2026-06-30: [Round 109 Agent Tool Binding Acceptance Matrix](walkthroughs/2026-06-30-round-109-agent-tool-binding-acceptance-matrix.md) 把 Slice 4 验收拆成 facade、HTTP/OpenAPI、runtime tool、typed binding、director source、writer isolation、discovery 和 compiled artifact 逐层证据。
- 2026-06-30: [Round 110 Profile Topology Final Recheck](walkthroughs/2026-06-30-round-110-profile-topology-final-recheck.md) 复核 Leader Monolith、Writer self-serve、world.engine owner、dedicated brief profile 等替代拓扑，确认第一阶段仍采用 Director + Brief Compiler。
- 2026-06-30: [Round 111 Profile Architecture Spec V2](walkthroughs/2026-06-30-round-111-profile-architecture-spec-v2.md) 将最新结论压成 profile architecture spec v2：四个 profile Interface、`ChapterWriterBriefService` Module、tool matrix 和验收证据。
- 2026-06-30: [Round 112 Completion Audit Matrix](walkthroughs/2026-06-30-round-112-completion-audit-matrix.md) 建立完成审计矩阵，明确 profile topology、schema strict、OpenAPI、brief Module、tool binding 和 compiled runtime 的强证据要求。
- 2026-06-30: [Round 113 Reference Rewrite Map](walkthroughs/2026-06-30-round-113-reference-rewrite-map.md) 将 `leader-default.md`、`profile-routing.md`、`novel-writing-workflow.md` 的旧 Plot/director 语义改写为实现地图。
- 2026-06-30: [Round 114 Systemic Fix Criteria](walkthroughs/2026-06-30-round-114-systemic-fix-criteria.md) 明确 Profile Contract Cleanup 必须同时移动 schema、profile source、reference、compiled artifact 和测试，单点修改都不是系统性修复。
- 2026-06-30: [Round 115 Test Migration Map](walkthroughs/2026-06-30-round-115-test-migration-map.md) 将 Slice 1 测试迁移落到 `simulation-director-profiles.test.ts`、`leader-assets-profile.test.ts` 和 schema strict 正负例。
- 2026-06-30: [Round 116 OpenAPI Explicit Path Implementation Map](walkthroughs/2026-06-30-round-116-openapi-explicit-path-implementation-map.md) 将 Slice 2 落到 `RouteMetaEntry.path/emitRouteMeta`、duplicate guard、canonical spec 和 route-local representative metadata。
- 2026-06-30: [Round 117 Brief DTO Service Implementation Map](walkthroughs/2026-06-30-round-117-brief-dto-service-implementation-map.md) 将 Slice 3 落到 `ChapterWriterBriefDtoSchema`、`findChapterScenesForBrief()`、Scene entity-level World Context helper、facade 和 HTTP route。
- 2026-06-30: [Round 118 Final Execution Board](walkthroughs/2026-06-30-round-118-final-execution-board.md) 将后续实现压成四切片执行看板，并确认继续 broad exploration 的收益已很低。
- 2026-06-30: [Round 119 User Shadow And Compiled Artifact Rollout](walkthroughs/2026-06-30-round-119-user-shadow-compiled-rollout.md)、[Round 120 Profile Compile / Sync Verification Commands](walkthroughs/2026-06-30-round-120-profile-compile-sync-verification.md)、[Round 121 Agent Smoke Evidence Layers](walkthroughs/2026-06-30-round-121-agent-smoke-evidence-layers.md) 补齐 active user shadow、system/user compiled artifact、profile compile/sync 命令和 static / faux / real smoke 三层证据口径。
- 2026-06-30: [Round 122 Slice 1 Atomic Contract Delta](walkthroughs/2026-06-30-round-122-slice-1-atomic-contract-delta.md)、[Round 123 Director Schema Strict Fixture Design](walkthroughs/2026-06-30-round-123-director-schema-strict-fixture-design.md)、[Round 124 Leader / Writer / Reference Contract Delta](walkthroughs/2026-06-30-round-124-leader-writer-reference-contract-delta.md) 将 Profile Contract Cleanup 压成不可拆散的 schema / prompt / reference / tests / compiled runtime 原子变更，并明确 `Value.Check()` strict 负例和 leader/writer 路由语言迁移。
- 2026-06-30: [Round 125 OpenAPI Explicit Path Current Gap](walkthroughs/2026-06-30-round-125-openapi-explicit-path-current-gap.md)、[Round 126 Route-Local Representative Metadata](walkthroughs/2026-06-30-round-126-route-local-representative-metadata.md)、[Round 127 OpenAPI Spec Test Fixture](walkthroughs/2026-06-30-round-127-openapi-spec-test-fixture.md) 将 Slice 2 补成 explicit public path、route-local representative 和 canonical spec fixture 三层门禁：`RouteMetaEntry.path` / `emitRouteMeta`、duplicate `path + method` guard、按 file 分组避免 last-wins、`buildOpenAPISpecForRoutes()` 测试同一 catch-all file 多 public path。
- 2026-06-30: [Round 128 OpenAPI Operation Builder Seam](walkthroughs/2026-06-30-round-128-openapi-operation-builder-seam.md) 将 Slice 2 的两个 Adapter 收束到共享 operation builder Module：canonical spec 与 route-local representative 共用 public path、path params、query/body/response 规则；测试 meta generator 前先抽纯函数或加 main guard，避免 import 即写文件。
- 2026-06-30: [Round 129 Profile Contract Test Seam Current Map](walkthroughs/2026-06-30-round-129-profile-contract-test-seam-current-map.md) 将 Slice 1 验收分到 director / leader.default / writer 三个测试 seam，并明确 `Value.Check()` strict 正负例、旧 simulator gate 负断言和 writer brief consumption 正断言。
- 2026-06-30: [Round 130 Brief Read Model Current Gap](walkthroughs/2026-06-30-round-130-brief-read-model-current-gap.md) 确认 `ChapterPlotDetailDto` 是 UI Interface，brief v1 需要 `findChapterScenesForBrief()`、Scene 实体级 World Context helper、status precedence 和 `suggestedBriefMarkdown` renderer。
- 2026-06-30: [Round 131 Agent Tool Binding Current Gap](walkthroughs/2026-06-30-round-131-agent-tool-binding-current-gap.md) 确认 Slice 4 仍缺 service/facade/runtime tool/global registry/typed binding/director exposure/compiled artifact 全链路；brief tool 应保持 selection-free adapter，tool text 为 `suggestedBriefMarkdown`，业务语义留在 `ChapterWriterBriefService`。
- 2026-06-30: [Round 132 Profile Contract Cleanup Implementation Entry](walkthroughs/2026-06-30-round-132-profile-contract-cleanup-implementation-entry.md) 将 Slice 1 的开工顺序固定为 schema strict -> director source -> leader/reference -> writer language -> tests -> active user/compiled proof，并记录当前缺少 server 侧 writer profile contract test；现有 assets 侧 writer test 仍需补 brief consumption 断言。
- 2026-06-30: [Round 133 OpenAPI Explicit Path Implementation Entry](walkthroughs/2026-06-30-round-133-openapi-explicit-path-implementation-entry.md) 将 Slice 2 的开工顺序固定为 `RouteMetaEntry.path/emitRouteMeta` -> shared operation builder -> canonical spec Adapter -> route-local representative Adapter -> pure-function tests，并确认当前 route-local metadata 缺 `sceneId`。
- 2026-06-30: [Round 134 Chapter Writer Brief Module Implementation Entry](walkthroughs/2026-06-30-round-134-chapter-writer-brief-module-implementation-entry.md) 将 Slice 3 的开工顺序固定为 DTO -> dedicated repository read model -> Scene entity-level World Context helper -> `ChapterWriterBriefService` -> facade -> HTTP route -> OpenAPI entry，并明确不要扩胖 UI 用 `ChapterPlotDetailDto`。
- 2026-06-30: [Round 135 End-to-End Implementation Runbook](walkthroughs/2026-06-30-round-135-end-to-end-implementation-runbook.md) 将四个实现切片串成端到端 runbook：Profile Contract Cleanup -> OpenAPI Explicit Path -> Chapter Writer Brief Module -> Agent Tool Binding，并按 source diff、focused tests、generated metadata/spec、compiled manifest/artifact、catalog discovery、static/faux/real Agent smoke 建立证据层级。
- 2026-06-30: [Round 136 Profile Contract Cleanup Implementation](walkthroughs/2026-06-30-round-136-profile-contract-cleanup-implementation.md) 完成 Slice 1：`DirectorOutputSchema` strict，删除旧 `simulator_requests` / `"plot"` kind，新增 `world_engine_requests`；system/user director、leader.default、writer source 与 reference 同步；聚焦测试 17 项通过；system/user compiled director artifact 均不再含旧 simulator gate，并已加载新 artifact。
- 2026-06-30: [Round 137 OpenAPI Explicit Path Implementation](walkthroughs/2026-06-30-round-137-openapi-explicit-path-implementation.md) 完成 Slice 2：`RouteMetaEntry.path/emitRouteMeta`、共享 operation builder、duplicate operation guard、route-local representative selector、Project Plot explicit paths 与 generated metadata `sceneId` path param 均已落地；OpenAPI/Plot handler 聚焦测试 16 项通过，`bun run generate:openapi` 为 40 updated / 0 failed。
- 2026-06-30: [Round 138 Chapter Writer Brief Module Implementation](walkthroughs/2026-06-30-round-138-chapter-writer-brief-module-implementation.md) 完成 Slice 3：新增 Chapter writer brief DTO/read model/service/facade/HTTP/OpenAPI entry；service 聚合 `ready / needs_plot / needs_world_anchor / needs_world_context` 和 `suggestedBriefMarkdown`；聚焦测试 21 项通过，DTO 测试 2 项通过，`generate:openapi` 为 40 updated / 0 failed。
- 2026-06-30: [Round 139 Agent Tool Binding Implementation](walkthroughs/2026-06-30-round-139-agent-tool-binding-implementation.md) 完成 Slice 4：`get_chapter_writer_brief` runtime tool、global registry、typed binding、director toolset/prompt、writer isolation 和 compiled artifact 证据均已落地；聚焦 agent tool/profile tests 22 项通过，builtin smoke 2 项通过，system/user director artifacts 含 `get_chapter_writer_brief` / `suggestedBriefMarkdown` 且不含旧 simulator gate。
- 2026-06-30: [Round 140 Completion Audit](walkthroughs/2026-06-30-round-140-completion-audit.md) 完成 Task 78 / active goal completion audit：原始 Scene/World Engine Bridge、profile architecture、四个 Agent 易用性实现切片和 runtime artifact 证据均成立；聚焦回归测试 13 files / 62 tests passed。真实模型策略 smoke 与浏览器验证未执行，不作为 Task 78 完成门禁。

### 审查发现（2026-06-29）

#### 历史状态（实现前审查记录）

- **当时已完成**：设计方向明确、时间模型对齐、数据模型草案、基础决策完成。
- **当时缺失**：实现路径不明确、Plot Beat 退场策略未定、Chapter 覆盖设计空白、Scene 查询 World Engine 的桥接逻辑未实现、UI 路径未明确。

#### 新发现的设计问题

1. **Scene 与 World Engine 的同步时机**：leader 是先推进 World Engine 再更新 Scene 时间范围，还是先设计 Scene 再写入 World Engine slices？影响工作流设计。
2. **Scene 时间范围的粒度**：是否允许跨天、跨月、跨年的 Scene？极端情况（如训练蒙太奇）如何处理？
3. **多地点 Scene 的 UI 复杂度**：已在第一版收敛为单个 `locationSubjectId`。多地点场景（追逐、蒙太奇）暂时通过 `subjectIds` 和 Scene summary 表达，后续若真实使用需要再讨论 UI。
4. **Scene 查询结果的展示形态**：查询到的 slices/patches 是展示为时间线还是按 subject 分组？是只读展示还是允许跳转到 World Engine Workbench 编辑？

#### 技术风险

1. **Plot 系统使用面**：Plot 系统已有完整的 facade/repository/service 架构、前端组件和 Agent 工具。大幅改动 Scene 数据模型会影响现有工具、历史项目数据和用户工作流。
2. **World Engine 集成复杂度**：需要服务层桥接、时间转换、Subject 引用一致性校验、查询性能优化。
3. **迁移路径风险**：如果删除 `StoryPlot`，需要 Schema 迁移、数据迁移、Agent 工具更新、UI 改造、用户通知。一次性改动过大可能导致历史项目无法打开。

#### 建议实施路径（渐进式迁移）

- **Phase 0**：决策与细化设计（1-2 天）—— 确认 Open Design Questions、设计 Chapter 覆盖、明确查询 API、确定 `StoryPlot` 退场策略。
- **Phase 1**：最小垂直切片 - Scene World Anchor（3-5 天）—— Prisma schema 添加字段、迁移脚本、DTO/API 更新、服务端桥接、UI 增加"连接到 World Engine"区域。不删除 Plot Beat。
- **Phase 2**：Chapter 覆盖系统（2-3 天）—— 数据模型、CRUD API、UI 编辑器、与 Scene 关联。
- **Phase 3**：Plot Beat 退场（3-5 天）—— 数据迁移脚本、Agent 工具更新、UI 改造、保留 legacy 只读。
- **Phase 4**：体验优化与文档（2-3 天）—— Plot Workbench 改造、便捷路径、文档更新、用户验收。

总工作量估算：10-18 天。

## TODO / Follow-ups

- [x] **决策 Open Design Questions**（已完成 2026-06-29）
- [x] 梳理当前 Plot 数据模型、DTO、Prisma schema 与 UI 中 `StoryPlot` 的使用面（已完成审查）
- [x] 识别 Chapter 覆盖的数据形态与 writer brief 生成方向（已降级为后续单列任务，本 Task 78 不实现 `ChapterOverride`）
- [x] 决定 `StoryPlot` 删除、迁移或 legacy 只读策略（已决策：立即删除，编写迁移脚本）
- [x] 设计 Scene 查询 World Engine 的服务端桥接 API（已决策：`GET /api/projects/plot/scenes/:sceneId/world-context`）
- [x] 设计第一期最小垂直切片的具体任务清单（已完成 Phase 1-4 规划）
- [x] 修正 Agent 路由与提示词拓扑：`leader.default` / `director` / `writer` / `reference/agent/novel-writing-workflow.md` / `reference/agent/profile-routing.md` 应把 Plot 定位为 Scene-only 作者结构层，而不是旧状态源或 legacy 系统。
- [x] 决策 `leader.default` 是否直接拥有 Plot tools；当前实现已改为 leader.default 持有 Plot 全套读写和 brief 工具，普通写作主链不再默认转 director。
- [x] 设计并实现聚合 writer brief 工具或 API（候选：`get_chapter_writer_brief`），把 Chapter scenes、Scene World Context、Thread summary 和缺失 anchor warning 汇总给 leader；当前 route/DTO/tool 合同已落地，Task 80 后续扩展 ChapterOverride。
- [x] 实现 `get_chapter_writer_brief` route-map 前，先修 OpenAPI catch-all route 表达能力：`RouteMetaEntry` 增加显式 `path` override，并补测试证明 `world-context` 与 `chapter-writer-brief` 两个 GET operation 不互相覆盖。
- [x] 实现 brief v1 前，先抽 `SceneWorldAnchorResolutionService`，统一 Plot Facade 输出 DTO 的 resolved/unresolved subject 与时间格式化语义；brief v1 必须复用该语义，不再新增第三套解析规则。
- [x] 按需让 `SceneWorldContextService` 复用 `SceneWorldAnchorResolutionService` 的查询语义，减少 context/brief 对 resolved subject 集合的重复处理；当前实现由 `ChapterWriterBriefService` 同时复用 anchor resolution 和 Scene entity-level context helper，避免新增第三套 subject 解析语义。
- [x] brief v1 应新增 `ChapterWriterBriefService` 和 repository 查询（例如 `findChapterScenesForBrief`），不要在 Agent tool 层串 `get_chapter_plot` / `get_scene_world_context` 承担业务逻辑；Round 96 已确认该 service 应作为 `SceneWorldContextService` 同级只读 Module 接入 `PlotFacade`，且不要扩写 UI 用 `ChapterPlotSceneDtoSchema`。
- [x] profile prompt 落地时同步写清 delegation protocol：`initial` 放创建语义，`message` 放任务/brief，`input` 放结构化 payload；writer 不接 Plot ids，必须消费完整 message brief。
- [x] `get_chapter_writer_brief` v1 的 DTO / service 必须包含可直接作为 writer message 草案的 `suggestedBriefMarkdown`，并测试它不包含 raw patch JSON、不伪造 ChapterOverride 字段。
- [x] 按 Round 29 切片顺序落地：Profile Contract Cleanup -> OpenAPI Explicit Path -> Chapter Writer Brief Module -> Agent Tool Binding；Leader Readonly Brief 只作为后置观察项。
- [x] 按 Round 32 完成审计矩阵验收：director contract、OpenAPI explicit path、brief service、Agent tool binding、profile tests 均落地后，才可判断 Agent 易用性改造完成。
- [x] 实现前按 Round 33-35 blueprint 对齐具体文件：先改 profile contract，再改 OpenAPI explicit path，最后实现 `ChapterWriterBriefService`。
- [x] 按 Round 36-38 约束实现 tool/markdown：brief tool 不改 selection，markdown 不含 raw patch JSON / 完整 attrs / 伪造 ChapterOverride；下一步进入 Slice 1 `Profile Contract Cleanup`。
- [x] 按 Round 39-41 的实现前 guard 落地：旧 `simulator_requests` / `plot` kind 不做兼容 alias；测试覆盖 schema/prompt/OpenAPI/brief/tool selection；实现保持四个原子补丁边界。
- [x] 按 Round 42-44 的隐藏约束落地：profile reference 同步之外，必须改当前 `System` 以覆盖旧 session HistorySet；brief tool 落地时同步 runtime registry、profile binding 和 director exposure；最终验收需区分源码测试与 compiled runtime build/status。
- [x] 按 Round 45-47 的输出合同约束落地：`DirectorOutputSchema` root 和 `plot_updates` item 显式 `additionalProperties: false`；测试 mixed legacy 字段会被拒绝；不要声称 runtime 已强制 director 必须提供 `report_result.data`；`world_engine_requests` 等字段 description 要对 leader 可读。
- [x] 按 Round 48-50 的调用边界落地：`get_chapter_writer_brief` 输入只用 `{projectPath, chapterPath}`，不接 writer target；status 聚合遵循 path error -> `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready`；OpenAPI catch-all route 先支持 explicit `path`，HTTP 只做 query 非空，业务路径校验复用 `PlotScopeGuard.assertChapterPath()`。
- [x] 按 Round 51-53 的证据链落地：先修 `director.profile.tsx` / `builtin-contracts.ts` / `leader.default` reference / writer 注释；用 `Value.Check()` 测新 `DirectorOutputSchema` 拒绝旧字段和旧 kind；brief tool 最终同步 runtime registry、typed binding、director toolset 和 compiled runtime 证据。
- [x] 按 Round 54-56 的 DTO/service/OpenAPI 验收落地：`ChapterWriterBriefDtoSchema` 归属 `shared/dto/plot.dto.ts`；`ChapterWriterBriefService` 使用专用查询拿 thread summary/writingTip；OpenAPI spec 同时生成 world-context 和 chapter-writer-brief 的独立 explicit path。
- [x] 按 Round 98 的 DTO 修正落地：不要让 `ChapterWriterBriefSceneDtoSchema` 只包 `ChapterPlotSceneDtoSchema`；scene item 必须显式包含 Scene `writingTip` 和 Thread `summary/writingTip`，`get_chapter_writer_brief` tool text 以 `suggestedBriefMarkdown` 为主体，完整 DTO 放 `details`。
- [x] 按 Round 57-59 的 runtime/scenario gate 落地：实现后必须检查 source、schema、runtime registry、profile binding、catalog/build-status、manifest `profiles.director.artifactSha` 和 artifact 内容；真实 Agent 行为未 smoke 前，只能声明静态合同成立。下一步进入 Slice 1 `Profile Contract Cleanup`，不要继续扩写重复设计。
- [x] 按 Round 60-62 的测试/compiled/user-shadow guard 落地：Slice 1 添加 director schema strict 负例、director prompt 负断言和 writer prompt/toolset 断言；编译后检查 system 与 active user root manifest entry；当前本地 user director source 会覆盖 system，若未同步或未消除 shadow，不能声称 runtime 使用新 director。
- [x] 按 Round 63-65 的测试/fixture/discovery guard 落地：OpenAPI 新增 generated spec 测试；brief service 新增 `needs_plot / needs_world_anchor / needs_world_context / ready` fixture；brief tool 不写 `plot.selection`，并同步 runtime registry、typed binding、director toolset、`get_agent_profile` 可发现路径和 compiled artifact。
- [x] 按 Round 66-68 的新格式 runtime guard 落地：Slice 1 后检查 `profiles.director.artifactSha` 和 `.compiled/artifacts/<sha>.mjs` 内容；system/user director source 与 artifact 都必须同步，或明确消除 user root shadow；继续纯探索不再增加关键架构信息。
- [x] 按 Round 69-71 的 Interface guard 落地：OpenAPI explicit path 应包含 path/query params 且防止 operation 覆盖；brief repository 查询必须携带 thread summary/writingTip 与 Scene writingTip；brief tool 必须通过 `get_agent_profile` 在 director toolKeys/schema summary 中可发现。
- [x] 按 Round 72-74 的 rollout/schema/smoke guard 落地：Profile Contract Cleanup 验收必须检查 active user root source/artifact，不能只验 system；`DirectorOutputSchema` strict 负例必须覆盖旧字段、旧 kind 和额外字段；Agent smoke 结论必须区分 static proof、faux harness proof 和真实模型行为，不用 faux 证明替代真实 session 可用性。
- [x] 按 Round 75-77 的实现入口 guard 落地：不新增大 refactor，先做四个既定切片；reference/profile 语言必须统一为 writer 不直接用 Plot tools但可消费上游 Scene / World Context brief；每个切片只跑匹配风险面的最小测试，并遵守 user shadow、双状态源、schema 绕过和 OpenAPI operation 覆盖 stop conditions。
- [x] 按 Round 78-80 的 profile/interface guard 落地：先修 leader.default 合同，让普通写作入口可路由 director；保持 world.engine 为 World Engine specialist，不变成 Plot/brief owner；用 `get_agent_profile` 的 toolKeys/schema summary 和 tool description 验证 Agent 运行时可发现 brief 能力。
- [x] 按 Round 81-83 的 deepening guard 落地：profile contract 测试必须覆盖 prompt/tool/schema strict；OpenAPI explicit path 必须有 duplicate operation guard；brief v1 通过 `ChapterWriterBriefService` read model Module 实现，tool 层只做 adapter。
- [x] 按 Round 84-86 的 runtime/cut-line guard 落地：Slice 1 后必须证明 active user source/manifest/artifact 与 system source/artifact 均更新；`get_chapter_writer_brief` 不读写 `plot.selection`；除非发现新矛盾，否则下一步直接进入 Profile Contract Cleanup。
- [x] 按 Round 87-89 的 implementation checklist 落地：Slice 1 patch order 固定为 schema -> director/leader/writer profile -> reference -> tests；运行 profile tests 后用 profile CLI 与非 force user assets sync 验证 system/user artifact，手改 user profile warning 必须停止处理。
- [x] 按 Round 90 的 OpenAPI dual-consumer guard 落地：`RouteMetaEntry.path?: string` 必须同时服务 `generate-spec.ts` 和 `generate-openapi-meta.ts`；catch-all route 的 generated `defineRouteMeta` 也要包含 explicit path params，不能只修 `/_openapi.json` 静态 spec。
- [x] 按 Round 102 的 route-local ceiling 落地：`generateOpenAPISpec()` / `/_openapi.json` 是多 logical operation 的 canonical proof；`generate-openapi-meta.ts` 需要按 file 分组，补 representative path params，并避免同一物理 route 多 entry 时静默 last-wins。
- [x] 按 Round 103 的 representative flag 落地：给 `RouteMetaEntry` 增加 `emitRouteMeta?: boolean`，canonical spec 忽略该字段；route-local meta generator 同一 file 多个 emit candidate 时直接失败，future `chapter-writer-brief` entry 标记 `emitRouteMeta: false`。
- [x] 按 Round 91 的测试面拆分落地：Slice 1 不只更新 director 测试，还要验证 leader.default 可路由 director、writer 仍无 Plot tools 但可消费上游 Scene / World Context brief；旧 `threadIds/sceneIds/plotIds` 作为 legacy payload 兼容字段保留，但 writer 不规范化、不渲染、不根据这些 id 自行读取 Plot。
- [x] 按 Round 92 的 discovery 口径落地：`get_agent_profile` 只验 `toolKeys` 和 schema summary；`get_chapter_writer_brief` 的 tool description/parameter description 必须通过 runtime tool definition 与 director prompt/reference 单独验收，不能声称调用方可通过 `get_agent_profile` 读取完整 tool description。
- [x] 按 Round 93 的 binding stack 落地：brief tool 必须同步 runtime tool、global builtin registry、profile typed binding、director toolset、compiled artifact 和 `get_agent_profile` 的 `toolKeys` 发现结果。
- [x] 按 Round 94 的 route shape 落地：brief HTTP route 使用 `chapter-writer-brief` 顶层 segment 与 `projectPath/chapterPath` query，业务校验复用 `PlotScopeGuard.assertChapterPath()`，不要把 chapterPath 放进 URL path segment。
- [x] 按 Round 95 的 compiled evidence 落地：Slice 1 后 system/user director manifest 的 `sourceSha256/artifactSha` 必须离开当前旧值，active artifact 不再包含 `simulator_requests` / `Simulation gate`，并含 `world_engine_requests`。
- [x] 按 Round 97 的 context 复用边界落地：保留 `getSceneWorldContext(sceneId)` 的 HTTP strict 语义，给 `ChapterWriterBriefService` 复用 Scene 实体级 helper；brief status 不靠捕获错误 message 判定，缺 anchor 在 service 内主动聚合为 warning/status。
- [x] 按 Round 99 的 renderer seam 落地：`suggestedBriefMarkdown` renderer 第一版放在 `ChapterWriterBriefService` implementation 内，service fixture 测 section marker、正向字段和 raw patch JSON / 完整 attrs / 伪造 ChapterOverride 负断言；tool 测试只验 text/details 传递。
- [x] 按 Round 100 的实现入口 gate 落地：不要因为 brief DTO/renderer 细节先实现 `get_chapter_writer_brief`；先做 Profile Contract Cleanup，再按 OpenAPI Explicit Path -> Chapter Writer Brief Module -> Agent Tool Binding 推进，并按每个切片运行匹配测试。
- [x] 按 Round 101 的 Slice 1 patch surface 落地：同步 `builtin-contracts.ts`、system/user director source、leader.default、writer、`leader-default.md`、`profile-routing.md`、`novel-writing-workflow.md` 和 profile/schema tests；旧 `simulator_requests`、旧 `plot` kind、extra fields、旧 simulator gate 必须被拒绝。
- [x] 按 Round 104-106 的 brief module seam 落地：新增 `findChapterScenesForBrief()`、Scene 实体级 World Context helper、`ChapterWriterBriefService` status fixture 和 `suggestedBriefMarkdown` 正负断言；不要复用 HTTP strict 方法或扩胖 UI DTO。
- [x] 按 Round 107-109 的 Agent tool binding guard 落地：`get_chapter_writer_brief` tool text 返回 `suggestedBriefMarkdown`、details 返回完整 DTO、不读写 `plot.selection`；同步 runtime tool、global registry、typed binding、system/user director toolset、writer isolation、`get_agent_profile` toolKeys 和 compiled artifact。
- [x] 按 Round 110-112 的最终架构与完成审计落地：第一阶段继续采用 Director + Brief Compiler，不新增 `brief.compiler` profile，不扩大 leader/writer/world.engine 工具面；实现完成后按 completion audit matrix 逐项提供强证据。
- [x] 按 Round 113-115 的 Slice 1 可执行地图落地：reference 不再排除 director/Plot，Profile Contract Cleanup 同步 schema/source/reference/compiled artifact/tests，并迁移 director、leader.default、writer 相关断言。
- [x] 按 Round 116-118 的执行看板落地：Slice 2 同步 canonical OpenAPI 与 route-local representative，Slice 3 新增 deep brief read model Module，Slice 4 再做 Agent tool binding；不要跳过 Slice 1 直接实现 brief tool。
- [x] 按 Round 119-121 的运行时证据口径验收：Profile Contract Cleanup 后必须证明 system/user active director source、manifest、artifact 和 catalog discovery 都不再使用旧 simulator contract；`profile check/status`、user assets sync 输出、active artifact grep 和 static / faux / real Agent smoke 需要分层报告，不能互相替代。
- [x] 按 Round 122-124 的 Slice 1 原子合同开工：`DirectorOutputSchema` 删除 `simulator_requests` / `"plot"` kind 并 strict，director prompt 改用 `world_engine_requests`，leader.default 把 Scene / Chapter / brief 路由到 director，writer 保持无 Plot tools 但可消费上游 Scene / World Context brief；测试必须覆盖 schema strict、leader routing、writer isolation 和 prompt 旧词消失。
- [x] 按 Round 125-127 的 Slice 2 OpenAPI gate 落地：`RouteMetaEntry.file` 与 public `path` 分离，新增 `emitRouteMeta?: boolean`；canonical spec 通过 `buildOpenAPISpecForRoutes(entries)` fixture 证明 explicit path、path/query params、同物理 file 多 public path 和 duplicate `path + method` guard；route-local metadata 按 file 分组选择唯一 representative，future `chapter-writer-brief` 可 `emitRouteMeta: false`，不能再 silent last-wins。
- [x] 按 Round 128 的 OpenAPI operation builder seam 落地：canonical spec 与 route-local meta 共用同一套 public path / path params / query/body/response operation builder；`generate-openapi-meta.ts` 的 selector 与 operation generation 必须可测试，不能依赖 import 时执行 `main()` 或真实写 route files。
- [x] 按 Round 129 的 Profile Contract 测试 seam 落地：director 测 schema strict 和旧 simulator gate 消失，leader.default 测 Scene / Chapter / writer brief 路由 director 且无 Plot tools，writer 测无 Plot tools但可消费上游 Scene / World Context brief；三者都通过后再做 compiled artifact 验收。
- [x] 按 Round 130 的 Brief read model gap 落地：新增 `findChapterScenesForBrief()`，不要扩胖 UI 用 `ChapterPlotDetailDto`；`SceneWorldContextService` 增加 Scene 实体级 helper，brief service 自己聚合 `needs_plot / needs_world_anchor / needs_world_context / ready` 和 warnings，tool text 以 `suggestedBriefMarkdown` 为主体。
- [x] 按 Round 131 的 Agent tool binding gap 落地：`get_chapter_writer_brief` 必须同步 `PlotFacade.getChapterWriterBrief()`、runtime tool、`buildAgentTools()`、`builtin.plot.getChapterWriterBrief`、director toolset、writer isolation、`get_agent_profile` 的 `toolKeys` 发现和 compiled artifact；tool Adapter 不读写 `plot.selection`，默认 text 为 `suggestedBriefMarkdown`，完整 DTO 放 `details`。
- [x] 按 Round 132 的 Profile Contract Cleanup 开工顺序落地：先改 `DirectorOutputSchema` strict 和字段迁移，再改 system/user director source、leader.default prompt/reference、writer language，随后补 director / leader / writer 测试，最后验证 active user source、manifest `artifactSha` 和 artifact 内容；如果需要保留 `simulator_requests` alias、`"plot"` kind 或让 writer 持有 Plot tools，应停止并报告。
- [x] 按 Round 133 的 OpenAPI Explicit Path 开工顺序落地：先扩展 `RouteMetaEntry.path/emitRouteMeta` 并给 world-context explicit path，再抽共享 operation builder，导出 `buildOpenAPISpecForRoutes(entries)` 并加 duplicate guard，最后让 `generate-openapi-meta.ts` 通过 representative selector 复用同一 operation builder；测试使用 synthetic entries，不依赖真实写 route files。
- [x] 按 Round 134 的 Chapter Writer Brief Module 开工顺序落地：新增 `ChapterWriterBriefDtoSchema`、`findChapterScenesForBrief()`、Scene 实体级 World Context helper、`ChapterWriterBriefService` status fixture 和 `suggestedBriefMarkdown` 正负断言；不要扩胖 `ChapterPlotDetailDto`，不要靠捕获 `getSceneWorldContext()` 错误 message 判断状态，HTTP/tool 层只做 Adapter。
- [x] writer 完成后由 leader 负责 post-write reconciliation：新事实回补 World Engine，再由 leader 更新 Scene / Thread summary；writer 不直接更新 Plot。
- [x] 后续设计 Chapter Override / WriterBriefService：承接 POV、tone、reader information、do-not-reveal、章节收尾等 writer-facing 指令。已单列到 Task 80（更名 ChapterBrief 落地于 [Task 87](../87-plot-two-trees-and-writer-modes/README.md)，Task 80 归档见 [archived/chapter-override-writer-brief](../archived/chapter-override-writer-brief/README.md)），不属于 Task 78 完成门禁。
- [x] 修复 DTO drift 剩余点：`PlotFacade.parseWorldAnchorDto()` 已改接收 `StorySceneWorldAnchorInputDto`；前端 empty anchor 与 `SceneWorldContextService.unresolvedSubjectIds` 已补齐。
- [x] 用独立 `SceneWorldAnchorResolutionService` 统一把 `subjectIds/locationSubjectId` resolve 为 `{id,name,type,resolved}`，供 Workbench、Scene World Context 和后续 writer brief 复用；该服务使用 calendar-free subject identity，避免 Plot 读取强依赖 World Engine calendar。

### 实施路径（Phase 1-4）

#### Phase 1：数据层基础（2-3 天）

**目标**：完成 Scene World Anchor 的数据层支持，不涉及 UI。

- [x] Prisma Schema 变更：`StoryScene` 添加 `startInstant?`、`endInstant?`、`subjectIdsJson`、`locationSubjectId?`
- [x] 生成 Prisma Client 并编写数据库迁移脚本
- [x] TypeScript 类型定义：`SceneWorldAnchor`、`StorySceneWorldAnchorDto`
- [x] Repository 层更新：处理 `subjectIdsJson` 序列化/反序列化
- [x] 服务层验证：`scene-world-anchor.validator.ts`（时间范围校验、去重）
- [x] Facade 层集成 World Engine：注入 `worldEngineFacade`，实现 `parseTime/formatTime` 转换

**验收标准**：Prisma 迁移脚本可执行、可通过 API 创建带 World Anchor 的 Scene、Repository 层测试通过。

#### Phase 2：StoryPlot 删除与数据迁移（2-3 天）

**目标**：删除 `StoryPlot` 表和相关代码，迁移数据到 Scene。

- [x] 数据迁移脚本：读取所有 `StoryPlot`，将 `summary/effect/writingTip` 合并到 Scene，备份原始数据
- [x] Prisma Schema 变更：删除 `model StoryPlot` 和相关关系
- [x] 后端代码清理：删除 Plot 相关 Repository、Service、DTO、HTTP endpoints
- [x] Agent 工具更新：删除 `create_story_plot`、`create_story_plots`、`update_story_plot` 工具

**验收标准**：数据迁移脚本可执行、Scene 数据完整（Plot 信息已合并）、后端编译通过、Agent 工具列表中不再有 Plot 相关工具。

#### Phase 3：Scene 查询 World Engine API（2-3 天）

**目标**：实现服务端封装的 Scene 查询 World Engine 上下文 API。

- [x] 新建桥接 Module：`scene-world-context.service.ts`
- [x] 查询收窄策略：按时间范围 + `subjectIds/locationSubjectId` 过滤 patches
- [x] DTO 设计：`SceneWorldContextDto`（slices 摘要 + subjects 状态）
- [x] HTTP API：`GET /api/projects/plot/scenes/:sceneId/world-context`
- [x] 单元测试和集成测试

**验收标准**：可通过 API 查询 Scene 的 World Engine 上下文、返回数据按 subjects 过滤、错误处理完善。

#### Phase 4：前端 UI 实现（3-5 天）

**目标**：Plot Workbench 接入 World Engine，用户可见可用。

- [x] Scene Card 改动：新增 World Engine 状态指示器（时间、地点、出场人数）
- [x] Inspector 改动：新增 World Engine 连接编辑区域（时间范围输入、Subject 选择器、地点选择器）
- [x] 新增组件：`SubjectMultiSelect.vue`、`SubjectSingleSelect.vue`、`WorldEngineContextPanel.vue`
- [x] API 集成：调用 `GET /api/projects/plot/scenes/:sceneId/world-context`
- [x] UI 交互流程：创建/编辑 Scene 支持 World Anchor 字段、查看上下文按钮

**验收标准**：用户可在 Plot Workbench 中创建带 World Engine 连接的 Scene、Scene Card 正确显示连接状态、可查看 World Engine 上下文、未连接的 Scene 仍可正常使用。

**总工作量估算**：9-14 天。Phase 1 和 Phase 2 可并行；Phase 3 依赖 Phase 1；Phase 4 依赖 Phase 3。
