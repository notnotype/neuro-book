# Round 135: End-to-End Implementation Runbook

## Scope

本轮继续 Task 78 的实现前探索，但不再扩展新的 profile 架构方案。目标是把已经收敛的四个切片串成一条端到端执行 runbook，明确每个 Module / Interface / Adapter 的补丁顺序、测试入口、生成物和 runtime 证据。没有修改业务代码，没有运行测试。

## Current Evidence

### Package Scripts

`package.json` 当前提供的相关入口：

- `test`: `vitest run`
- `test:agent`: `vitest run server/agent shared/dto`
- `generate:openapi`: `bun scripts/build/generate-openapi-meta.ts`
- `system-assets:prepare`: `bun scripts/build/prepare-system-assets.ts`
- `profile:metadata`: `bun scripts/build/prepare-system-assets.ts`
- `dev`: `nuxt prepare && bun run generate && bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets && nuxt dev`

因此实现验证不应只跑源码测试。Profile source 改完后还必须覆盖 system assets prepare、active user root sync、compiled manifest 和 artifact 内容。

### Slice 1 Still Blocks Later Work

当前 `DirectorOutputSchema` 仍包含旧 contract：

- `simulator_requests`
- `plot_updates.kind = "plot"`
- root object 和 `plot_updates` item 未显式 strict
- 没有 `world_engine_requests`

system source 与 active user source 的 `director.profile.tsx` 都仍包含：

- `simulator.leader`
- `simulator_requests`
- `Simulation gate`

`leader.default` / `leader-default.md` / `profile-routing.md` 仍有“普通写作不路由 Plot / director”的旧语义。`writer.profile.tsx` 仍有“写作模式不使用 Plot 系统”的绝对表述。

### Slice 2 Still Has Two Adapter Drift

`server/openapi/generate-spec.ts` 仍从 physical `file` 推导 public path，并且 duplicate `path + method` 会被 silent overwrite。

`scripts/build/generate-openapi-meta.ts` 仍复制 operation 生成逻辑，并且 `main()` 无条件执行。它按 file 注入 route-local `defineRouteMeta()`，同一 physical route file 多 logical operation 时仍有 last-wins 风险。

`server/api/projects/plot/[...segments].ts` 当前 generated route meta 只有 query `projectPath`，没有 `sceneId` path param。说明 world-context 这个现有 catch-all operation 本身也尚未成为 explicit path 的强证据。

### Slice 3 Still Needs A Deep Brief Module

`ChapterPlotDetailDto` / `ChapterPlotSceneDto` 是 UI Interface。它们缺少 writer brief 需要的字段：

- Scene `writingTip`
- Thread `summary`
- Thread `writingTip`
- per-scene `worldContext`
- warnings
- `suggestedBriefMarkdown`

`findChapterScenes()` 当前只拿 thread `id/title/isMainThread`。`SceneWorldContextService.getSceneWorldContext()` 是 HTTP strict Adapter，缺时间会抛错，不适合 brief service 捕获 error message 做 status 聚合。

### Slice 4 Has No Binding Stack Yet

当前还没有：

- `PlotFacade.getChapterWriterBrief()`
- `get_chapter_writer_brief` runtime tool
- `buildAgentTools()` registry entry
- `builtin.plot.getChapterWriterBrief` typed binding
- director toolset exposure
- compiled artifact 证据

