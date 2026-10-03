# Round 16 - Preview Scalar Op Fix

## Scope

本轮继续审查 `/world-engine.preview` 的手工 mutation 生成路径。Round 14 已按 attr kind 推导 op，但 `scalar` 仍一律暴露 `add`。这对数值属性成立，但对 `text / bool / ref(...)` 这类 scalar 会诱导用户写出后端必然拒绝的 mutation。

## Finding

- `opOptionsForPreviewAttr()` 原规则：
  - `scalar` -> `set / add / unset`
- 问题：
  - `mind: text` 暴露 `add` 没意义。
  - `alive: bool` 暴露 `add` 没意义。
  - `location: ref(location)` 暴露 `add` 会生成非法引用变更。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - 只有 `type` 为空、`int` 或 `float` 的 scalar 才暴露 `add`。
  - `text / bool / ref(...) / enum` 等非数值 scalar 只暴露 `set / unset`。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `hp:int` 保留 `set / add / unset`。
  - 覆盖 `mind:text`、`alive:bool`、`location:ref(location)` 只返回 `set / unset`。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts server/api/projects/world-engine/[...segments].test.ts`
  - 通过：2 个测试文件，12 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；后续需要在页面中确认 Mutation Builder 的 op 下拉是否符合预期。

## Code Review Notes

- 这轮不改变后端校验，只减少 preview 暴露给用户的无效操作。
- 未声明 type 的 scalar 仍保留 `add`，因为这类属性可能是动态数值属性，preview 不足以判断。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
