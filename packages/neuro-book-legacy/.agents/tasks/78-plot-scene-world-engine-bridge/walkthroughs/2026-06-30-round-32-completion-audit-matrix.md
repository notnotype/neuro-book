# 2026-06-30 Round 32 - Completion Audit Matrix

## Scope

本轮建立 Task 78 后续 Agent 易用性部分的完成审计矩阵。目标是明确哪些证据可以证明“profile 系统架构已经落地”，避免只因为文档充分就误判完成。

本轮不修改业务代码。

## Requirements From Current Objective

当前目标包含三类要求：

1. 已建立 task，并在 walkthroughs 中记录每轮探索。
2. 设计 Plot System 与 World Engine 的连接方式。
3. 改造 Plot 工具 / profile 系统，让 Agent 能方便使用 Plot System + World Engine，并得到可执行 profile 架构。

第 1、2 类已有大量证据。第 3 类仍处于 follow-up design，尚未实现。

## Audit Matrix

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Task walkthroughs 持续记录 | `docs/tasks/78-plot-scene-world-engine-bridge/walkthroughs/` 已记录到 Round 32 | Proven |
| Scene 连接 World Engine | Scene World Anchor、Scene World Context、Plot Workbench 和 tests 已落地 | Proven |
| 删除 `StoryPlot / Plot Beat` | Prisma / tools / UI 已删除旧正式模型和工具，迁移备份合并到 Scene | Proven |
| profile 架构方案 | Director + Brief Compiler 已收敛，Round 20-32 给出协议、工具矩阵、实现切片 | Proven as design |
| profile prompt/routing 去旧 Plot/simulator 语义 | 当前代码仍有 `leader.default` 排除 Plot/director、director `Simulation gate`、`simulator_requests` | Not implemented |
| `DirectorOutputSchema` 新 Interface | 当前仍允许 `kind: "plot"`，仍有 `simulator_requests` | Not implemented |
| OpenAPI explicit path | `RouteMetaEntry` 仍无 `path?: string`，`buildPath()` 仍按 file 推导 | Not implemented |
| `ChapterWriterBriefService` | 未发现 service / DTO / route / tool | Not implemented |
| `get_chapter_writer_brief` Agent tool | `builtin.plot` 和 `plot-tools.ts` 尚无该 tool | Not implemented |
| director 持有 brief tool | director tools 尚无 `get_chapter_writer_brief` | Not implemented |
| writer 消费完整 brief 而非 Plot ids | writer 实现会忽略 Plot ids，但注释仍写“写作模式不使用 Plot 系统”，需要改成上游 brief 语义 | Partially implemented |

## Completion Gates

不能把 goal 标记完成，直到以下证据全部成立：

1. `reference/agent/profile-routing.md`、`leader-default.md`、`novel-writing-workflow.md` 已把 Plot 定位为 Scene-only 作者结构层，而非 legacy。
2. `director.profile.tsx` 不再包含 `Simulation gate`、`simulator.leader` 写作模式裁决、`simulator_requests`。
3. `DirectorOutputSchema` 删除 `plot` kind，新增 `world_engine_requests`。
4. OpenAPI spec 能同时表达 world-context 和 chapter-writer-brief。
5. `ChapterWriterBriefService` 返回 `status/warnings/suggestedBriefMarkdown`。
6. Agent tool `get_chapter_writer_brief` 存在，并优先暴露给 director。
7. profile tests 证明 leader/writer 不持有 Plot write tools，director 持有 brief tool。
8. brief tests 证明 markdown 不含 raw patch JSON，不伪造 ChapterOverride 字段。

## Suggested Verification Commands Later

实现后推荐聚焦验证：

```powershell
bunx vitest run server/agent/profiles/simulation-director-profiles.test.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts server/agent/tools/plot-tools.test.ts server/plot/services/chapter-writer-brief.service.test.ts server/openapi/generate-spec.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"
```

如果实际测试文件名不同，以实现落点为准。

## Result

本轮结论：架构设计部分已足够明确，但 profile/tool 改造尚未落地，因此当前 goal 不能标记完成。下一步如果用户允许进入实现，应从 Round 29 的 Slice 1 `Profile Contract Cleanup` 开始。

