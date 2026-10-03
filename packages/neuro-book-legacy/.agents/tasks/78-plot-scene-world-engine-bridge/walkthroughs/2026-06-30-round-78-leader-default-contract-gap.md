# Round 78: Leader Default Contract Gap

## Scope

本轮检查 `leader.default` 是否已经能作为普通写作入口，把 Plot / Scene 结构任务交给 `director`，再由 `director` 生成 writer brief。结论是：当前合同仍会把 Agent 导向 `leader.default -> writer`，并排除 Plot / director，这会阻塞 Slice 1 `Profile Contract Cleanup`。

## Current Evidence

- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
  - 仍写着遇到任何写作任务必须使用 writer。
  - World Engine 段落说本 leader 不维护旧 Plot / simulation 系统，且不要调用、创建或路由到它们。
  - 与 writer 协作段落仍是“先推进 World Engine，再调用 writer”，没有 `director` / `get_chapter_writer_brief` / Scene brief compiler 的位置。
- `reference/agent/leader-default.md`
  - `Writing Mode World State` 明确说 Plot / simulator / director / emulation 都不在 `leader.default` 职责内。
- `reference/agent/profile-routing.md`
  - `leader.default` 行写着不路由到 Plot / simulator / director / RP。
  - `director` 行仍把世界状态未裁决转给 `simulator.leader`。
- `reference/agent/novel-writing-workflow.md`
  - 普通写作链路仍是 `leader.default -> writer`。
  - writer 段落说不读取 Plot / simulation 作为普通写作状态源。
  - 末尾把 `director` 和 Plot System 放进 legacy / historical 语境。

## Interpretation

这些不是单纯措辞漂移。`leader.default` 是普通用户入口，如果它的 System 和 reference 都说不路由 director，那么后续即使 `director` 拿到 Plot tools / brief tools，leader 也不会稳定把 Scene / Chapter 结构工作交给它。

需要区分两件事：

- 正确：`leader.default` 不直接维护旧 Plot Beat / simulation，也不直接持有全套 Plot write tools。
- 错误：`leader.default` 不路由当前 Scene-only Plot / director。

## Target Contract

Slice 1 应把 leader 合同改成：

- `leader.default` 是普通写作总入口，负责用户协作、canon 判断、World Engine 写入和最终调用 writer。
- 涉及 Thread / Scene / Chapter ordering / Scene World Anchor / writer handoff 时，leader 调用 `director`。
- `director` 返回 `plot_updates`、`chapter_plan`、`writer_handoff`、`world_engine_requests`、`open_questions`。
- `world_engine_requests` 交回 leader，由 leader 自己用 `execute_world` 处理，或在复杂 schema/calendar/state 维护时再调用 `world.engine`。
- writer 仍不直接持有 Plot tools；writer 消费 leader/director 编译好的完整 `invoke_agent.message` brief，并使用 `invoke_agent.input.path` 写目标文件。

## Acceptance Impact

Slice 1 的测试不能只断言 `director.profile.tsx` 改好了，还必须覆盖：

- leader prompt/reference 不再出现“不路由到 director / Plot”的当前写作语义。
- 普通写作 workflow 明确包含 `leader.default -> director -> writer` 的结构化路径。
- writer 描述改为“不直接持有 Plot tools，但可消费上游 Scene / World Context brief”，而不是“写作模式不使用 Plot 系统”。
- `profile-routing.md` 将 `director` 世界状态未裁决出口改为 `leader.default` / World Engine，而不是 `simulator.leader`。

## Conclusion

Profile Contract Cleanup 的第一步应先修 leader 合同。否则后续 `get_chapter_writer_brief` 即使实现，也只会成为孤立工具，不能进入普通写作主链。

