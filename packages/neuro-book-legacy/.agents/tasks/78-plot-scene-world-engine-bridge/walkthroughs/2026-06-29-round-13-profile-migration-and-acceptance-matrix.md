# 2026-06-29 Round 13 - Profile Migration and Acceptance Matrix

## Scope

本轮把 Round 12 的 profile 拓扑拆成实施顺序和验收矩阵。目标是后续进入实现时能按合同改，而不是边改边判断。

本轮不修改业务代码。

## Phase P0 - Current State Cleanup

当前 worktree 已完成：

- `PlotFacade.parseWorldAnchorDto()` 已接收 `StorySceneWorldAnchorInputDto`。

当前全局验证状态：

- `bun run typecheck` 失败在 llmlint skill 类型，不是 Plot / World Anchor DTO。

进入实现前的处理建议：

- 若本任务只改 Task 78 profile/tool 文档，可在验证报告中明确“全局 typecheck 当前被 llmlint 阻塞”。
- 若用户要求本轮顺手修绿 typecheck，则应另开或扩展任务处理 llmlint，不把它混进 Plot profile 架构实现。

## Phase P1 - Prompt / Routing Decontamination

目标：先让 profile 认知正确，不改工具面。

文件：

- `reference/agent/profile-routing.md`
- `reference/agent/novel-writing-workflow.md`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `reference/plot/system.md`

具体变化：

- `leader.default`：把“旧 Plot / simulation 系统不存在”拆成两句：
  - simulation/RP legacy 不在普通写作主路径。
  - Plot System 是 Scene-only 作者结构层，需要结构落库时 invoke director。
- `profile-routing.md`：允许 `leader.default -> director` 作为普通写作的 Plot 结构路线。
- `novel-writing-workflow.md`：把 Plot 从 legacy boundary 移出，改成 World Engine 前后的结构规划层。
- `director.profile.tsx`：把 `Simulation gate` 改为 `World Engine boundary`。
- `writer.profile.tsx`：说明 writer 不直接用 Plot tools；brief 可以来自 Plot Scene 编译。
- `reference/plot/system.md`：把“Leader 应优先用 get_chapter_plot”改为“leader 通过 director 或未来 brief 工具获取 chapter scene brief”。

验收：

- leader prompt 不再说 Plot 不存在。
- profile-routing 不再禁止 leader 路由到 director。
- director prompt 不再把普通写作未裁决状态交给 simulator。
- writer 仍不直接拥有 Plot tools。

## Phase P2 - Director Output Contract Cleanup

目标：让 director 的结构化输出不再携带旧 Plot Beat / simulator 语义。

文件：

- `server/agent/profiles/builtin-contracts.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `server/agent/profiles/simulation-director-profiles.test.ts`

建议变化：

- `plot_updates.kind` 从 `"thread" | "scene" | "plot"` 改成 `"thread" | "scene"`。
- `simulator_requests` 改为 `world_engine_requests`。
- director prompt 输出合同同步改名。
- 若短期不想破坏调用方，可先保留 `simulator_requests` 但 prompt 中明确普通写作填空数组；同时新增 `world_engine_requests`。项目当前快速开发允许破坏兼容，推荐直接改名。

验收：

- director schema 不再出现 `"plot"` kind。
- director schema / prompt 不再把普通写作状态问题叫 `simulator_requests`。
- tests 覆盖 prompt 包含 Scene World Anchor / World Engine boundary。

## Phase P3 - Chapter Writer Brief Tool

目标：降低 Agent 手动串工具成本。

文件：

- `shared/dto/plot.dto.ts`
- `server/plot/services/chapter-writer-brief.service.ts`
- `server/plot/facade/plot.facade.ts`
- `server/api/projects/plot/[...segments].ts`
- `server/openapi/route-map.ts`
- `server/agent/tools/plot-tools.ts`
- `server/agent/profiles/profile-tools.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`

新增：

- `ChapterWriterBriefDtoSchema`
- `GET /api/projects/plot/chapter-writer-brief`
- `get_chapter_writer_brief`
- `builtin.plot.getChapterWriterBrief`

第一期只暴露给：

- `director`

暂不暴露给：

- `writer`
- `world.engine`
- `leader.default` 的 Plot 写权限

可选：

- 后续给 `leader.default` 暴露只读 `get_chapter_writer_brief`，但不暴露 create/update Plot tools。

验收：

- director rootToolKeys 包含 `get_chapter_writer_brief`。
- `get_chapter_writer_brief` 返回 scenes、warnings、worldQueryHints、suggestedBriefMarkdown。
- world context 查询失败只生成 warning，不让整个 brief API 崩溃。

## Phase P4 - Subject Resolution Consolidation

目标：避免 Facade、Scene World Context、Chapter Brief 各自定义 unresolved 规则。

文件：

- `server/plot/services/scene-world-anchor-resolution.service.ts`
- `server/plot/facade/plot.facade.ts`
- `server/plot/services/scene-world-context.service.ts`
- `server/plot/services/chapter-writer-brief.service.ts`

验收：

- `resolveMany()` 对同一 chapter 只调用一次 `worldEngineFacade.listSubjects()`。
- unresolved subject 在 Workbench、Scene World Context、Chapter Brief 中语义一致。
- 全部 unresolved 时，brief 返回 `needs_world_context` 而不是伪装 ready。

## Test Matrix

| 层级 | 测试文件 | 覆盖点 |
| --- | --- | --- |
| Profile routing | `server/agent/profiles/leader-assets-profile.test.ts` | leader prompt 认识 Plot Scene-only；不直接拥有 Plot 写工具；允许 director route。 |
| Director profile | `server/agent/profiles/simulation-director-profiles.test.ts` | director 有 Plot tools + brief tool；无 write/edit；不含普通写作 simulator gate。 |
| Writer profile | `server/agent/profiles/leader-assets-profile.test.ts` | writer payload 不注入 Plot ids；brief message 可承载 Scene 摘要。 |
| Plot tools | `server/agent/tools/plot-tools.test.ts` | `get_chapter_writer_brief` 调 facade，返回 details。 |
| Brief service | `server/plot/services/chapter-writer-brief.service.test.ts` | status/warnings/context failure/empty chapter。 |
| Subject resolution | `server/plot/services/scene-world-anchor-resolution.service.test.ts` | resolved/unresolved/location/dedupe/resolveMany cache。 |
| OpenAPI | 现有 route-map 相关测试或新增 | catch-all `projects/plot/[...segments].ts` 多语义 route 不互相覆盖。 |

## Acceptance Criteria

进入实现并完成后，应满足：

- Plot 在所有普通写作 prompt 中被定义为 Scene-only 作者结构层，不再被归为 legacy 状态源。
- simulation/RP 仍保留为 legacy / RP 边界，但普通写作不通过 simulator 裁决。
- leader.default 仍是 World Engine write owner。
- director 是 Plot write owner，并能生成 chapter writer brief。
- writer 仍只写正文，World Engine readonly，不接 Plot tools。
- `bun run typecheck` 要么通过，要么明确失败在非 Task 78 范围并附当前失败位置。

