# Round 132: Profile Contract Cleanup Implementation Entry

## Scope

本轮继续只读探索 Slice 1 `Profile Contract Cleanup` 的实际开工入口。Round 122/129 已经说明要改哪些 Interface；本轮补齐当前 worktree 下的补丁顺序、测试落点、active user root 覆盖和 stop conditions。没有修改业务代码，没有运行测试。

## Domain / ADR Check

- `CONTEXT.md` 已定义 **Project Workspace**、**Project Path**、**Project SQLite** 和 Agent session 相关术语；本轮继续使用这些域词，不回退到 `novelId`、泛称 workspace 或全局数据库表述。
- `docs/adr` 当前不存在，因此没有需要遵守或重开的 ADR。

## Current Evidence

### Schema Interface

`server/agent/profiles/builtin-contracts.ts` 当前仍是旧 director output contract：

- `DirectorOutputSchema.plot_updates.kind` 允许 `"plot"`。
- root `Type.Object` 没有 `{additionalProperties: false}`。
- `plot_updates` item 没有 `{additionalProperties: false}`。
- 仍有 `simulator_requests`。
- 没有 `world_engine_requests`。

这是 Slice 1 的第一处强制 patch 面。只改 prompt 不改 schema，会继续允许旧字段回归。

### Director Source Interface

`assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 和 `workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 都仍含：

- `simulator.leader`
- `simulator_requests`
- `Simulation gate`
- “需要世界裁决时，创建或复用 simulator.leader”

这说明 system source 和 active user source 都必须被处理。只改 `assets/` 会被 user root 旧 source 覆盖。

### Leader Routing Interface

`assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 仍写：

- “不维护旧 Plot / simulation 系统”
- “不要尝试调用、创建或路由到它们”

`reference/agent/leader-default.md` 同样写 leader 不维护 Plot、不路由 `plot / simulator / director / emulation`。`reference/agent/profile-routing.md` 仍写：

- `leader.default` “不路由到 Plot / simulator / director / RP”
- `director` 未裁决世界状态转 `simulator.leader`

目标不是给 leader.default 增加 Plot tools，而是把 Scene / Chapter / writer brief 结构任务路由给 director；World Engine 未决问题仍由 leader.default 处理，必要时再调用 `world.engine`。

### Writer Isolation Interface

`assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx` toolset 仍正确：writer 没有 Plot tools，有 readonly `execute_world`。需要改的是 prompt/comment 语言：

- `normalizePayloadContext()` 注释仍写“写作模式不使用 Plot 系统”。

目标应改为：writer 不直接持有 Plot tools，不消费 legacy `threadIds/sceneIds/plotIds`，但可以消费 `invoke_agent.message` 中由 leader/director 编译好的完整 Scene / World Context brief。

### Test Surface

当前没有 `server/agent/profiles/writer.profile.test.ts`。writer 相关断言不能假设已有文件承载；实现时有两个选择：

- 新增专门的 writer profile test，承载 writer toolset、legacy Plot ids 不渲染、brief consumption prompt 断言。
- 或把 writer 断言合入现有 profile 测试文件，但要保持命名清楚，避免 `simulation-director-profiles.test.ts` 变成大杂烩。

当前 `simulation-director-profiles.test.ts` 只证明 director 暴露 Plot tools 和 Scene World Context，没有 schema strict 正负例，也没有旧 simulator gate 负断言。

`leader-assets-profile.test.ts` 已 prepare `leader.default` 并读取 injected reference，适合验证 leader routing Interface，但当前断言仍接受 reference 中“世界状态裁决转 `simulator.leader`”等旧路由语言。

### Runtime Source Of Truth

active user root 存在：

- `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `workspace/.nbook/agent/profiles/.compiled/manifest.json`

user compiled manifest 里的 director 仍指向 old artifact：

- `sourceSha256`: `80394e5e4ada1a54c87cb920526671392e493eb4bd060621ebc4efacb0a8ceb6`
- `artifactSha`: `33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17`

