# Round 15 - Preview Ref Defaults

## Scope

本轮继续优化 `/world-engine.preview` 的手工写入体验。Round 14 已让 Schema 快捷按钮和 Mutation Builder 按 attr kind 推导 op/default value，但 `ref(...)` 属性仍只填 `"subject://"` 占位。真实试用时，如果已有目标类型 subject，preview 应该帮用户直接填入可用引用。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - `defaultMutationForPreviewAttr(subjectId, attr, subjects)` 新增第三个参数，可根据已有 subjects 推导 ref 默认值。
  - `ref(location)` 会优先填第一个 `location` subject，例如 `subject://capital`。
  - `ref(item)` 会优先填第一个 `item` subject，例如 `subject://old-sword`。
  - 如果没有匹配 subject，仍保留 `"subject://"` 占位。
- 更新 `app/pages/world-engine.preview.vue`：
  - Schema attr 快捷按钮调用 `defaultMutationForPreviewAttr(..., subjects.value)`。
  - Mutation Builder 切换 subject / attr 时，会刷新默认 op/value。
  - 新增 `formatBuilderValue()`，统一把 JSON value 显示回输入框。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `collection ref(item)` 在有 `old-sword` 时默认生成 `subject://old-sword`。
  - 覆盖 `scalar ref(location)` 在有 `capital` 时默认生成 `subject://capital`。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts server/api/projects/world-engine/[...segments].test.ts`
  - 通过：2 个测试文件，12 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；这轮修复需要后续在页面里真实点击 `location` / `inventory` 这类 ref 属性确认交互体验。

## Code Review Notes

- 这轮没有改变后端契约，只是让 preview 更容易生成能通过后端校验的 ref mutation。
- 当前策略是选第一个匹配 type 的 subject。正式 UI 后续应提供可选列表，而不是隐式选第一个。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
