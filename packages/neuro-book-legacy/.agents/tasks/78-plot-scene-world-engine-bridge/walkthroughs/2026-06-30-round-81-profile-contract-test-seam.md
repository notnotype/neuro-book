# Round 81: Profile Contract Test Seam

## Scope

本轮用 Module / Interface / Depth / Locality 口径审查 Slice 1 的测试入口。结论是：`simulation-director-profiles.test.ts` 应成为 profile contract 的主要测试 seam，但它现在还偏浅，只验证 prompt 片段和 toolKeys，尚未把 `DirectorOutputSchema` strict 合同纳入同一个验收面。

## Current Evidence

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - 已测试 `directorProfile.initialSchema === DirectorInitialSchema`。
  - 已测试 `directorProfile.outputSchema === DirectorOutputSchema`。
  - 已测试 director toolKeys 包含 `get_scene_world_context`，不包含 `write/edit`。
  - prompt 断言仍是基础正断言：`剧情导演`、`Thread / Scene`、`不维护 simulation/subjects/**`、`reference/plot/agent-spec.md`。
  - 没有测试 `simulator_requests` / `Simulation gate` / `simulator.leader` 必须消失。
  - 没有用 TypeBox `Value.Check()` 验证 strict output schema。
- `server/agent/profiles/builtin-contracts.ts`
  - `DirectorOutputSchema` 仍允许 `plot_updates.kind = "plot"`。
  - 仍存在 `simulator_requests`。
  - root 和 `plot_updates` item 没有显式 `additionalProperties: false`。

## Interface Problem

当前测试 seam 的 Interface 还没有表达“director 可被 leader 安全调用”的全部事实。leader 真正依赖的不是 prompt 某句话，而是：

- director 不再把世界状态未决问题交给 `simulator.leader`。
- director 输出字段稳定为 `world_engine_requests`。
- 旧字段或额外字段会被 schema 拒绝。
- writer handoff 是文本草案，不是 writer 直接读 Plot id 的要求。

如果只断言 prompt contains，测试是 shallow Module：Interface 几乎等于实现文本，改 wording 很容易误伤，旧 schema 也可能继续通过。

## Deepening Opportunity

把 `simulation-director-profiles.test.ts` 深化为 profile contract Module：

- Prompt Interface：
  - 正断言：`World Engine requests` / `world_engine_requests` / `writer_handoff` / `Scene World Anchor`。
  - 负断言：无 `simulator_requests`、无 `Simulation gate`、无 `simulator.leader`。
- Tool Interface：
  - director 持有 Plot read/write 和 Scene World Context。
  - director 不持有 `write/edit/apply_patch`。
  - writer 不持有 Plot tools。
- Schema Interface：
  - valid new output passes。
  - legacy `simulator_requests` fails。
  - legacy `plot_updates.kind = "plot"` fails。
  - root extra fails。
  - plot update item extra fails。

## Benefits

- **Leverage**：一次测试能证明 leader 调 director 的运行时合同，而不是只证明 prompt 里有关键词。
- **Locality**：Slice 1 的破坏面集中在一个 profile contract 测试文件和一个 schema-only 测试块，不需要在后续 tool / HTTP 测试里反复补旧字段负例。
- **Deletion test**：如果删除这个测试，旧 `simulator_requests` / `plot` kind 的复杂度会回流到每个调用方和每次人工审查；说明这个 Module 应该存在。

## Conclusion

Slice 1 的第一组测试应先加深 profile contract seam，再改 profile/source/schema。否则实现后只能证明“代码看起来改了”，不能证明 Agent 运行时合同已经变成 Director + Brief Compiler。

