# Round 08 - Mutation Builder

## Scope

本轮继续优化 `/world-engine.preview` 的用户试用体验。Round 07 已经补了 editSlice 和默认时间避冲突，但写 mutation 仍主要依赖手写 JSON；这对第一次试用不够友好。

## Actual Changes

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `parseLooseJsonValue(input)`。
  - 数字 / 布尔 / null / 对象 / 数组 / 带引号字符串按 JSON 解析。
  - 普通文本自动作为字符串处理，例如 `subject://capital` 不需要手写成 `"subject://capital"`。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖数字、普通文本 ref、非法对象 JSON。
- 更新 `app/pages/world-engine.preview.vue`：
  - 在 Write Slice 区域新增 `Mutation Builder`。
  - 支持选择 subject、attr、op、value。
  - 根据 attr kind 提供 op 选项：
    - `list` -> `listAppend`
    - `collection` -> `collectionAdd` / `collectionRemove`
    - 其他 -> `set` / `add` / `unset`
  - 支持“追加”到当前 mutations JSON，或“替换”为当前 builder mutation。
  - 仍保留 JSON textarea，方便高级调试和直接复制 Agent/API payload。

## Decisions

- Builder 是 JSON textarea 的辅助层，不取代底层 mutation JSON。原因：第一版需要兼顾调试灵活性和可用性；正式产品 UI 后续再做更完整的结构化编辑器。
- Builder value 采用宽松解析，而最终提交前仍调用 `parseMutationJson()` 做完整 mutation 结构校验。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 通过：1 个测试文件，5 个用例。
- `bun run typecheck`
  - 通过。
- `bunx vitest run server/api/projects/world-engine/[...segments].test.ts server/world-engine/world-engine.facade.test.ts`
  - 通过：2 个测试文件，7 个用例。
- `bunx vitest run server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 通过：2 个测试文件，6 个用例。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；当前页面更适合下一轮用户确认后的浏览器试用：

1. 新建 Project。
2. 创建 subject。
3. 用 Mutation Builder 追加 mutation。
4. 写入 slice。
5. 查询 state。
6. 载入 timeline slice 并编辑保存。

## Code Review Notes

- `parseLooseJsonValue()` 把普通文本作为字符串，降低试用门槛。
- 如果用户输入 `{bad` 这类看起来像 JSON 的内容，会返回解析错误，不会静默当字符串。
- `unset` op 不带 value。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
