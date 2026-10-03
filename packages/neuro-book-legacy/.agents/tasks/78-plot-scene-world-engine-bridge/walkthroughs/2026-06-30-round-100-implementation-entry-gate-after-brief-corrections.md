# Round 100: Implementation Entry Gate After Brief Corrections

## Scope

本轮只读复核 Round 96-99 对 brief service、DTO、tool text 和 markdown renderer 的修正是否改变既定实现顺序。没有改业务代码、没有运行测试。

## Current Evidence

- `server/agent/profiles/builtin-contracts.ts` 仍是 Slice 1 的首要缺口：`DirectorOutputSchema` 仍允许 `plot_updates.kind = "plot"`，仍包含 `simulator_requests`，且 root / item 尚未显式 strict。
- system 与 user 的 `director.profile.tsx` 仍包含 `simulator.leader`、`Simulation gate`、`simulator_requests`。
- `simulation-director-profiles.test.ts` 已是 director profile contract 的现有测试 seam，但当前只验证 `get_scene_world_context`、不包含旧字段负例或 `world_engine_requests`。
- `leader-assets-profile.test.ts` 覆盖 `leader.default` 和 writer prepare；当前 writer payload schema 仍有 `threadIds/sceneIds/plotIds` 字段，但 prepare 测试会断言这些旧 ids 不进入 writer visible context。
- `writer.profile.test.ts` 已证明 writer 有 readonly `execute_world` 且没有 Plot tools；后续应新增 `get_chapter_writer_brief` 也不进入 writer root tools 的断言。
- `server/openapi/route-map.ts` 的 `RouteMetaEntry` 仍没有 `path?: string`；`generate-spec.ts buildPath(file, _entry)` 仍忽略 entry；`generate-openapi-meta.ts` 仍只基于 query/body 生成 route-local metadata。
- `shared/dto/plot.dto.test.ts` 当前只覆盖 World Anchor DTO；尚无 `ChapterWriterBriefDtoSchema` shape 测试。
- `server/agent/tools/plot-tools.test.ts` 只覆盖现有 Plot tools 和 `get_scene_world_context` 会写 selection；未来 `get_chapter_writer_brief` 必须反向证明不写 selection。

## Decision

Round 96-99 没有改变四个实现切片顺序：

1. Profile Contract Cleanup
2. OpenAPI Explicit Path
3. Chapter Writer Brief Module
4. Agent Tool Binding

原因：

- Round 98/99 只修正 Slice 3 / Slice 4 的 DTO 和 renderer细节；它们不能先于 Slice 1 落地，否则新 brief tool 会绑定到旧 director contract 上。
- Slice 1 的 Interface 是 profile contract，不依赖 `ChapterWriterBriefService` 是否已实现；它应该先把旧 simulator gate 和旧 `plot` kind 移除。
- Slice 2 的 explicit path 是 HTTP/OpenAPI seam，必须先让 catch-all route 能正确表达 world-context 与 future chapter-writer-brief，避免 Slice 3 的 route 一落地就进入错误 spec。
- Slice 3 才消费 Round 96-99 的 brief service / DTO / renderer 细节。
- Slice 4 才消费 Round 98 的 tool text 决策和 Round 93 的 binding stack。

## Updated Test Gradient

实现时建议按切片运行最小测试，而不是一次性跑全仓：

1. Slice 1 profile contract：
   - `server/agent/profiles/simulation-director-profiles.test.ts`
   - `server/agent/profiles/leader-assets-profile.test.ts`
   - `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts`
   - 新增 TypeBox `Value.Check()` strict 负例，覆盖旧 `simulator_requests`、旧 `plot` kind、root extra、item extra。

2. Slice 2 OpenAPI explicit path：
   - `server/openapi/generate-spec.test.ts` 或等价新增测试
   - 覆盖 `RouteMetaEntry.path`、path params、query params、duplicate operation guard。
   - 同步验证 `scripts/build/generate-openapi-meta.ts` 的 route-local metadata 也能消费 explicit path。

3. Slice 3 brief module：
   - `shared/dto/plot.dto.test.ts`
   - `server/plot/services/chapter-writer-brief.service.test.ts`
   - `server/api/projects/plot/[...segments].test.ts`
   - 重点覆盖 `needs_plot / needs_world_anchor / needs_world_context / ready`、Scene writingTip、Thread summary/writingTip、renderer section/negative assertions。

4. Slice 4 tool binding：
   - `server/agent/tools/plot-tools.test.ts`
   - `server/agent/tools/index` 聚合断言或现有 agent collaboration/tool discovery 测试
   - director profile test
   - compiled source/manifest/artifact 检查
   - 重点覆盖 tool text = `suggestedBriefMarkdown` 主体、details 保留完整 DTO、不写 `plot.selection`、director toolKeys 暴露、writer 不暴露 Plot tools。

## Stop Conditions

实现任一切片时遇到以下情况应停下报告，而不是用 hack 绕过：

- 为了让测试过而保留 `simulator_requests` alias 或 `plot` kind 兼容。
- 把 `ChapterWriterBriefSceneDtoSchema` 改回只包 `ChapterPlotSceneDtoSchema`，导致 Scene `writingTip` 丢失。
- brief service 通过捕获 `"Scene 尚未设置完整 World Engine 时间范围"` 文案判断 status。
- OpenAPI catch-all route 的两个 GET operation 仍映射到同一 generated path。
- user root director source/artifact 没有同步，active catalog 仍可能使用旧 prompt。

## Conclusion

当前探索已经足够支撑进入 Slice 1。Round 96-99 提供的是后续 Slice 3/4 的实现细节，不应再改变入口顺序。下一步如果进入实现，应从 Profile Contract Cleanup 开始，而不是先实现 `get_chapter_writer_brief`。
