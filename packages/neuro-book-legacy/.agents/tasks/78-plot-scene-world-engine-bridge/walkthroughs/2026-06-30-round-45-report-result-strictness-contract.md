# 2026-06-30 Round 45 - Report Result Strictness Contract

## Scope

本轮审查 director 输出合同在 `report_result` 运行时的真实校验能力。目标是确认 Slice 1 能否机械拒绝旧 `simulator_requests` 和 `plot_updates.kind = "plot"`，以及需要怎样写 schema 和测试。

本轮不修改业务代码。

## Evidence

当前运行时链路：

- `server/agent/profiles/report-result-schema.ts` 用 profile `outputSchema` 派生模型可见 `report_result` 参数。
- `server/agent/harness/neuro-agent-harness.ts` 的 `toolOverrides()` 会为当前 profile 创建 `createReportResultTool(reportResultSchemaForProfile(profile), {dataSchema})`。
- `server/agent/tools/control-tools.ts` 的 `createReportResultTool()` 在 `report.data` 存在时用 `assertStrictSchemaValue(options.dataSchema, report.data)` 校验。
- `assertStrictSchemaValue()` 使用 `Value.Check()`，不做 Parse/Convert；失败会抛错。
- harness 已有测试证明 `report_result` 校验失败后会继续下一轮让模型修正，连续失败 3 次后报 Runtime Error。

本轮额外用只读命令验证 TypeBox 行为：

```text
Type.Object({world_engine_requests}) 默认允许额外字段。
Type.Object({world_engine_requests}, {additionalProperties: false}) 才会拒绝 simulator_requests。
```

## Implication

仅从 `DirectorOutputSchema` 删除 `simulator_requests` 字段不够。若根对象没有 `additionalProperties: false`，payload 同时包含：

```json
{
  "world_engine_requests": [],
  "simulator_requests": []
}
```

仍会通过 `Value.Check()`。

同理，`plot_updates` 数组里的 item 如果不设 `additionalProperties: false`，虽然 `kind = "plot"` 会被新的 union 拒绝，但额外旧字段仍可能被接受。

## Required Slice 1 Shape

`DirectorOutputSchema` 应使用严格对象：

- root `Type.Object(..., {additionalProperties: false})`
- `plot_updates` item `Type.Object(..., {additionalProperties: false})`

字段合同：

- `summary`
- `status`
- `plot_updates`
- `chapter_plan`
- `writer_handoff`
- `world_engine_requests`
- `open_questions`

禁止：

- root 额外字段 `simulator_requests`
- `plot_updates.kind = "plot"`
- `plot_updates` item 额外旧字段，例如 `plotId`

## Test Requirement

Slice 1 不能只测 `Value.Check(DirectorOutputSchema, validPayload)`。必须补负例：

- legacy-only payload：只有 `simulator_requests`，缺 `world_engine_requests`，应失败。
- mixed payload：同时有 `world_engine_requests` 和 `simulator_requests`，应失败。
- `plot_updates.kind = "plot"`，应失败。
- `plot_updates` item 含额外旧字段，应失败。

更强证据：

- 用 director profile 派生的 `report_result` 工具执行一个带 `simulator_requests` 的 `data`，应返回校验错误。
- 或在 harness 层复用已有 `report_result 校验失败后继续修正` 模式，构造 director schema case。

## Result

Slice 1 的“删除旧字段”必须是 strict schema 改造，不是字段列表替换。否则旧字段会被模型继续输出并被运行时接受，设计目标无法被 Interface 约束。

