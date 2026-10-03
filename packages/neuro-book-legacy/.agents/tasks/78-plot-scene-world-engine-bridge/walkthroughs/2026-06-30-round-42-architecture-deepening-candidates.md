# 2026-06-30 Round 42 - Architecture Deepening Candidates

## Scope

本轮按 `improve-codebase-architecture` 的语言审查 Task 78 的下一步实现，不改业务代码。目标是确认哪些 Module 需要加深，避免 Slice 1 只变成 prompt 文本替换。

当前没有可用的 subagent 工具，本轮用只读检索完成 Explore。

## Domain Terms

本轮使用仓库 `CONTEXT.md` 和 reference 中的稳定术语：

- `Project Workspace`
- `Project SQLite`
- `Agent Session`
- `Profile`
- `Plot System`
- `StoryThread`
- `StoryScene`
- `World Engine`
- `writer brief`

## Candidate 1 - Director Contract Module

Files:

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/simulation-director-profiles.test.ts`

Problem:

`director` 的 Interface 同时暴露新 Scene-only Plot System 和旧 simulation 输出：prompt 里有 `Simulation gate`，schema 里有 `simulator_requests` 和 `plot_updates.kind = "plot"`。调用方必须“记住别用旧字段”，这是浅 Interface。

Solution:

把 director contract 加深：System prompt 和 OutputSchema 同步收敛为 Thread / Scene / World Engine request 三件事。未裁决世界事实只进入 `world_engine_requests`，由 leader 处理；director 不调用 simulator，不写 World Engine。

Benefits:

- Locality：旧 simulation 语义集中从 director contract 删除，不靠每个调用方自律。
- Leverage：后续 `get_chapter_writer_brief` 直接接入一个干净的 director 心智，不会被旧 gate 吸走。
- Test：TypeBox schema test 可以机械拒绝 `plot` kind 和 legacy-only `simulator_requests`。

## Candidate 2 - Current Policy Injection Module

Files:

- `reference/agent/profile-routing.md`
- `reference/agent/leader-default.md`
- `reference/agent/novel-writing-workflow.md`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`

Problem:

Profile reference 通过 `HistorySet > Import` 注入。`reference/agent/context.md` 明确 `HistorySet` 只在 session 缺少稳定前缀时写入；老 Agent Session 可能已经保存旧 `profile-routing.md` / `leader-default.md` 内容。只改 reference 不能保证现有 session 立刻看到新 Plot 路由。

Solution:

把“当前普通写作 Plot 路由”放进各 profile 的 `System` 作为当前策略；reference 作为新 session 和共享说明的稳定材料。System 必须明确覆盖旧 stable history：leader 可调用 director；director 不走 simulator；writer 不持有 Plot tools，只消费完整 writer brief。

Benefits:

- Locality：当前策略集中在 profile System，不依赖历史前缀是否刷新。
- Leverage：新旧 session 都能在下一轮 prepare 时拿到当前 System。
- Test：profile prepare test 直接检查 `systemPrompt`，比只检查 imported history 更可靠。

## Candidate 3 - Chapter Writer Brief Module

Files:

- `shared/dto/plot.dto.ts`
- `server/plot/services/chapter-writer-brief.service.ts`
- `server/plot/repositories/prisma-scene.repository.ts`
- `server/plot/facade/plot.facade.ts`
- `server/api/projects/plot/[...segments].ts`

Problem:

如果 `get_chapter_writer_brief` 只在 Agent tool handler 里串 `get_chapter_plot` + `get_scene_world_context`，tool handler 会变成业务编排层，状态判断、warnings、markdown 信息边界分散在 Agent prompt 和 tool 之间。

Solution:

新增 `ChapterWriterBriefService` 作为深 Module：Interface 是 `projectPath + chapterPath -> ChapterWriterBriefDto`，Implementation 负责 scene order、thread summary、Scene World Anchor resolution、World Context hints、status 和 `suggestedBriefMarkdown`。

Benefits:

- Locality：brief 状态和 markdown 边界只在一个 Module 维护。
- Leverage：HTTP route、Agent tool、后续 leader readonly brief 可复用同一 Interface。
- Test：service test 能覆盖 `ready / needs_plot / needs_world_anchor / needs_world_context`，不用通过 profile prompt 间接验证。

## Candidate 4 - OpenAPI Route Metadata Module

Files:

- `server/openapi/route-map.ts`
- `server/openapi/generate-spec.ts`
- `server/api/projects/plot/[...segments].ts`

Problem:

当前 `buildPath(file, _entry)` 只从文件名推导 path，catch-all route 多语义 GET 无法表达多个 OpenAPI path。新增 brief route 后，spec 层会继续把不同语义挤在同一个 catch-all path 上。

Solution:

给 `RouteMetaEntry` 加 `path?: string`，让 route metadata 自己声明公开 Interface path。`buildPath()` 优先用 `entry.path`。

Benefits:

- Locality：OpenAPI path 语义在 route metadata 中明确，不隐藏在文件名推导规则里。
- Leverage：后续所有 catch-all route 都可复用。
- Test：spec test 可直接断言 world-context 与 chapter-writer-brief 两条 path 不互相覆盖。

## Candidate 5 - Tool Exposure Module

Files:

- `server/agent/tools/plot-tools.ts`
- `server/agent/tools/index.ts`
- `server/agent/profiles/profile-tools.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`

Problem:

新增一个 Plot tool 不是只改 `plot-tools.ts`。全局 registry、profile binding helper 和具体 profile tools 三处都要同步，否则会出现 runtime 有 tool、profile 作者不能引用，或 profile 引用了不存在 tool 的不一致。

Solution:

把 `get_chapter_writer_brief` 作为 Plot tool 的只读 Interface：runtime 注册、builtin binding、director exposure 一次性补齐；leader/writer 第一阶段不暴露。

Benefits:

- Locality：工具可用性从 registry 到 profile binding 一次验证。
- Leverage：director 使用一个深 tool，不手动串 Plot + World Context。
- Test：tool registry / profile tool list / selection state 都能被直接断言。

## Result

最优先 deepening 仍是 Candidate 1 和 Candidate 2：先把 director contract 和当前策略注入修正，再实现 OpenAPI、brief service 和 tool exposure。否则新 brief tool 会被旧 profile 心智错误使用。

