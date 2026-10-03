# 2026-06-30 Round 27 - Deepening Opportunities

## Scope

本轮用 Module / Interface / Depth / Locality 的视角检查 Plot 工具改造的剩余架构摩擦。目标不是提出更多大方向，而是识别哪些 Module 值得加深，避免把复杂度摊到 profile prompt 或 Agent tool handler 里。

本轮不修改业务代码。

## Current Evidence

当前真实断点：

- `DirectorOutputSchema` 仍允许 `plot_updates.kind = "plot"`，且仍有 `simulator_requests`。
- `director.profile.tsx` 仍有 `Simulation gate`，并把未裁决状态导向 `simulator.leader`。
- `leader.default.profile.tsx` 仍说写作模式不维护旧 Plot / simulation 系统，且不要路由到它们。
- `reference/agent/novel-writing-workflow.md` 仍把 `director` / Plot System 放进 Legacy Boundary。
- `RouteMetaEntry` 还没有 `path` override，`buildPath()` 仍只能从 catch-all file 推导 OpenAPI path。
- `findChapterScenes()` 只 include thread `id/title/isMainThread`，brief v1 缺 thread summary。

## Deepening Opportunity 1: Director Contract Module

**Files**

- `server/agent/profiles/builtin-contracts.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `server/agent/profiles/simulation-director-profiles.test.ts`

**Problem**

director 的 Interface 同时暴露新 Scene-only Plot System 和旧 simulation 语义。调用方需要记住“虽然 schema 允许 plot/simulator_requests，但实际不该用”。这是浅 Interface：复杂度没有被 Module 吃掉，而是转移给 profile prompt 和上游 leader。

**Solution**

把 director 的输出 Interface 加深：

- `plot_updates.kind` 只允许 `thread | scene`。
- `simulator_requests` 改为 `world_engine_requests`。
- prompt 中的 Simulation gate 改为 World Engine request gate。

**Benefits**

- Locality：旧 Plot/simulator 语义集中从 director contract 删除，而不是要求每个调用方记住例外。
- Leverage：profile tests 可以直接用 schema 和 prompt 断言防回归。
- Deletion test：如果不改这个 Module，旧语义会持续散落在 leader prompt、routing doc、writer handoff 和 tests 中。

## Deepening Opportunity 2: Chapter Writer Brief Module

**Files**

- `shared/dto/plot.dto.ts`
- `server/plot/services/chapter-writer-brief.service.ts`
- `server/plot/repositories/prisma-scene.repository.ts`
- `server/agent/tools/plot-tools.ts`

**Problem**

没有 brief Module 时，director 需要手动串 `get_chapter_plot`、逐 Scene `get_scene_world_context`、Thread summary 查询和 markdown handoff。这个 Interface 对 Agent 来说太浅：它要求调用方知道查询顺序、缺失 anchor 的语义、World Context 错误如何降级、writer 不应接 raw patch JSON。

**Solution**

新增 `ChapterWriterBriefService`，让 Interface 只要求 `projectPath + chapterPath`，返回：

- `status`
- `warnings`
- `worldQueryHints`
- `suggestedBriefMarkdown`
- 供 UI/tool 查看用的结构化 details

**Benefits**

- Locality：brief 状态判断、warnings、markdown 结构集中在一个只读 Module。
- Leverage：director、后续 leader 只读工具、未来 ChapterOverride 都复用同一个 Interface。
- Tests：以 brief Module 为测试面，比测试 Agent 手动工具串调用更稳定。

## Deepening Opportunity 3: Route Path Metadata Module

**Files**

- `server/openapi/route-map.ts`
- `server/openapi/generate-spec.ts`
- `scripts/build/generate-openapi-meta.ts`

**Problem**

catch-all route file `projects/plot/[...segments].ts` 承载多条语义 route，但 OpenAPI 只能按 file 推导 path。新增 brief route 时，文档与生成 metadata 会把多个 GET operation 叠到同一路径，属于 Interface 漏洞。

**Solution**

给 `RouteMetaEntry` 增加 `path?: string`。`buildPath()` 和 build script 优先使用显式 path。

**Benefits**

- Locality：catch-all path 表达规则集中在 OpenAPI Module。
- Leverage：后续 world-engine 或 plot catch-all route 都可复用。
- Tests：可以直接断言 `/api/projects/plot/scenes/{sceneId}/world-context` 与 `/api/projects/plot/chapter-writer-brief` 同时存在。

## Deepening Opportunity 4: Query-Oriented Anchor Resolution

**Files**

- `server/plot/services/scene-world-anchor-resolution.service.ts`
- `server/plot/services/scene-world-context.service.ts`
- future `server/plot/services/chapter-writer-brief.service.ts`

**Problem**

`SceneWorldAnchorResolutionService` 已经解决展示型 resolved/unresolved。但 `SceneWorldContextService` 仍自己计算查询型 resolved subject id 集合。brief v1 也会需要类似集合。

**Solution**

短期不新增 Interface，brief v1 先复用已解析 DTO + `SceneWorldContextService`。如果重复出现，再把 `SceneWorldAnchorResolutionService` 扩展为两个 Interface：

- 展示型：`resolveMany()` 返回 DTO。
- 查询型：返回 `{resolvedSubjectIds, unresolvedSubjectIds, subjectNameMap}`。

**Benefits**

- 避免过早抽象。
- 一旦重复出现，可以集中 subject resolution 的查询语义。
- 保留当前已通过测试的展示 Interface。

## Result

当前最值得优先加深的不是 leader profile，而是三个 Module：`DirectorOutputSchema` / director prompt 形成的 director contract、`ChapterWriterBriefService`、OpenAPI route metadata。leader 保持较小工具面，靠更深的 director 和 brief Interface 获得 Agent 易用性。

