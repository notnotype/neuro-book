# 2026-06-30 Round 41 - Atomic Patch Sequence

## Scope

本轮把后续实现拆成原子补丁顺序。目标是每个补丁结束时系统都处在可解释状态，避免一次性混入 prompt、OpenAPI、service、tool binding 后难以定位失败。

本轮不修改业务代码。

## Patch 1 - Profile Contract Cleanup

文件范围：

- `reference/agent/profile-routing.md`
- `reference/agent/leader-default.md`
- `reference/agent/novel-writing-workflow.md`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `server/agent/profiles/builtin-contracts.ts`
- 相关 profile tests

目标：

- 普通写作中，Plot = Scene-only 作者结构层，不是 legacy boundary。
- director 是 Plot write owner 和未来 brief compiler。
- writer 没有 Plot tools，只消费完整 writer brief。
- 未裁决世界事实进入 `world_engine_requests`，由 leader 用 World Engine 处理。
- 删除 `plot_updates.kind = "plot"` 和 `simulator_requests`。

验收：

- profile prompt grep 不再命中普通写作 director 的 `Simulation gate` / `simulator_requests`。
- schema tests 证明 `plot` kind 被拒绝。
- 不新增 `get_chapter_writer_brief` tool。

## Patch 2 - OpenAPI Explicit Path

文件范围：

- `server/openapi/route-map.ts`
- `server/openapi/generate-spec.ts`
- 新增或更新 OpenAPI spec 测试

目标：

- `RouteMetaEntry` 增加 `path?: string`。
- `buildPath(file, entry)` 优先使用 `entry.path`。
- 现有 world-context route 先补显式 path：`/api/projects/plot/scenes/{sceneId}/world-context`。

验收：

- OpenAPI spec 中 world-context path 正确。
- 该补丁不引入 brief route，不改 Plot runtime 行为。

## Patch 3 - Chapter Writer Brief Module

文件范围：

- `shared/dto/plot.dto.ts`
- `server/plot/contracts/plot-repositories.ts`
- `server/plot/repositories/prisma-scene.repository.ts`
- `server/plot/services/chapter-writer-brief.service.ts`
- `server/plot/facade/plot.facade.ts`
- `server/api/projects/plot/[...segments].ts`
- `server/openapi/route-map.ts`
- DTO / service / HTTP tests

目标：

- 新增 scene/world-only `ChapterWriterBriefDto`。
- 新增只读 `ChapterWriterBriefService`。
- repository 提供 brief 所需的 chapter scene + thread summary 查询，不复用过轻的 `findChapterScenes()` 造成 summary 缺失。
- service 复用现有 Scene World Anchor resolved/unresolved 语义。
- HTTP route 提供 `GET /api/projects/plot/chapter-writer-brief`。

验收：

- API 能返回 `ready / needs_plot / needs_world_anchor / needs_world_context`。
- `suggestedBriefMarkdown` 存在且不包含 raw patch JSON / 完整 attrs / 伪造 ChapterOverride 字段。
- OpenAPI spec 同时有 world-context 和 chapter-writer-brief，两者不覆盖。

## Patch 4 - Agent Tool Binding

文件范围：

- `server/agent/tools/plot-tools.ts`
- `server/agent/tools/plot-tools.test.ts`
- `server/agent/tools/index.ts`
- `server/agent/profiles/profile-tools.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- 相关 profile tests

目标：

- 新增 `get_chapter_writer_brief` tool。
- tool 参数为 `{ projectPath, chapterPath }`。
- 不依赖、不修改 `plot.selection`。
- 第一阶段只给 director；leader.default / writer 不持有该 tool。

验收：

- tool test 证明 facade 调用、status 透传、selection 不变。
- director profile test 证明 tool 暴露和 status handling prompt。
- writer profile test 证明 writer 没有 Plot tools。

## Stop Conditions

实现中遇到以下情况应停止并回报，而不是绕过：

- profile tests 必须保留 `simulator_requests` 才能通过。
- `DirectorOutputSchema` 删除旧字段导致 report_result runtime 无法显示或提交，需要先修 report_result schema 派生。
- OpenAPI explicit path 需要重写生成链，而不是小改 `RouteMetaEntry`。
- brief service 被迫引入 POV、tone、do-not-reveal 等 ChapterOverride 字段。
- 为了减少查询而把 World Engine dynamic attrs raw dump 塞进 brief。

## Result

下一步真正实现时，推荐严格按四个补丁推进：先改 profile contract，再修 OpenAPI path，再做 brief service/API，最后绑定 Agent tool。这样每个失败点都有明确归属，也能保证 `get_chapter_writer_brief` 被新的 director 心智使用，而不是被旧 simulator gate 吸走。