user director source 仍含旧 simulator contract。Slice 1 的完成证据必须覆盖 active user source 和 compiled artifact；不能只跑源码测试。

## Implementation Entry Order

Slice 1 应按以下顺序开工：

1. **Schema patch**
   - `DirectorOutputSchema` root strict。
   - `plot_updates` item strict。
   - 删除 `"plot"` kind。
   - 删除 `simulator_requests`。
   - 新增 `world_engine_requests`，description 说明“未决 World Engine 问题交回 leader.default”。

2. **Director source patch**
   - system director source 删除 `simulator.leader` / `Simulation gate` / `simulator_requests`。
   - 改成 director 不写 World Engine、不写正文；未决状态返回 `world_engine_requests`。
   - 输出合同文案同步 schema。

3. **Leader source + reference patch**
   - leader.default prompt 不再说 Plot/director 不存在。
   - 明确 leader.default 不直接持有 Plot write tools，但 Scene / Chapter / writer brief 结构任务路由 director。
   - `leader-default.md`、`profile-routing.md`、`novel-writing-workflow.md` 同步，避免 HistorySet injected reference 与 System prompt 冲突。

4. **Writer source patch**
   - 保持 writer 无 Plot tools。
   - 删除“写作模式不使用 Plot 系统”的绝对说法。
   - 改为“writer 不直接读取 Plot tools；可消费上游完整 Scene / World Context brief”。
   - legacy Plot ids 继续不渲染。

5. **Tests patch**
   - `simulation-director-profiles.test.ts` 增加 `Value.Check()` schema strict 正负例和 director prompt 负断言。
   - `leader-assets-profile.test.ts` 增加 leader routing 正断言和旧“不路由 Plot/director”负断言，保持 leader 无 Plot tools。
   - 新增或明确放置 writer profile test，证明 writer isolation 与 brief consumption。

6. **User root + compiled runtime proof**
   - 用现有 profile sync / compile 流程处理 active user root，而不是手工只改 system source 后结束。
   - 检查 system/user source、manifest `artifactSha` 和 active artifact 内容。
   - artifact 不应含 `simulator_requests` / `Simulation gate` / `simulator.leader`，应含 `world_engine_requests`。

## Test Fixtures

`DirectorOutputSchema` 正例应包含：

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

这组 fixture 是 Slice 1 最重要的 Interface 测试；prompt 文案测试只证明模型被正确引导，不能替代 schema strict。

## Stop Conditions

实现时遇到以下情况应停止并报告：

- 需要保留 `simulator_requests` alias 或 `"plot"` kind 才能让测试通过。
- TypeBox strict 负例无法拒绝 root / item extra field。
- user root source 已手改，非 force sync 输出 warning，无法确认覆盖是否安全。
- compiled manifest 没有更新，或 active artifact 仍含旧 simulator contract。
- writer 必须获得 Plot tools 才能通过新测试。
- leader.default 需要直接持有 Plot write tools才能完成 Slice 1。

## Deep Module Check

Slice 1 的深 Module 是 profile contract 本身，而不是某个单文件。它的 Interface 包含 schema、System prompt、reference、toolset、active user source、compiled artifact 和 tests。删除这个 contract 后，复杂度会重新散到 director prompt、leader routing、writer prompt 和 runtime artifact 检查中。

因此 Slice 1 的目标不是“改几段提示词”，而是让旧 simulator contract 在所有 Agent-facing Interface 上同时失效，为后续 OpenAPI / brief service / tool binding 提供稳定基底。

## Conclusion

当前 worktree 仍明确处于 Slice 1 未实现状态。下一次真正进入实现时，建议先按本轮顺序做 `Profile Contract Cleanup`，并在完成源码测试后补 active user root 和 compiled artifact 证据。继续直接扩写 brief tool 会把新能力绑到旧 director contract 上。
