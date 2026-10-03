# 2026-06-30 Round 57 - Compiled Runtime Acceptance Boundary

## Scope

本轮核对 Task 78 与 Task 79 的交叉点：profile 源码、tool registry、profile binding 和 `.compiled` runtime artifact 分别能证明什么。目标是防止后续实现只改 source profile 或 reference，却误判真实 Agent 已可用。

本轮不修改业务代码。

## Evidence

当前 profile build system 已经比 Task 79 README 的 Phase 0 摘要更靠前：

- `server/agent/profiles/profile-build-coordinator.ts` 已存在 `ProfileBuildCoordinator`，负责 500ms debounce、queued/running state、boot sweep 和 worker 调度。
- `server/agent/harness/neuro-agent-harness.ts` 在 `watchProfiles` 开启时创建 `ProfileBuildCoordinator`，挂到 `AgentProfileCatalog`，并启动 `bootSweep()`。
- `server/agent/profiles/catalog.ts` 的 `enqueueBuild()` 会先 `invalidate()`，再转发给 build coordinator；watcher 对 user profile source 和依赖变化入队，对 `.compiled/artifacts/**`、`.tmp` 和类型文件变化做忽略。
- `server/agent/profiles/profile-artifact-compiler.ts` 已有 `ProfileReleaseStore`、content-addressed `artifacts/<sha>.mjs`、manifest temp file rename、`proper-lockfile` advisory lock 和 publish lock。
- `server/config/config-service.ts` 的 `readConfigAgentProfileBuildStatus()` 已经把 catalog `loadStatus` 和 `profiles.buildStateFor(profile.key)` 一起暴露。

但 Task 78 的目标 profile/runtime 仍未落地：

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 仍包含 `simulator.leader`、`Simulation gate` 和 `simulator_requests`。
- `server/agent/profiles/builtin-contracts.ts` 的 `DirectorOutputSchema` 仍包含 `simulator_requests`，`plot_updates.kind` 仍允许旧 `plot` kind。
- `server/agent/tools/plot-tools.ts`、`server/agent/tools/index.ts`、`server/agent/profiles/profile-tools.ts` 还没有 `get_chapter_writer_brief` / `getChapterWriterBrief`。
- `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json` 与 `workspace/.nbook/agent/profiles/.compiled/manifest.json` 当前都把 `director` 指向 `artifacts/c297de152fc11052461e029e4f4bdf2606d0c63d53e38f4e2e15cf3f591d66a9.mjs`。
- 当前 director compiled artifact 仍能搜到 `simulator_requests` 和 `Simulation gate`，搜不到 `get_chapter_writer_brief` 或 `world_engine_requests`。

这说明“源码还未改”与“运行 artifact 仍是旧合同”两件事都成立。后续即使 source 改完，也还必须重新证明 `.compiled` 当前指针已更新。

## Acceptance Layers

后续实现不能用单一证据替代全部验收。建议按 5 层验收：

| 层级 | 证明内容 | 不能证明什么 |
| --- | --- | --- |
| Source profile / reference | prompt、reference 和 schema 源码已表达新架构 | 不能证明 runtime 已加载 |
| Unit schema tests | `DirectorOutputSchema` strict，并用 `Value.Check()` 拒绝旧字段/旧 kind/额外字段 | 不能证明 director 会主动提交 `report_result.data` |
| Runtime tool registry | `plot-tools.ts`、`tools/index.ts`、`profile-tools.ts` 都有 brief tool binding | 不能证明 director profile 暴露了该 tool |
| Catalog / build-status | profile loadStatus/buildState 不是 stale/failed，build coordinator 状态可见 | 不能证明 artifact prompt 内容符合新合同 |
| Compiled current pointer | `.compiled/manifest.json` 当前 `director` artifact 不含旧 simulator gate，含新 brief/tool contract | 不能证明真实模型一定按流程执行 |

真实 Agent 可用的最低证据应至少覆盖前四层；如果要声称“当前运行环境已使用新 director”，必须检查 compiled current pointer 和 artifact 内容。

## Result

Task 78 的最终验收要从“源码改了”提升到“运行 profile 可用”。具体要求：

- Slice 1 完成后，source 和 compiled artifact 都不应再包含 `simulator_requests` / `Simulation gate`。
- Slice 4 完成后，source 和 compiled artifact 都应能看到 `get_chapter_writer_brief` 的 director tool exposure。
- `build-status` 可以作为运行态 freshness 证据，但只能证明 loaded/queued/running 状态；它不能替代 artifact 内容检查。
- 不运行真实模型时，只能说“调用链静态合同成立”，不能说“真实 Agent 行为已验证”。

