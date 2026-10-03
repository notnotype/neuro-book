# 2026-06-30 Round 52 - Director Output Schema Verification

## Scope

本轮核对 `DirectorOutputSchema` 的可验证方式。目标是避免 Slice 1 只改 prompt，却没有机械证据证明旧字段和旧 kind 已被拒绝。

本轮不修改业务代码。

## Evidence

当前 `report_result` runtime 行为：

- `createReportResultTool()` 只在 `report.data` 存在时调用 `assertStrictSchemaValue(options.dataSchema, report.data)`。
- `assertStrictSchemaValue()` 使用 `Value.Check(schema, value)`，失败后用 `Value.Errors()` 输出错误。
- harness 在组合 profile 工具时，如果 `report_result` binding 未提供 `dataSchema`，会使用 `profile.outputSchema`。
- provider-visible `report_result.data` 是 optional。这是故意设计，用于任务失败或只返回可读错误时仍能结束 run。

因此 Slice 1 可证明的内容是：

- **只要 director 提供 `report_result.data`，data 必须符合 `DirectorOutputSchema`。**
- **不能证明 director 每次都必须提供 `data`。**

## Current Gap

当前 `DirectorOutputSchema` 的问题：

- root object 没有 `{additionalProperties: false}`，混入旧 `simulator_requests` 等额外字段时 TypeBox 默认可能接受。
- `plot_updates` item 没有 `{additionalProperties: false}`，每个 update item 可混入额外字段。
- `plot_updates.kind` 仍包含 `"plot"`，这会让旧 Plot Beat/StoryPlot 语言继续通过结构化输出。
- 字段名仍是 `simulator_requests`，不是 `world_engine_requests`。

## Verification Contract

Slice 1 应新增或改造测试，直接用 TypeBox `Value.Check()` 验证 `DirectorOutputSchema`：

### Positive fixture

```ts
{
    summary: "已更新章节场景结构。",
    status: "completed",
    plot_updates: [{
        kind: "scene",
        action: "updated",
        id: "12",
        title: "雨夜会面",
        summary: "补充 Scene World Anchor。",
    }],
    chapter_plan: "",
    writer_handoff: "可交给 writer 的 brief 草案。",
    world_engine_requests: [],
    open_questions: [],
}
```

应通过。

### Negative fixtures

必须拒绝：

- root 混入 `simulator_requests`。
- 缺少 `world_engine_requests`。
- `plot_updates[0].kind = "plot"`。
- `plot_updates[0]` 混入未知字段，例如 `plotId`。
- root 混入未知字段，例如 `legacy_state`.

## Where To Test

推荐把 schema-only 断言放在 `server/agent/profiles/simulation-director-profiles.test.ts` 或新增 `server/agent/profiles/director-output-schema.test.ts`。

理由：

- 这是 profile contract，不是 control tool runtime 的职责。
- `control-tools.ts` 已覆盖 generic report_result schema 行为；这里要证明的是 director 的 output schema 内容。
- 测试不需要启动 harness，也不需要模拟完整模型回合。

## Prompt Requirement

prompt 仍应要求 director 完成后调用 `report_result` 并提供 `data`。但验收措辞必须准确：

- 可以写：director prompt 要求 `report_result.data` 符合 OutputSchema。
- 不应写：runtime 强制 director 必须提供 `report_result.data`。

如果后续确实要强制 data 必填，应另开 runtime/profile binding 设计，不塞进 Slice 1。

## Result

`DirectorOutputSchema` 的验收必须是机械 schema 断言，而不是只看 prompt 字符串。Slice 1 完成标准应包含：合法新合同通过，旧 `simulator_requests`、旧 `plot` kind 和额外字段被 TypeBox 拒绝；同时不声称 runtime 已强制 data 必填。

