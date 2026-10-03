# 2026-06-30 Round 29 - Implementation Slices

## Scope

本轮把现有探索压成可执行的实现切片和验收证据。目标是后续进入实现时不再重新讨论架构，也不把多个高风险点混在同一个补丁里。

本轮不修改业务代码。

## Slice 1: Profile Contract Cleanup

**Files**

- `reference/agent/profile-routing.md`
- `reference/agent/leader-default.md`
- `reference/agent/novel-writing-workflow.md`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/simulation-director-profiles.test.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts`

**Required outcome**

- 普通写作允许 `leader.default -> director` 处理 Plot 结构。
- director 不再引用 `simulator_requests` 或 Simulation gate。
- `DirectorOutputSchema` 删除 `kind: "plot"`，新增 `world_engine_requests`。
- writer 注释和 prompt 不再说“写作模式不使用 Plot 系统”，而是说 writer 不直接使用 Plot tools。

**Acceptance evidence**

- profile prompt 测试断言旧文本不存在。
- TypeBox schema 测试证明 `plot` kind 被拒绝，`world_engine_requests` 被接受。
- leader / writer toolKeys 仍没有 Plot write tools。

## Slice 2: OpenAPI Explicit Path

**Files**

- `server/openapi/route-map.ts`
- `server/openapi/generate-spec.ts`
- `scripts/build/generate-openapi-meta.ts`
- OpenAPI generator tests if present; otherwise add focused test.

**Required outcome**

- `RouteMetaEntry.path?: string`。
- `buildPath()` 优先返回 `entry.path`。
- build script 生成 route meta 时也使用同一 path 规则。

**Acceptance evidence**

- spec 中同时存在：
  - `/api/projects/plot/scenes/{sceneId}/world-context`
  - `/api/projects/plot/chapter-writer-brief`
- 两个 GET operation 不互相覆盖。

## Slice 3: Chapter Writer Brief Module

**Files**

- `shared/dto/plot.dto.ts`
- `server/plot/contracts/plot-repositories.ts`
- `server/plot/repositories/prisma-scene.repository.ts`
- `server/plot/services/chapter-writer-brief.service.ts`
- `server/plot/services/scene.service.ts` or `server/plot/facade/plot.facade.ts`
- `server/api/projects/plot/[...segments].ts`

**Required outcome**

- 新增 scene/world-only `ChapterWriterBriefService`。
- repository 查询能取到 chapter scenes + thread summary。
- DTO 包含 `status/warnings/worldQueryHints/suggestedBriefMarkdown`。
- `suggestedBriefMarkdown` 不包含 raw patch JSON，不伪造 ChapterOverride 字段。

**Acceptance evidence**

- 无 Scene -> `needs_plot`。
- 缺完整时间 -> `needs_world_anchor`。
- World Context 查询失败 -> `needs_world_context`。
- 部分 unresolved subject -> warnings，必要时仍可 `ready`。
- markdown 包含 Scene 顺序、Thread context、World query hints。

## Slice 4: Agent Tool Binding

**Files**

- `server/agent/tools/plot-tools.ts`
- `server/agent/tools/index.ts`
- `server/agent/profiles/profile-tools.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `server/agent/tools/plot-tools.test.ts`
- `server/agent/profiles/simulation-director-profiles.test.ts`

**Required outcome**

- 新增 Agent tool `get_chapter_writer_brief`。
- `builtin.plot.getChapterWriterBrief` typed binding。
- director 持有 brief tool。
- leader/writer 不新增 Plot write tools。

**Acceptance evidence**

- tool test 证明 `get_chapter_writer_brief` 调 Facade/Service 并返回 DTO。
- director rootToolKeys 包含 brief tool。
- writer profile test 仍证明没有 Plot tools。

## Slice 5: Optional Leader Readonly Brief

**Trigger**

只有在真实使用中发现 director 往返成本过高，才考虑。

**Rule**

如果加，只给 `leader.default` 加 `get_chapter_writer_brief`，不加 create/update Plot tools。

**Acceptance evidence**

- leader prompt 明确该 tool 只用于检查 handoff，不用于维护 Plot 结构。
- leader toolKeys 不含 Plot write tools。

## Result

后续实现应按 Slice 1 -> 2 -> 3 -> 4 顺序推进。Slice 5 是观察项，不进入第一阶段。这样每个补丁的 Interface 和测试面都明确，避免同时改 profile 语义、OpenAPI、DTO、Service 和 tool binding 导致问题难以定位。