现有 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts` 已覆盖 writer 有 readonly `execute_world` 且无部分 Plot tools，但它还没有覆盖“writer 可消费上游 Scene / World Context brief”的 prompt/Interface 断言。若 Slice 1 不新增 server 侧 writer profile contract test，也至少要扩展现有 writer test 的断言范围。

## Runbook

### Slice 1: Profile Contract Cleanup

目标 Module 是 profile contract。它的 Interface 不只是 `DirectorOutputSchema`，还包括 system/user profile source、reference injection、toolset、tests、compiled manifest/artifact 和 discovery。

补丁顺序：

1. `server/agent/profiles/builtin-contracts.ts`
   - 删除 `simulator_requests`
   - 删除 `plot_updates.kind = "plot"`
   - 新增 `world_engine_requests`
   - root 与 `plot_updates` item 显式 `additionalProperties: false`
2. system director source
   - 删除 `simulator.leader` / `Simulation gate` / `simulator_requests`
   - 写清 director 不写 World Engine，只把未决问题放入 `world_engine_requests`
3. active user director source
   - 通过 profile sync/prepare 路径处理，或在有明确安全依据时同步 source
   - 不能留下 user root shadow 覆盖 system 修复
4. leader.default source 与 reference
   - Scene / Chapter / writer brief 结构任务路由 director
   - leader 不直接持有 Plot write tools
   - leader 处理 `world_engine_requests`，必要时调用 `world.engine`
5. writer source/test
   - 保持 writer 无 Plot tools
   - 删除“写作模式不使用 Plot 系统”的绝对表述
   - 写清 writer 可消费 `invoke_agent.message` 中完整 Scene / World Context brief
6. tests
   - `simulation-director-profiles.test.ts`: prompt 正负断言、toolset、schema strict `Value.Check()`
   - `leader-assets-profile.test.ts`: leader routing 正断言、旧“不路由 Plot/director”负断言
   - writer profile test: writer isolation、legacy Plot ids 不进入 payload、brief consumption language
7. compiled proof
   - `prepare-system-assets.ts` / profile compile 后检查 system 与 active user manifest
   - artifact 不含 `simulator_requests` / `Simulation gate` / `simulator.leader`
   - artifact 含 `world_engine_requests`

建议最小测试：

```powershell
bun vitest run server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts
```

Stop conditions：

- 需要保留 `simulator_requests` alias。
- 需要保留 `"plot"` kind。
- writer 必须获得 Plot tools。
- user root sync 有 warning 且无法证明覆盖安全。
- compiled manifest/artifact 仍指向旧 director contract。

### Slice 2: OpenAPI Explicit Path

目标 Module 是 OpenAPI public operation builder。它的 Interface 是 `RouteMetaEntry.file` 表示 physical file，`RouteMetaEntry.path` 表示 public path，`emitRouteMeta` 表示 route-local representative。

补丁顺序：

1. `server/openapi/route-map.ts`
   - 增加 `path?: string`
   - 增加 `emitRouteMeta?: boolean`
   - 给 world-context entry 先补 explicit public path
2. shared operation builder
   - 从 `generate-spec.ts` 和 `generate-openapi-meta.ts` 抽出共用 operation builder Module
   - 统一生成 path params、query params、body、responses、operationId
3. canonical spec Adapter
   - 导出 `buildOpenAPISpecForRoutes(entries)`
   - duplicate `path + method` 直接失败
4. route-local representative Adapter
   - 按 physical file 分组
   - 0 个 `emitRouteMeta` 跳过
   - 1 个注入
   - 多个直接失败
   - 增加 main guard 或抽纯函数，避免 import 时写文件
5. tests
   - synthetic entries 覆盖同 file 多 public path
   - path/query params 同时生成
   - duplicate guard
   - representative selector

建议最小测试：

```powershell
bun vitest run server/openapi scripts/build
bun run generate:openapi
```

Stop conditions：

- 只修 `/_openapi.json`，route-local `defineRouteMeta()` 仍缺 path params。
- 同一 physical file 多 entry 仍 silent last-wins。
- `generate-openapi-meta.ts` 仍无法被测试导入。
- `chapter-writer-brief` 在 Slice 3 DTO 未落地前提前注册为真实 route entry。

### Slice 3: Chapter Writer Brief Module

目标 Module 是 `ChapterWriterBriefService`。它应是深 Module：小 Interface `projectPath + chapterPath -> ChapterWriterBriefDto`，Implementation 集中 chapter scene read model、World Anchor 判断、World Context 查询、status/warnings 和 markdown renderer。

补丁顺序：

1. DTO
   - `ChapterWriterBriefStatusSchema`
   - `ChapterWriterBriefSceneDtoSchema`
   - `ChapterWriterBriefDtoSchema`
   - `suggestedBriefMarkdown` 必填
2. repository read model
   - 新增 `findChapterScenesForBrief(chapterPath)`
   - 保留 `findChapterScenes()` 不变
   - 专用 record 显式包含 Scene `writingTip` 与 Thread `summary/writingTip`
3. `SceneWorldContextService`
   - 保留 HTTP strict `getSceneWorldContext()`
   - 新增 Scene entity-level helper，供 brief service 复用查询 Implementation
4. `ChapterWriterBriefService`
   - status precedence: `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready`
   - empty but valid world context 不阻断 handoff，只加 warning
   - renderer 输出可直接给 writer 的 `suggestedBriefMarkdown`
5. facade / composition
   - `PlotModule` 增加 service
   - `PlotFacade.getChapterWriterBrief(projectPath, chapterPath)`
6. HTTP route
   - `GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=`
   - HTTP layer 只做 query 非空，路径语义交给 Plot Module
7. OpenAPI entry
   - 依赖 Slice 2
   - `emitRouteMeta: false`
   - canonical spec 必须包含该 logical operation

建议最小测试：

```powershell
bun vitest run shared/dto/plot.dto.test.ts server/plot/services/chapter-writer-brief.service.test.ts server/api/projects/plot/[...segments].test.ts server/openapi
```

Markdown 负断言：

- 不含 raw patch JSON。
- 不含完整 attrs dump。
- 不伪造 ChapterOverride 字段，例如 POV / tone / do-not-reveal / ending beat。
- 不输出 writer target path；writer path 仍只来自 `invoke_agent.input.path`。

Stop conditions：

- 扩胖 `ChapterPlotDetailDto` 来服务 writer brief。
- 通过 `getChapterPlotDetailDto()` 再散查字段。
- 捕获 `getSceneWorldContext()` error message 做 status。
- `suggestedBriefMarkdown` 不存在或只返回 JSON。
- DTO 需要 `any` / `unknown` 绕过类型表达。

### Slice 4: Agent Tool Binding

目标 Module 是 brief tool binding stack。它不承载业务语义，只提供浅 Adapter。

补丁顺序：

1. `server/agent/tools/plot-tools.ts`
   - 新增 `get_chapter_writer_brief`
   - input 只含 `projectPath` / `chapterPath`
   - 不读写 `plot.selection`
   - `content[0].text = suggestedBriefMarkdown`
   - `details = ChapterWriterBriefDto`
2. `server/agent/tools/index.ts`
   - 注册 runtime tool
3. `server/agent/profiles/profile-tools.ts`
   - `builtin.plot.getChapterWriterBrief` typed binding
4. director profile
   - toolset 暴露 brief tool
   - prompt 写清调用时机：写作前编译 Scene / World Context brief
5. writer profile
   - 继续无 Plot tools
   - 可消费上游完整 brief
6. discovery / compiled proof
   - `get_agent_profile({profileKey:"director"})` 的 `toolKeys` 包含 brief tool
   - schema summary 可见 `world_engine_requests` / `writer_handoff`
   - runtime tool definition 单独证明 description/parameter description
   - system/user compiled artifact 都包含新 tool binding

建议最小测试：

```powershell
bun vitest run server/agent/tools/plot-tools.test.ts server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts
bun run system-assets:prepare
```

Stop conditions：

- tool 内部重新实现 status precedence 或 markdown renderer。
- tool 输入包含 writer target path。
- tool 读写 `plot.selection`。
- 只改 runtime tool，未改 global registry / typed binding / director toolset / compiled artifact。
- 用 `get_agent_profile` 证明 tool description；它只能证明 `toolKeys/schema summary`。

## Evidence Hierarchy

完成声明应按强度分层：

1. source diff：证明补丁存在，但不能证明 runtime 使用它。
2. focused tests：证明 Interface 约束，例如 schema strict、duplicate guard、status fixture、tool result contract。
3. generated metadata/spec：证明 OpenAPI / route-local metadata 与 source 一致。
4. compiled manifest/artifact：证明 Agent runtime 可加载到新 profile contract 和 tool binding。
5. catalog discovery / `get_agent_profile`：证明 caller 能发现目标 profile 的 toolKeys/schema summary。
6. static smoke：用 fake/faux harness 证明调用链可串起来。
7. real Agent smoke：证明真实模型行为遵守路由、brief 编译和 writer handoff。

不能用低层证据替代高层证据。比如 source diff 不能证明 active user root 没 shadow；`get_agent_profile` 不能证明 tool description；faux smoke 不能证明真实模型行为。

## End-to-End Acceptance Path

按顺序执行：

1. Slice 1 完成后，证明旧 simulator contract 在 schema、prompt、reference、source、active user artifact 中都失效。
2. Slice 2 完成后，证明 OpenAPI canonical spec 和 route-local representative 都理解 public path，并拒绝 duplicate operation。
3. Slice 3 完成后，证明 `ChapterWriterBriefService` 能独立生成 DTO + markdown，并用 fixture 覆盖四种 status。
4. Slice 4 完成后，证明 director 可发现并调用 brief tool，writer 仍隔离 Plot tools。
5. 最后再做一个 `leader.default -> director -> get_chapter_writer_brief -> writer` 的 smoke：
   - leader 不直接写 Plot。
   - director 编译 brief。
   - writer 只写 `invoke_agent.input.path`。
   - World Engine 未决问题通过 `world_engine_requests` 回 leader。

## Actual Result / Plan Delta

本轮计划是继续几轮探索，但当前证据显示 profile 架构和四个实现切片已经反复收敛，继续扩写平行方案的 Leverage 很低。因此实际结果没有新增第五种架构方案，而是把既有方案压成端到端实现 runbook。

与原计划的唯一偏差是 writer test 口径：前序记录写“没有 writer profile test”，本轮核对后发现 `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts` 已存在，并已覆盖 writer tool isolation；真正缺口是 server 侧 writer profile contract test，或在现有 assets 侧测试中补 Scene / World Context brief consumption 断言。

本轮没有运行测试，也没有修改业务代码。验证只限于只读检索和文档存在性 / 索引检索。

## Conclusion

当前 architecture choice 已经足够明确：第一阶段继续采用 Director + Brief Compiler，不新增 `brief.compiler` profile，不扩大 leader/writer/world.engine 工具面。下一步真实实现应按 Slice 1 -> Slice 2 -> Slice 3 -> Slice 4 严格推进。

本 runbook 的作用是减少实现时的选择空间：每个 Slice 都有明确 Interface、Adapter、测试面和 runtime 证据。继续纯探索的收益已经很低；除非发现新的当前源码矛盾，否则下一步应进入 Slice 1 `Profile Contract Cleanup`。
