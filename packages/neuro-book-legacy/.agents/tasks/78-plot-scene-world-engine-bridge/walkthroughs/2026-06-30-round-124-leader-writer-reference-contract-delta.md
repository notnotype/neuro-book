# Round 124: Leader / Writer / Reference Contract Delta

## Scope

本轮把 Slice 1 中 leader.default、writer 和 reference 的迁移口径写清楚。没有改业务代码、没有运行测试。

## Current Evidence

只读核查结果：

- `leader.default.profile.tsx`
  - System 仍写“本 leader 不维护旧 Plot / simulation 系统——这些在你这里不存在，不要尝试调用、创建或路由到它们”。
  - 但 leader.default 当前工具面没有 Plot tools，这一点符合第一阶段设计。
- `reference/agent/leader-default.md`
  - 更强地写了 `plot / simulator / director / emulation` 都不在 leader.default 职责内。
- `reference/agent/profile-routing.md`
  - `leader.default` 行写“不路由到 Plot / simulator / director / RP”。
  - `director` 行写世界状态未裁决先转 `simulator.leader`。
- `reference/agent/novel-writing-workflow.md`
  - 写 writer 不读取 Plot / simulation；legacy 段把 `director` 和 Plot System 放在普通写作之外。
- `writer.profile.tsx`
  - 工具面正确：没有 Plot tools，有 readonly `execute_world`。
  - `renderInputContext()` 注释仍写“写作模式不使用 Plot 系统”。
- `leader-assets-profile.test.ts`
  - 当前强约束 leader.default root tools 不含 Plot tools。
  - writer payload 测试已经证明 `threadIds/sceneIds/plotIds` 不渲染给 writer。

## Target Contract

### leader.default

保持：

- 用户协作入口。
- canon / Lorebook / Manuscript 协调入口。
- World Engine readwrite owner。
- 不直接持有 Plot write tools。

改变：

- 涉及 Scene / Chapter Plot / writer brief 时，leader.default 应创建或复用 `director`。
- leader.default 不再说 Plot/director “不存在”。
- leader.default 不路由到 `simulator.leader` 处理普通写作世界状态。

### director

保持：

- Plot write owner。
- Thread / Scene / Chapter scene ordering / writer handoff owner。
- 不写正式正文。

改变：

- 未决世界状态用 `world_engine_requests` 交回 leader.default。
- 不再调用 `simulator.leader`。
- 第一阶段不直接调用 writer，仍交给 leader.default 调 writer。

### writer

保持：

- 无 Plot tools。
- 不使用 `threadIds/sceneIds/plotIds` payload 直接读取 Plot。
- 只写 `invoke_agent.input.path`。
- 可 readonly 查询 World Engine。

改变：

- 不再把“写作模式不使用 Plot 系统”作为总体描述。
- 改成“writer 不直接持有 Plot tools；Scene / World Context brief 由上游 leader/director 在 `invoke_agent.message` 中注入，writer 可消费该 brief”。

## Test Migration

`leader-assets-profile.test.ts` 应新增或调整断言：

- `visiblePrompt` 包含 `director`。
- `visiblePrompt` 包含 “Scene / Chapter / brief” 路由到 director 的语义。
- `visiblePrompt` 不包含“不路由到 Plot / simulator / director / RP”。
- `visiblePrompt` 不包含“Plot / simulation 系统不存在”。
- 继续断言 `leader.default.rootToolKeys` 不含 Plot tools。

`simulation-director-profiles.test.ts` 应新增：

- director prompt 不含 `simulator.leader` / `simulator_requests` / `Simulation gate`。
- director prompt 含 `world_engine_requests`。

writer 相关测试保持旧 ids 不渲染，但调整语义：

- 继续断言 `writerProfile.rootToolKeys` 不含 Plot / brief tools。
- 继续断言 `writerInputContext` 不含 legacy `threadIds/sceneIds/plotIds`。
- 可以新增 prompt 断言：writer 可消费上游 message 中完整 Scene / World Context brief。

## Reference Rewrite

需要同步改写：

- `reference/agent/leader-default.md`
  - 把 “不路由、创建或调用 plot / simulator / director / emulation” 改为 “不直接持有 Plot tools；Scene / Chapter / writer brief 交给 director；World Engine 状态由 leader.default 负责”。
- `reference/agent/profile-routing.md`
  - `leader.default` handoff 加 `director`。
  - `director` handoff 把世界状态未决从 `simulator.leader` 改为 `leader.default` / World Engine。
  - `writer` 行写明由上游 brief 提供 Plot/World Context，不直接持有 Plot tools。
- `reference/agent/novel-writing-workflow.md`
  - 写作链路调整为 `leader.default -> director brief/compiler -> writer`。
  - 保留 writer 不直接读 Plot ids，但允许消费 `suggestedBriefMarkdown`。

## Conclusion

Slice 1 不是扩大工具面，而是改正路由语言：leader.default 不写 Plot，但知道什么时候调 director；writer 不持有 Plot tools，但能使用上游编译好的 Scene / World Context brief。这个迁移可以保持现有工具隔离，同时让 Agent 更容易走到 Plot / World Engine 桥接路径。

