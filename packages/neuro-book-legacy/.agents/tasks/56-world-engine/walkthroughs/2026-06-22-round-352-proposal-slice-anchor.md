# Round 352 - Proposal Slice Anchor

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- P0 主体文件建议已经支持单个 / 全部复制，适合交给作者人工审查或后续 Agent。

## Finding

- 复制文本此前包含 subject path、source、events / memory / state 建议，但没有明确 `sliceId`。
- 作者把 proposal 交给后续 Agent 或稍后回查时，缺少稳定 slice 锚点，容易只能靠时间 / 标题猜是哪条切面。

## Implementation Walkthrough

- `world-engine-workbench-preview.types.ts`
  - `WorldWorkbenchSubjectFileProposal` 增加 `sliceId / sliceTime / sliceTitle / sliceKind`。
- `world-engine-workbench-real.ts`
  - `buildWorldWorkbenchSubjectFileProposals()` 从 selected slice 写入上述元信息。
  - `formatWorldWorkbenchSubjectFileProposal()` 在复制文本头部输出 slice 元信息。
- `world-engine-ide-entry.test.ts`
  - 断言 proposal 对象和复制文本都包含 slice id/time/title/kind。
- `world-engine-workbench-preview.test.ts`
  - 补静态断言，防止类型字段和 formatter 输出被回退。

## Verification / Test

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，2 个测试文件、9 个用例。

## Result

- 主体文件建议复制文本现在带有稳定 slice 锚点，后续人工审查或 Agent 处理时可以准确回查原切面。
- P0 边界不变：只增强文本上下文，不自动写 `simulation/subjects`，不改变后端 / Agent 工具契约。
