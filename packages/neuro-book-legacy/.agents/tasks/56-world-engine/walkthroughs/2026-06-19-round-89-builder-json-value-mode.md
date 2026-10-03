# Round 89: Builder 顶层 JSON object value mode

## 背景

Workbench Mutation Builder 已经支持固定 object fields 的 JSON 输入，但继续检查 value mode 后发现一个缺口：

当 schema 声明 `list` / `collection` 的 `itemType` 是 `object` 时，Builder 实际要填写的是“单个 object item”。此前这类 value 会退回普通文本输入，schema shortcut 默认值也会退成空字符串。用户很容易把对象误写成字符串。

本轮补齐顶层 JSON object value mode，覆盖 `listAppend` / `collectionAdd` / `collectionRemove` 的 object item 输入。

## 变更

- 更新 `world-engine-preview.ts`：
  - `defaultMutationForPreviewAttr()` 对 `valueType === "object"` 生成 `{}` 默认值。
  - 这同时覆盖 `list itemType=object` 与 `collection itemType=object`。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 顶层 `builderValueMode === "json"` 时显示 JSON textarea。
  - textarea 使用 monospace，多行输入，提示当前 value 需要填写 JSON object。
- 更新 `WorldEngineMutationEditor.vue`：
  - `resolveBuilderValueMode()` 在 `previewAttrValueType(attr) === "object"` 时返回 `json`。
  - 新增 `parseJsonObjectBuilderValue()`，提交前要求 value 解析后必须是非数组 JSON object。
- 更新测试：
  - `world-engine-preview.test.ts` 覆盖 list / collection object item 的 `{}` 默认值。
  - `world-engine-ide-entry.test.ts` 增加顶层 json mode、textarea 和提交校验契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、17 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮只增强 Workbench Builder 的 value 输入与提交前校验，不改变后端 API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- `list/collection itemType=object` 现在不会再默认退成普通字符串。
- 顶层 JSON object 校验与固定 object fields 的嵌套 object 校验保持一致：数组、字符串、数字等都不能作为 object item 直接提交。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- `list/collection` 的专用输入仍可继续增强，例如集合项模板、collectionRemove 的现有值辅助选择、批量添加。
- 主 IDE Workbench 浏览器实测仍是关键验证。
