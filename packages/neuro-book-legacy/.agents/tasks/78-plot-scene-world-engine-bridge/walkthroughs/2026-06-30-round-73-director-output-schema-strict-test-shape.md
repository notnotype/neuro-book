# Round 73: Director Output Schema Strict Test Shape

## Scope

本轮聚焦 Slice 1 的 `DirectorOutputSchema` 测试形态。目标是让旧 contract 在机械层面失败，而不是只靠 prompt 要求模型不要返回旧字段。

## Evidence Checked

- `server/agent/profiles/builtin-contracts.ts`
  - 当前 `DirectorOutputSchema` 仍允许 `plot_updates.kind = "plot"`。
  - 当前仍有 `simulator_requests`。
  - root object 没有显式 `additionalProperties: false`。
  - `plot_updates` item object 也没有显式 `additionalProperties: false`。
- `server/agent/profiles/report-result-schema.ts`
  - 非空 `OutputSchema` 会生成 optional `data`。
  - 运行时只能校验“提供了 data 时 data 符合 schema”。
  - 当前不能机械保证 director 必须提供 `report_result.data`。
- 现有测试模式
  - `server/agent/tools/*.test.ts` 已大量使用 `Value.Check()` 验证 TypeBox schema。
  - `server/agent/profiles/report-result-schema.test.ts` 已明确“非空 OutputSchema 只要求 result，data 按 OutputSchema 可选”。
  - `server/agent/profiles/simulation-director-profiles.test.ts` 是 director profile prompt/toolset 的当前主测试落点。

## Required Schema Shape

Slice 1 应把 director output 收敛成新合同：

- root `Type.Object(..., {additionalProperties: false})`
- `plot_updates` item `Type.Object(..., {additionalProperties: false})`
- `plot_updates.kind` 不再包含 `"plot"`
- `simulator_requests` 删除
- 新增 `world_engine_requests`，用于把需要 leader/world.engine 处理的 World Engine 问题显式交还上游

第一期不需要新增复杂 union。最小有效 shape 可以保持：

- `summary`
- `status`
- `plot_updates`
- `chapter_plan`
- `writer_handoff`
- `world_engine_requests`
- `open_questions`

## Test Cases

建议在 `server/agent/profiles/simulation-director-profiles.test.ts` 或新建 profile contract test 中加入 schema-only 用例：

1. Valid new output passes
   - `plot_updates` 可为空。
   - 至少一个 item 用 `kind: "scene"` 或 `kind: "thread"`。
   - `world_engine_requests: []`。

2. Legacy `simulator_requests` fails
   - 在 valid output 上额外加入 `simulator_requests: []`。
   - 期望 `Value.Check(DirectorOutputSchema, value)` 为 `false`。

3. Legacy `plot_updates.kind = "plot"` fails
   - 在 item 上设置 `kind: "plot"`。
   - 期望为 `false`。

4. Root extra field fails
   - 在 root 加 `extra: true`。
   - 期望为 `false`。

5. Plot update item extra field fails
   - 在 `plot_updates[0]` 加 `legacyId` 或 `extra`。
   - 期望为 `false`。

6. Missing `world_engine_requests` fails if required
   - 如果新 schema 将 `world_engine_requests` 设计为必填数组，则缺失该字段应失败。
   - 如果后续改为 optional，必须在字段 description 中写明缺失语义。当前建议必填并要求无请求时返回 `[]`。

## Non-goal

不要在 Slice 1 声称 runtime 已强制 director 必须调用 `report_result.data`。当前 `reportResultSchemaForProfile()` 的参数 schema 仍是 `data` optional，这个行为已有测试覆盖。Slice 1 的正确说法是：

- profile prompt 要求 director 调用 `report_result` 并提供结构化 data；
- 若提供 data，runtime 会按 strict `DirectorOutputSchema` 校验；
- 如果模型不提供 data，现阶段只能由 prompt/reminder/人工审查兜底，不能被本轮 schema 测试证明。

## Acceptance Impact

后续实现完成后，schema 测试应成为 Slice 1 的硬 gate。只改 prompt、不改 strict schema，不算完成 Profile Contract Cleanup。

