# Round 129: Profile Contract Test Seam Current Map

## Scope

本轮回到 Slice 1 `Profile Contract Cleanup`，只读复查当前 schema / profile / reference / tests，目标是把实现时的测试 seam 和最小证据矩阵压清楚。没有改业务代码，没有运行测试。

## Domain Context

仓库 `CONTEXT.md` 当前没有专门定义 Plot / Scene / World Engine profile 术语，但已稳定定义：

- **Project Workspace**：单本小说工作区。
- **Project Path**：Project Workspace 相对 Workspace Root 的定位标识。
- **Project SQLite**：保存 Story / Plot / Scene 等项目级结构化数据。
- **Agent Chat Surface / Agent Session / Agent FollowUp** 等 Agent 运行语义。

因此本轮继续用 Project Workspace / Project Path / Project SQLite 表达定位，不回退到 `novelId` 或泛称 workspace。

## Current Evidence

### `server/agent/profiles/builtin-contracts.ts`

`DirectorOutputSchema` 仍是旧合同：

- `plot_updates.kind` 允许 `"plot"`。
- root 没有 `{additionalProperties: false}`。
- `plot_updates` item 没有 `{additionalProperties: false}`。
- 仍有 `simulator_requests`。
- 没有 `world_engine_requests`。

仓库已有 `typebox/value` 使用方式，可在测试中直接：

```ts
import {Value} from "typebox/value";
```

### `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`

director prompt 仍含旧 simulator gate：

- “把用户、leader.default 或 simulator.leader 确认后的剧情结构落库”
- “调用 simulator.leader，或在 simulator_requests 中列出”
- “Simulation gate”
- “需要世界裁决时，创建或复用 simulator.leader”
- 输出合同仍要求 `simulator_requests`

当前 `simulation-director-profiles.test.ts` 只断言 director profile 暴露 Plot tools 和 Scene World Context，没有对旧 simulator gate 做负断言，也没有验证 `DirectorOutputSchema` strict。

### `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`

leader system prompt 仍把 Plot / director 排除在普通写作模式外：

- “本 leader 不提供 Roleplay（RP）模式，也不维护旧 Plot / simulation 系统——这些在你这里不存在，不要尝试调用、创建或路由到它们”

这与目标架构冲突。目标架构不是让 leader 持有 Plot tools，而是让 leader 把 Scene / Chapter / writer brief 结构任务路由到 director。

### `reference/agent/leader-default.md`

reference 仍写：

- “本 leader 不提供 Roleplay（RP）模式，也不维护 Plot 系统或旧 `simulation/` workflow——这些系统对写作模式不存在，不要路由、创建或调用它们”

因为该 reference 通过 `HistorySet` 注入，source profile 和 reference 都必须改。只改 reference 不会覆盖旧 Agent Session；只改 profile prompt 又会让新 session 的 injected reference 自相矛盾。

### `reference/agent/profile-routing.md`

profile routing 仍写：

- `leader.default` “不路由到 Plot / simulator / director / RP”
- `director` 世界状态未裁决先转 `simulator.leader`

目标应改成：

- `leader.default` 不直接持有 Plot write tools，但 Scene / Chapter / writer brief 结构任务应调用 director。
- `director` 不写 World Engine；未决 World Engine 问题通过 `world_engine_requests` 交回 leader.default，由 leader 或 world.engine 处理。

### `reference/agent/novel-writing-workflow.md`

普通写作 workflow 仍写：

- writer 不读取 Plot / simulation 作为普通写作状态源。
- legacy 段把 `director`、Plot System 和 RP Tick reference 放到普通写作之外。

这句话需要细化，不是让 writer 拥有 Plot tools，而是：writer 不直接读取 Plot tools；它可以消费 leader/director 编译后的 Scene / World Context brief。

### `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`

writer toolset 仍正确：无 Plot tools，有 readonly `execute_world`。当前需要改的是注释 / prompt 语言：

- `normalizePayloadContext()` 注释仍写“写作模式不使用 Plot 系统”。

目标应改成：

- writer 不直接持有 Plot tools，也不消费 legacy `threadIds/sceneIds/plotIds`；但可以消费 `invoke_agent.message` 中完整 Scene / World Context brief。

## Test Seam Reading

Slice 1 不应靠一个测试证明完成。当前已有三个相关测试 seam：

1. `server/agent/profiles/simulation-director-profiles.test.ts`
   - 适合承载 director source prompt、toolset 和 schema strict 测试。
   - 应新增 `Value.Check(DirectorOutputSchema, ...)` 正负例。
   - 应对 prompt 加负断言：不含 `Simulation gate`、`simulator_requests`、`simulator.leader`。
   - 应加正断言：含 `world_engine_requests`、未决 World Engine 交回 `leader.default`。

2. `server/agent/profiles/leader-assets-profile.test.ts`
   - 已真实 prepare `leader.default`，并检查 injected reference / prompt。
   - 适合证明 leader.default 可路由 director，但不持有 Plot tools。
   - 应增加：visible prompt / history reference 不再包含“不路由到 Plot / simulator / director / RP”。
   - 应增加：包含 Scene / Chapter / writer brief 路由到 director 的语言。
   - 保持 `leader.default.rootToolKeys` 不包含 Plot write tools。

3. `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts` 与 `leader-assets-profile.test.ts` 中 writer payload 测试
   - 已证明 writer 有 readonly `execute_world` 且无 Plot tools。
   - 已证明 legacy `threadIds/sceneIds/plotIds` 不渲染给 writer。
   - 应补一条正向 prompt / invocation message 语义：writer 可以从 `invoke_agent.message` 消费 Scene / World Context brief。

## Minimal Schema Fixture

`DirectorOutputSchema` strict 正例：

```ts
{
    summary: "已整理本章 Scene。",
    status: "completed",
    plot_updates: [{
        kind: "scene",
        action: "updated",
        id: "scene-1",
        title: "遭遇",
        summary: "补齐 World Anchor。",
    }],
    chapter_plan: "按 Scene 顺序推进。",
    writer_handoff: "交给 writer 的 Scene / World Context brief。",
    world_engine_requests: ["需要确认 scene-1 结束时 erina 的位置。"],
    open_questions: [],
}
```

负例必须覆盖：

- root extra field。
- `plot_updates` item extra field。
- old `simulator_requests`。
- old `plot_updates.kind = "plot"`。
- 缺 `world_engine_requests`。

这组 fixture 的价值是把 `DirectorOutputSchema` 的 Interface 变成测试面，而不是只凭 prompt 文案判断。

## Implementation Guard

Slice 1 的补丁应保持原子性：

1. schema strict 与字段迁移。
2. director prompt 删除 simulator gate，改用 `world_engine_requests`。
3. leader.default prompt/reference 改为 Scene / Chapter / writer brief 路由 director。
4. writer prompt/comment 保持无 Plot tools，但承认可消费上游 brief。
5. 三个测试 seam 同步更新。
6. 再做 system/user profile compile/sync 与 artifact grep。

如果只改 schema，旧 prompt 会继续引导 director 输出 `simulator_requests`，形成 runtime 重试或失败；如果只改 prompt，schema 仍会允许旧字段和 `"plot"` kind，Agent-facing Interface 仍不稳定。

## Conclusion

Slice 1 的深 Module 不是某一个 profile 文件，而是 “profile contract” 这个 Interface：schema、prompt、reference、toolset、compiled artifact 和 tests 必须一起移动。测试 seam 应分层承载：director 证明输出合同，leader 证明路由合同，writer 证明隔离与 brief consumption。这样实现才具备 Locality，后续 `get_chapter_writer_brief` 不会绑定到旧 simulator contract。
