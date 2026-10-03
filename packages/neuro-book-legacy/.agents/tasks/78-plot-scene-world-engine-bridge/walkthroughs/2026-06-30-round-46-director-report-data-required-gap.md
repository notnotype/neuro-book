# 2026-06-30 Round 46 - Director Report Data Required Gap

## Scope

本轮审查 `director` 是否能被机械强制返回 `report_result.data`。这影响 leader 是否总能从 `invoke_agent.result.data` 读取 `plot_updates / writer_handoff / world_engine_requests`，而不是只能读自然语言 message。

本轮不修改业务代码。

## Evidence

当前 report result 设计：

- `reportResultSchemaForProfile()` 对非空 `outputSchema` 生成：
  - `result: string` 必填
  - `data?: OutputSchema` 可选
- `createReportResultTool()` 只在 `"data" in report` 时校验 `dataSchema`。
- 如果模型只调用 `report_result({result: "..."})`，工具会成功。
- `agent-collaboration-tools.ts` 的 `compactInvokeAgentResult()` 只有在 `reportResult.data !== undefined` 时才把 `result.data` 返回给调用方。

也就是说：当前运行时能机械校验“给了 data 时必须符合 OutputSchema”，但不能机械强制“必须给 data”。

## Risk

`director` 是 profile/tool 架构中的关键 Module。它的 Interface 预期是结构化结果：

- `plot_updates`
- `chapter_plan`
- `writer_handoff`
- `world_engine_requests`
- `open_questions`

如果 director 只返回自然语言 `result`，leader 仍能看到 message，但会失去结构化 `world_engine_requests` 和 `writer_handoff`。这会降低 Agent 易用性，因为 leader 需要从文本里重新解释 director 输出。

## Options

### A. Prompt-only

保持当前 runtime 机制，只在 director System 中写死：

```text
完成后必须调用 report_result。report_result.data 必须符合 OutputSchema。
```

优点：

- 改动小，符合 Slice 1 最小目标。
- 不影响其他 profile 的 report_result 语义。

缺点：

- 不是机械约束；模型仍可能省略 data。

### B. Profile-specific required data

扩展 `builtin.result.main()` / `ReportResultToolBinding`，增加类似 `requireData: true` 的选项。director 使用该选项后，模型可见 schema 和执行校验都要求 `data` 必填。

优点：

- Interface 更深，leader 可稳定依赖 `invoke_agent.result.data`。

缺点：

- 这是 report_result Module 的通用能力变更，超出 Slice 1 文本/contract cleanup。
- 需要更新 report-result schema、control tool、harness overrides 和 tests。

### C. Leader fallback parses message

允许 leader 在缺 data 时从 director message 里提取结构。

结论：不建议。它把结构化 Interface 重新退回文本解析，Locality 变差。

## Decision For Next Slice

Slice 1 采用 **A. Prompt-only**，但记录验收限制：它能严格拒绝错误 data，不能严格保证 data 一定存在。

如果后续真实使用中 director 经常漏 `report_result.data`，应单列一个小改动加深 report_result Module：给 profile binding 增加 required-data 选项。

## Test Requirement

Slice 1 应测试：

- director System 明确写 `report_result.data 必须符合 OutputSchema`。
- `DirectorOutputSchema` strict 负例。
- report_result 工具对错误 data 会失败。

不应声称：

- 当前 runtime 已机械强制 director 必须提供 data。

## Result

当前设计足以让 director 的 data 在提供时变成强 Interface，但“必须提供 data”仍是 prompt-level 约束。这个缺口不阻塞 Slice 1，但最终 Agent 易用性验收时要单独观察。

