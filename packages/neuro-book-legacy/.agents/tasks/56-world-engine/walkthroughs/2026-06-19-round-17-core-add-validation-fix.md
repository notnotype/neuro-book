# Round 17 - Core Add Validation Fix

## Scope

本轮原计划回到核心后端，审查 `queryState / listLimit / reduce` 查询语义。实际审查 `WorldEngineService` 时发现一个更靠近核心契约的问题：后端 `validateOp()` 仍把 `object` 和所有 `scalar` 都允许 `add`，与前面已定的“数值 scalar 才支持 add”不一致。

这是一次小绕道，但属于核心一致性问题，因此本轮优先修复并记录。

## Finding

- 旧规则：
  - `scalar` -> `set / add / unset`
  - `object` -> `set / add / unset`
- 问题：
  - `text / bool / ref(...)` 这类 scalar 不应支持 `add`。
  - `object` 不应支持 `add`。
  - preview 已经在 Round 16 隐藏了这些无效 op，但核心后端仍然过宽，导致 API / Agent 仍可能提交这类 mutation。

## Actual Changes

- 更新 `server/world-engine/world-engine.service.ts`：
  - 新增 `scalarOps(attrSchema)`。
  - 只有 `type` 为空、`int` 或 `float` 的 scalar 允许 `add`。
  - `text / bool / ref(...) / enum` 等非数值 scalar 只允许 `set / unset`。
  - `object` 只允许 `set / unset`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 测试 `mind:text add` 被拒绝。
  - 测试 `location:ref(location) add` 被拒绝。
  - 测试 `profile:object add` 被拒绝。
  - 测试 `hp:int add` 仍可用，并能 reduce 得到正确状态。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts app/utils/world-engine-preview.test.ts`
  - 通过：3 个测试文件，18 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；本轮是后端核心校验修复，不替代页面验收。

## Code Review Notes

- 这轮让后端核心校验与 preview 的 op 暴露规则保持一致。
- 未声明 type 的声明式 scalar 仍保留 `add`，因为项目 schema 可能用它表达动态数值；未声明属性本身仍只允许 `set/unset`。
- `validateValue()` 仍保留 `add value 必须是 number` 的防线。

## Walkthrough Delta

本轮计划从 `queryState/listLimit` 审查开始，实际绕道修复了更核心的 `add` 校验契约。该绕道已记录；`queryState/listLimit` 仍可在后续继续审查。
