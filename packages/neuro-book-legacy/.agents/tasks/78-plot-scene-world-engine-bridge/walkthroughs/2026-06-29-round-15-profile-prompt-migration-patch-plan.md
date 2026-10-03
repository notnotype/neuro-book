# 2026-06-29 Round 15 - Profile Prompt Migration Patch Plan

## Scope

本轮把 profile 架构建议转成可执行的 prompt / routing / schema 迁移补丁计划。本轮不改业务代码。

目标：先让普通写作 profile 认识当前事实：Plot System 已经是 Scene-only 作者结构层，不是 legacy 状态源；simulation/RP 才是普通写作外的 legacy 边界。

## Current Evidence

当前仍不一致的地方：

- `reference/agent/leader-default.md` 仍写 `leader.default` 不维护 Plot 系统，且 `plot / simulator / director / emulation` 都不在职责内。
- `reference/agent/profile-routing.md` 仍写 `leader.default` 不路由到 Plot / simulator / director / RP。
- `reference/agent/novel-writing-workflow.md` 仍把 Plot workflow 放进 legacy boundary。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 仍说“旧 Plot / simulation 系统不存在，不要调用、创建或路由到它们”。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 仍有 `Simulation gate`，并让未裁决状态走 `simulator.leader` 或 `simulator_requests`。
- `server/agent/profiles/builtin-contracts.ts` 的 `DirectorOutputSchema` 仍允许 `plot_updates.kind = "plot"`，并保留 `simulator_requests`。
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` 的 `normalizePayloadContext()` 注释仍写“写作模式不使用 Plot 系统”。

这些不是小文案问题。它们会直接让 leader 不调用 director，让 director 把普通写作状态问题交给 simulator，让 writer 的 Plot 边界解释和当前 Scene-only 设计冲突。

## Migration Patch Groups

### Group 1 - Reference Routing

文件：

- `reference/agent/leader-default.md`
- `reference/agent/profile-routing.md`
- `reference/agent/novel-writing-workflow.md`
- `reference/plot/system.md`

修改目标：

- 把“Plot 不存在 / legacy”改为“Plot System 是 Scene-only 作者结构层”。
- 明确 `leader.default -> director` 是普通写作里合法的 Plot 结构路线。
- 明确 `leader.default` 仍是 World Engine readwrite owner。
- 明确 `director` 不裁决世界事实，未裁决事实回报给 leader，由 leader 用 World Engine 处理。
- `reference/plot/system.md` 中“Leader 应优先用 get_chapter_plot”改为“leader 通过 director 或未来 brief tool 获取 chapter scene brief”。

验收搜索：

- `rg -n "不路由到 Plot|Plot workflow 只作为 legacy|不维护 Plot 系统" reference/agent`
- 这些语句应消失或被改成 Scene-only 边界。

### Group 2 - Builtin Profile Prompts

文件：

- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`

修改目标：

- leader prompt：
  - simulation/RP legacy 不在普通写作主路径。
  - Plot System 是 Scene-only 作者结构层。
  - 需要 Thread / Scene / Chapter Scene 顺序时，创建或复用 `director`。
  - leader 不直接拿 Plot 写工具。
- director prompt：
  - `Simulation gate` 改为 `World Engine boundary`。
  - 不调用 `simulator.leader` 裁决普通写作世界状态。
  - 把未裁决事实写入 `world_engine_requests` 或 `open_questions`。
  - `get_scene_world_context` 只读已连接 Scene 的上下文，不是裁决工具。
- writer prompt / helper 注释：
  - 不说“写作模式不使用 Plot 系统”。
  - 改成“writer 不直接消费 Plot tools 或 payload ids；上游必须把 Scene/Thread/World Context 编译进 message brief”。

验收搜索：

- `rg -n "Simulation gate|simulator_requests|旧 Plot|写作模式不使用 Plot 系统" assets/workspace/.nbook/agent/profiles/builtin server/agent/profiles`

普通写作 prompt 中不应再出现这些旧语义。RP / simulator 专属 profile 可以保留 simulator 语义。

### Group 3 - Director Output Schema

文件：

- `server/agent/profiles/builtin-contracts.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `server/agent/profiles/simulation-director-profiles.test.ts`

推荐修改：

- `plot_updates.kind` 从 `"thread" | "scene" | "plot"` 改成 `"thread" | "scene"`。
- `simulator_requests` 改成 `world_engine_requests`。
- director prompt 输出合同同步改名。

项目当前处于快速开发阶段，不需要为旧字段保留兼容。直接改名更干净。

### Group 4 - Profile Tests

优先测试：

- `server/agent/profiles/simulation-director-profiles.test.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- profile compile worker 快照测试如果受 prompt 文案影响，也同步更新。

验收断言应覆盖：

- `director.rootToolKeys` 有 Plot tools 和 `get_scene_world_context`，没有 write/edit。
- `director` prompt 不包含普通写作 `Simulation gate`。
- `leader.default` prompt 知道 Plot Scene-only，并允许 route 到 director。
- `writer` 仍不持有 Plot tools。

## Why This Comes Before Brief Tool

如果先实现 `get_chapter_writer_brief`，但 leader 仍被提示“不要路由 director / Plot 不存在”，新工具不会进入实际使用路径。先修 profile 认知，再加工具，实施风险更低。

## Result

本轮把 P1 迁移拆成 4 组补丁。下一步若进入实现，应先做 Group 1-4，而不是直接给 leader 加 Plot tools。这样能系统性约束 Agent 以后不会继续把 Plot 当 legacy 状态源，也不会把普通写作世界事实交给 simulator。

