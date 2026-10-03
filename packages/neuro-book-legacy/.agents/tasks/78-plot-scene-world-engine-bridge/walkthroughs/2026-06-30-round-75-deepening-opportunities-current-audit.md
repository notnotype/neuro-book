# Round 75: Deepening Opportunities Current Audit

## Scope

本轮按 Module / Interface / Depth / Seam / Adapter / Leverage / Locality 重新审计当前实现入口。目标不是继续发明新方案，而是确认哪些 Module 值得加深，哪些只需要按既定切片实现。

## Evidence Checked

- `CONTEXT.md`
  - 当前稳定领域词汇是 **Project Workspace**、**Project Path**、**Project SQLite**、**Agent ReAct Loop**、**Agent Dialogue Content** 等。
  - Plot/World Engine 本轮实现仍应以 Project Path 定位 Project Workspace，以 Project SQLite 存 Plot 结构。
- `reference/agent/profile-routing.md`
  - `leader.default` 仍写着“不路由到 Plot / simulator / director / RP”。
  - `director` 仍写“世界状态未裁决先转 simulator.leader”。
- `reference/agent/novel-writing-workflow.md`
  - 普通写作链仍是 `leader.default -> writer`。
  - `director`、Plot System 仍被放在 legacy 语境。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
  - 当前 System 仍含 `simulator.leader`、`Simulation gate` 和 `simulator_requests`。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
  - writer 已把 `invoke_agent.message` 和 `invoke_agent.input.path` 作为核心输入。
  - 但 `normalizePayloadContext()` 注释仍写“写作模式不使用 Plot 系统”，容易把“writer 不直接持有 Plot tools”误读成“上游 brief 也不应来自 Plot”。
- `server/agent/tools/plot-tools.ts`
  - Plot tools 当前是一个混合 Module：负责 runtime tool schema、session `plot.selection`、Facade 调用和 JSON result。
  - 尚无 `get_chapter_writer_brief`。
- `server/plot/facade/plot.facade.ts`
  - 已有 Scene World Anchor 解析与 Scene World Context 门面。
  - 尚无 Chapter Writer Brief 门面。

## Deepening Candidates

### 1. Director Contract Module

Files:

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `server/agent/profiles/builtin-contracts.ts`
- `reference/agent/profile-routing.md`
- `reference/agent/novel-writing-workflow.md`
- `server/agent/profiles/simulation-director-profiles.test.ts`

Problem:

当前 director 的 Interface 分散在 prompt、OutputSchema、reference、profile tests 和 compiled artifact。任意一处没改，Agent 都可能继续走旧 simulator gate。删除 director prompt 里的旧段落后，复杂度会在 reference 和 schema 中继续出现；这说明当前 Module 还不够深。

Solution:

先按 Slice 1 把 director contract 做成一致的 Interface：System prompt、OutputSchema、reference 和 tests 全部表达同一套 `leader.default -> director -> writer/world.engine` 语义。

Benefits:

- Leverage：后续 `get_chapter_writer_brief` 不会被旧 `simulator_requests` 吸走。
- Locality：普通写作 profile 路由问题集中在 director contract 测试失败，而不是在真实 Agent 运行时分散暴露。

### 2. Chapter Writer Brief Module

Files:

- `shared/dto/plot.dto.ts`
- `server/plot/contracts/plot-repositories.ts`
- `server/plot/repositories/prisma-scene.repository.ts`
- `server/plot/services/chapter-writer-brief.service.ts`（待新增）
- `server/plot/facade/plot.facade.ts`

Problem:

当前 `ChapterPlotDetailDto` 是 UI/简读 Interface，只含 thread `id/title/isMainThread`，不含 thread `summary/writingTip`，也不含 Scene `writingTip`。如果 brief v1 复用它，调用方仍需要再串 `get_story_thread`、`get_story_scene_context`、`get_scene_world_context` 才能组成 writer brief。

Solution:

新增 `ChapterWriterBriefService` 作为 Plot 的只读深 Module。Interface 保持 `projectPath + chapterPath -> ChapterWriterBriefDto`，Implementation 负责 chapter scene 查询、thread summary/writingTip、Scene writingTip、Scene World Context、status/warnings 和 `suggestedBriefMarkdown`。

Benefits:

- Leverage：director 只学一个 tool，不学多步工具串和 status 聚合规则。
- Locality：brief 信息边界、raw patch JSON 排除、unresolved subject 规则和 markdown renderer 在一个 Module 内验证。

### 3. OpenAPI Path Metadata Module

Files:

- `server/openapi/route-map.ts`
- `server/openapi/generate-spec.ts`
- `server/api/projects/plot/[...segments].ts`

Problem:

`RouteMetaEntry` 当前没有 explicit `path`，`buildPath()` 只按 file 推导。catch-all `projects/plot/[...segments].ts` 会生成机器不可用的泛化 path，且多个 GET operation 无法在 OpenAPI paths 中表达为独立 Interface。

Solution:

给 route metadata 增加 `path?: string`，让 catch-all route 的公开 path 由 metadata 明确声明。world-context 与 chapter-writer-brief 各自占一个 OpenAPI path。

Benefits:

- Leverage：以后同一个 catch-all route 下新增公开 operation 不再重复修 generator。
- Locality：path 表达错误由 `generate-spec` 测试发现，不需要等前端/Agent 对照失败。

### 4. Agent Tool Availability Module

Files:

- `server/agent/tools/plot-tools.ts`
- `server/agent/tools/index.ts`
- `server/agent/profiles/profile-tools.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `.compiled/manifest.json` + `artifacts/<sha>.mjs`

Problem:

工具可用性跨 runtime registry、global registry、typed binding、profile source、profile catalog 和 compiled artifact。任何一层漏改都会出现“代码有工具但 Agent 调不到”的假完成。

Solution:

不要先抽象新框架。第一期用针对 `get_chapter_writer_brief` 的静态测试和 compiled artifact 检查锁住这条链路；只有后续多工具重复出现同样问题，再考虑更通用的 Tool Availability Module。

Benefits:

- Leverage：当前功能能闭环。
- Locality：避免为单工具引入过早 seam，但保留测试证据链。

## Recommendation

当前应继续执行既定四个切片，不新增第五个大 refactor：

1. Profile Contract Cleanup
2. OpenAPI Explicit Path
3. Chapter Writer Brief Module
4. Agent Tool Binding

若要继续架构探索，最有价值的候选是第 2 个：`ChapterWriterBriefService` 的 DTO 与 status/warnings 细节。其它候选已经足够清晰，可以直接进入实现。

