# Round 14 - Preview Builder Review Fixes

## Scope

本轮继续做 `/world-engine.preview` 的代码审查与修复，聚焦用户手工写 slice 的体验。Round 10-13 已经让“一键示例世界”更稳，但用户仍会使用 Schema 快捷按钮和 Mutation Builder 手工构造 mutation。

## Findings

- Schema 区域的 attr 快捷按钮只区分 `list` 与非 `list`：
  - `list` 生成 `listAppend`。
  - 其他属性一律生成 `set value=""`。
- 这会让 `collection` 属性（如 `character.inventory`）生成非法或不符合预期的 mutation：`set inventory = ""`，而不是 `collectionAdd`。
- `object` 属性也会暴露 `add`，虽然后端当前允许 `object` 走 `add`，但从用户角度这很容易写出怪异状态。
- Schema 快捷按钮点击某个 type 的属性时，原本使用当前 `subjectForm.id`，不一定是对应 type 的 subject。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `opOptionsForPreviewAttr(attr)`：
    - `list` -> `listAppend`
    - `collection` -> `collectionAdd / collectionRemove`
    - `object` -> `set / unset`
    - `scalar` -> `set / add / unset`
  - 新增 `defaultMutationForPreviewAttr(subjectId, attr)`：
    - `list` 默认 value = `"记录"`
    - `collection ref(...)` 默认 value = `"subject://"`
    - `int / float` 默认 value = `0`
    - `bool` 默认 value = `false`
    - `object` 默认 value = `{}`
- 更新 `app/pages/world-engine.preview.vue`：
  - Mutation Builder 的 op 列表改用 `opOptionsForPreviewAttr()`。
  - Schema attr 快捷按钮改用 `defaultMutationForPreviewAttr()`。
  - 点击某个 schema type 的 attr 时，优先选择同 type 的已有 subject；没有时再回退到当前 subject 表单。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 list / collection / object / int / bool 的 op 和默认值推导。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts server/api/projects/world-engine/[...segments].test.ts`
  - 通过：2 个测试文件，12 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；本轮修复仍需要后续在 `/world-engine.preview` 中真实点击 Schema attr 按钮和 Mutation Builder 验证。

## Code Review Notes

- 这轮修复降低了用户手工构造 mutation 时被后端校验拒绝的概率。
- `ref(...)` 属性的默认值仍只能给 `"subject://"` 占位，用户仍需要填具体 id；更智能的 ref 候选选择可以等浏览器验证后再决定是否做。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
