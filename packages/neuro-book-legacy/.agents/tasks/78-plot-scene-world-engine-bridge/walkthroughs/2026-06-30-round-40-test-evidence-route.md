# 2026-06-30 Round 40 - Test Evidence Route

## Scope

本轮把后续实现的验收拆成可执行测试证据路线。目标是避免“prompt 看起来改了”但缺少机械约束，或者 “API 加了”但 OpenAPI / Agent tool 暴露不完整。

本轮不修改业务代码。

## Existing Test Surface

当前可复用测试面：

- `server/agent/profiles/simulation-director-profiles.test.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `server/agent/tools/plot-tools.test.ts`
- `server/api/projects/plot/[...segments].test.ts`
- `server/plot/services/scene-world-context.service.test.ts`
- `server/plot/services/scene-world-anchor-resolution.service.test.ts`
- `shared/dto/plot.dto.test.ts`

当前没有明显的 `server/openapi/*.test.ts`，所以 OpenAPI explicit path 更适合新增一个小的 `server/openapi/generate-spec.test.ts` 或等价测试文件。

## Slice 1 - Profile Contract Cleanup

测试目标：

- reference / prompt 不再把普通写作 Plot 归入 legacy boundary。
- director 不再有 `Simulation gate`、`simulator_requests`、普通写作调用 `simulator.leader`。
- director 输出合同改为 `world_engine_requests`。
- writer 仍不持有 Plot tools，但不再说“写作模式不使用 Plot 系统”；它应消费上游完整 brief。

建议测试：

- 在 `simulation-director-profiles.test.ts` 增加 director prompt 断言：
  - `not.toContain("Simulation gate")`
  - `not.toContain("simulator_requests")`
  - `toContain("world_engine_requests")`
  - 写作模式缺 World Engine 事实时返回给 leader，而不是调用 simulator。
- 在同一测试中用 TypeBox `Value.Check()` 验证 `DirectorOutputSchema`：
  - 接受 `thread` / `scene`。
  - 拒绝 `plot`。
  - 接受 `world_engine_requests: []`。
  - 拒绝 legacy-only `simulator_requests` payload。
- 在 `writer.profile.test.ts` 更新旧断言：
  - 不再要求出现“写作模式不使用 Plot 系统”。
  - 仍证明 writer 没有 Plot tools。
  - 证明 writer prompt 要求消费完整 `invoke_agent.message` brief。

## Slice 2 - OpenAPI Explicit Path

测试目标：

- catch-all route file `projects/plot/[...segments].ts` 可以为不同 GET operation 生成不同 OpenAPI path。
- 现有 world-context route 不再生成错误的 `/api/projects/plot/[...segments].ts` 或 `/api/projects/plot/{...segments}` 类路径。
- 后续 `chapter-writer-brief` 不覆盖 `world-context`。

建议新增 `server/openapi/generate-spec.test.ts`：

- 调用 `generateOpenAPISpec()`。
- 断言存在 `/api/projects/plot/scenes/{sceneId}/world-context`。
- 实现 brief route 后断言存在 `/api/projects/plot/chapter-writer-brief`。
- 断言两个 path 下的 `get.summary` 不相同，response schema 不相互覆盖。

## Slice 3 - Chapter Writer Brief Module

测试目标：

- DTO 表达 scene/world-only v1，不包含 ChapterOverride 字段。
- service 只读，按 chapterPath 聚合 scene order、thread summaries、Scene World Anchor resolution、World Context hints 和 warnings。
- `suggestedBriefMarkdown` 可直接作为 writer message 草案，但不包含 raw patch JSON / 完整 attrs / 伪造 POV/tone/do-not-reveal。

建议测试：

- `shared/dto/plot.dto.test.ts`：验证 `ChapterWriterBriefDtoSchema` 的 status、scenes、threadSummaries、worldQueryHints、suggestedBriefMarkdown。
- 新增或扩展 `server/plot/services/*brief*.test.ts`：
  - chapter 无 Scene -> `needs_plot`。
  - Scene 缺完整时间或 subjects -> `needs_world_anchor`。
  - World Context 查询失败 -> `needs_world_context` + warning。
  - ready case 生成 markdown。
  - markdown 不包含 `patchId` / raw patch JSON / `tone` 这类 ChapterOverride 假字段。
- `server/api/projects/plot/[...segments].test.ts`：验证 HTTP route 的 query/body、错误处理和响应 DTO。

## Slice 4 - Agent Tool Binding

测试目标：

- `get_chapter_writer_brief` 是只读 Plot tool。
- 参数必须显式包含 `projectPath` 和 `chapterPath`。
- 不读取也不修改 `plot.selection`。
- 第一阶段只暴露给 director，不暴露给 leader.default / writer。

建议测试：

- `server/agent/tools/plot-tools.test.ts`：
  - handler 调用 facade/service。
  - 返回 `suggestedBriefMarkdown`。
  - session state 中已有 `plot.selection` 时，调用后 state 不变。
  - facade error 原样透出。
- `simulation-director-profiles.test.ts`：
  - director `rootToolKeys` 包含 `get_chapter_writer_brief`。
  - leader/writer 不包含该 tool（可在现有 profile 测试中断言）。

## Result

后续实现验收不能只跑宽泛 typecheck。每个 slice 都应有直接证据：schema 限制旧字段、prompt 删除旧路由、OpenAPI 生成真实 path、brief service 生成可读 markdown、Agent tool 不污染 selection 且只给 director。

