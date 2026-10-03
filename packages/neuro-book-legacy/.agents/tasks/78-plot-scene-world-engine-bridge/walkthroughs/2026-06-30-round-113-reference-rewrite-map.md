# Round 113: Reference Rewrite Map

## Scope

本轮把 Slice 1 `Profile Contract Cleanup` 中 reference 层的旧语义改写成可执行地图。目标是实现时不只改 profile prompt，而是同步修正 `HistorySet` 注入给 Agent 的稳定 reference。没有改业务代码、没有运行测试。

## Current Drift

当前旧语义主要落在三处：

- `reference/agent/leader-default.md`
  - 仍写着 `leader.default` 不维护 Plot 系统，且不要路由、创建或调用 `plot / simulator / director / emulation`。
  - `invoke_agent.input.context` 仍列出 `threadIds / sceneIds / plotIds`，但没有解释这些是 legacy compatibility，不是普通写作路径。
- `reference/agent/profile-routing.md`
  - `leader.default` 行仍写着不路由到 Plot / simulator / director / RP。
  - `director` 行仍把世界状态未裁决路由到 `simulator.leader`。
- `reference/agent/novel-writing-workflow.md`
  - 仍把普通写作链写成 leader 直接推进 World Engine 后调用 writer。
  - 仍写 writer 不读取 Plot / simulation 作为普通写作状态源，但没有表达“writer 不直接持有 Plot tools，可消费 director/brief compiler 生成的 Scene / World Context brief”。

这些 reference 会通过 `HistorySet` 注入 profile。只改 profile `System` 不够；旧 session 也可能保留旧 reference 语义。

## Target Rewrite

### `leader-default.md`

应保留：

- `leader.default` 是用户协作入口。
- 动态世界状态与时间线真相源仍是 World Engine。
- writer 的写入目标只来自 `invoke_agent.input.path`。
- `invoke_agent.message` 承载完整任务/brief。

应删除或替换：

- 删除“不要路由、创建或调用 director / Plot”的绝对说法。
- 替换为：
  - `leader.default` 不直接持有 Plot write tools。
  - Scene / Chapter / writer brief 工作应路由到 `director`。
  - Plot System 是 Scene-only 作者结构层，不是动态世界状态真相源。
  - `director` 可返回 `writer_handoff`、`world_engine_requests` 和 `open_questions`。
  - `leader.default` 负责确认并写入 World Engine，再决定是否调用 writer。

建议新增一个稳定小节：

```md
### Scene / Chapter Planning

涉及 Scene 编排、章节 Scene 顺序、Plot World Anchor 或 writer handoff 时，先查询 `get_agent_profile("director")`，再创建或复用 director。director 负责 Plot Thread / Scene 和 `get_chapter_writer_brief`；leader.default 不直接持有 Plot write tools。

director 返回的 `world_engine_requests` 由 leader.default 判断并通过 World Engine 写入或交给 `world.engine` 处理。writer 只接收最终 writer-safe brief。
```

### `profile-routing.md`

`leader.default` 行应改成：

- 适合：增加“调度 director 做 Scene / Chapter / brief”。
- 不适合：仍包括用户资产、RP 主持、正式正文长期亲自写、直接维护 Plot write tools。
- 错位建议：Scene / Chapter / writer handoff 转 `director`；World Engine schema/calendar/tooling 转 `world.engine`；正式正文转 `writer`。

`director` 行应改成：

- 适合：剧情结构、Thread / Scene、Chapter Scene order、Scene World Anchor、writer brief。
- 不适合：正文写作、World Engine 写入、simulation state 写回、联网研究、用户资产维护。
- 错位建议：World Engine 写入请求回 `leader.default` 或转 `world.engine`；正文转 `writer`；项目统筹回 `leader.default`。

重点是删掉普通写作下“世界状态未裁决先转 simulator.leader”的默认路径。`simulator.leader` 仍可作为 legacy / RP profile 存在，但不应成为 novel writing mode 的 gate。

### `novel-writing-workflow.md`

主链应从：

```text
leader -> World Engine -> writer
```

改成更准确的：

```text
leader.default -> director for Scene/Chapter plan -> leader.default for World Engine facts -> director for writer brief -> writer
```

实际流程可以合并往返，但责任不应合并：

- `director` 负责 Scene / Chapter 结构和 brief 编译。
- `leader.default` 负责 World Engine 写入和 canon 决策。
- `writer` 只写正文。

writer 相关语言应改成：

- writer 不直接持有 Plot tools。
- writer 不通过 `threadIds/sceneIds/plotIds` 自行读取 Plot。
- writer 可以消费 `invoke_agent.message` 中由 director / brief compiler 生成的 Scene / World Context brief。

## Acceptance

Slice 1 后应能用 profile/reference 测试证明：

- `leader.default` prompt/reference 不再包含“不路由到 Plot / director”。
- `leader.default` prompt/reference 包含 Scene / Chapter / brief 路由到 `director`。
- `profile-routing.md` 中 director 不再把普通写作世界状态裁决默认转 `simulator.leader`。
- `novel-writing-workflow.md` 明确 writer 不直接持有 Plot tools，但可消费上游 brief。
- 旧 `threadIds/sceneIds/plotIds` 仍不进入 writer rendered context。

## Conclusion

reference rewrite 不是文案清理，而是 Agent-facing Interface 修正。只改 runtime schema 或 source prompt 会留下 `HistorySet` 注入的旧协作规则，导致 Agent 继续把 Plot/director 当 legacy 系统排除。

