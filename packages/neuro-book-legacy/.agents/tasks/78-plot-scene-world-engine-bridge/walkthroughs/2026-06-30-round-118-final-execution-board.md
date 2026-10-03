# Round 118: Final Execution Board

## Scope

本轮把 Task 78 后续 Agent 易用性改造压成最终执行看板。目标是把继续探索的收益降到最低，给后续实现一个清晰入口。没有改业务代码、没有运行测试。

## Execution Order

固定顺序：

```text
1. Profile Contract Cleanup
2. OpenAPI Explicit Path
3. Chapter Writer Brief Module
4. Agent Tool Binding
```

不要跳到 brief tool。brief tool 绑定到旧 director contract 会制造错配。

## Slice 1: Profile Contract Cleanup

Files:

- `server/agent/profiles/builtin-contracts.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `reference/agent/leader-default.md`
- `reference/agent/profile-routing.md`
- `reference/agent/novel-writing-workflow.md`
- profile tests
- compiled system/user artifacts

Must prove:

- no `simulator_requests`
- no `kind: "plot"`
- no `Simulation gate`
- leader routes Scene/Chapter/brief to director
- writer can consume upstream Scene / World Context brief but has no Plot tools
- strict schema rejects old fields
- active artifact updated

## Slice 2: OpenAPI Explicit Path

Files:

- `server/openapi/route-map.ts`
- `server/openapi/generate-spec.ts`
- `scripts/build/generate-openapi-meta.ts`
- `server/openapi/generate-spec.test.ts`
- optional generator tests

Must prove:

- `RouteMetaEntry.path?: string`
- `RouteMetaEntry.emitRouteMeta?: boolean`
- duplicate `path + method` guard
- world-context and chapter-writer-brief have separate paths
- route-local representative does not last-win overwrite

## Slice 3: Chapter Writer Brief Module

Files:

- `shared/dto/plot.dto.ts`
- `server/plot/contracts/plot-repositories.ts`
- `server/plot/core/types.ts`
- `server/plot/repositories/prisma-scene.repository.ts`
- `server/plot/services/chapter-writer-brief.service.ts`
- `server/plot/services/scene-world-context.service.ts`
- `server/plot/facade/plot.facade.ts`
- `server/api/projects/plot/[...segments].ts`
- DTO/service/HTTP tests

Must prove:

- `ChapterWriterBriefDtoSchema`
- `findChapterScenesForBrief()`
- Scene entity-level World Context helper
- status precedence fixtures
- `suggestedBriefMarkdown` information boundary
- no writer target path in brief

## Slice 4: Agent Tool Binding

Files:

- `server/agent/tools/plot-tools.ts`
- `server/agent/tools/index.ts`
- `server/agent/profiles/profile-tools.ts`
- system/user director profiles
- profile/tool tests
- compiled artifacts

Must prove:

- `get_chapter_writer_brief` runtime tool exists
- input only `{projectPath, chapterPath}`
- text is `suggestedBriefMarkdown`
- details is full DTO
- no `plot.selection` read/write
- director toolset and `get_agent_profile("director").toolKeys` include brief tool
- writer toolKeys exclude Plot/brief tools
- active artifact includes new key

## Cross-Slice Stop Conditions

Stop rather than hack if:

- user profile shadow cannot be safely synced.
- schema needs compatibility alias for old `simulator_requests`.
- route-local metadata forces losing canonical multi-operation OpenAPI.
- brief service has to parse error messages to infer missing anchor.
- writer requires Plot tools to pass tests.
- compiled artifact cannot be updated.

## Current Status

Design is complete enough for implementation. Current worktree still shows:

- `DirectorOutputSchema` old fields remain.
- director system/user source still has simulator gate.
- reference still excludes director/Plot in ordinary writing.
- OpenAPI explicit path not implemented.
- brief DTO/service/read model not implemented.
- brief runtime tool/profile binding not implemented.

## Conclusion

Further broad exploration is unlikely to change architecture. The next aligned action is Slice 1 `Profile Contract Cleanup`, followed by the three remaining slices. Completion remains unproven until all four slices and compiled runtime evidence pass the audit matrix.

