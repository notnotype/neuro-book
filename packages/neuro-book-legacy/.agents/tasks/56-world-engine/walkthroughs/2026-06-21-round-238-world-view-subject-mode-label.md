# Round 238: 当前视角 subject 模式改成人读文案

继续打磨主 Workbench 与 mock preview 的当前视角提示。前两轮处理了 mixed subject 过滤里的真实可写目标和不可满足过滤；接着检查顶部当前视角时发现还在显示 `subjects(any)` / `subjects(all)` 这类内部枚举值。

这不会影响数据，但会让作者在真实推演时多停一拍：中间 Slice List 已经使用“任一 subject / 全部 subject”，顶部却暴露 `any/all`。本轮把两处统一成人读文案。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 顶部 `worldViewLabel` 的 subject 过滤模式改为“任一 subject”或“全部 subject”。
- `world-engine.workbench-preview.vue`
  - mock preview 顶部当前视角使用同一套人读文案，保持设计预览和真实 Workbench 一致。
- `world-engine-ide-entry.test.ts`
  - 补真实 Workbench 静态契约断言。
- `world-engine-workbench-preview.test.ts`
  - 补 mock preview 静态契约断言。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续检查 subject filter 与 timeline query 的一致性。实际没有发现需要改后端或过滤逻辑的矛盾；只收口了用户可见文案，避免真实 Workbench 和 preview 在同一个模式上使用不同语言。
