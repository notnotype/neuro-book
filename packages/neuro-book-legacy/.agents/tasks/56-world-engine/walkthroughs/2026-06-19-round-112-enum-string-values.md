# Round 112: enum 下拉保留 JSON-like 字符串

## 背景

继续审查 Workbench Mutation Builder 的提交链路时发现，enum 下拉和 `collectionRemove` 有同类风险：下拉的 HTML value 最终会经过 `parseLooseJsonValue()`。

如果 schema enum 里允许字符串 `"80"`、`"true"` 或 `"null"`，旧的 enum option value 会直接写成 `80`、`true`、`null`。提交时这些字符串会被宽松 JSON 解析成 number / boolean / null，导致最终 mutation value 不再是 schema 里的字符串枚举项。

## 变更

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `formatJsonInputValue(value)`，用于把 JSON value 格式化成能被 `parseLooseJsonValue()` 保真还原的表单字符串。
  - `collectionRemoveValueOptions()` 的内部格式化改用同一个函数，避免保真规则分散。
- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - Workbench enum option 的提交 value 改用 `formatJsonInputValue()`。
  - option label 仍保留原先的人读显示，不额外加引号。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `formatJsonInputValue("80")` / `"true"` 会生成 JSON 字符串字面量。
  - 覆盖格式化后的 `"80"` 经 `parseLooseJsonValue()` 会还原为字符串 `"80"`。
  - 保持数字 `80` 仍格式化为 JSON number 字面量。

## 验证

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：2 个测试文件、19 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- Workbench enum 下拉现在不会把 JSON-like 字符串枚举项误转成 number / boolean / null。
- `collectionRemove` 与 enum 共用同一套表单 value 保真规则，后续再出现类似控件时可复用。
- 没有自动做浏览器验证；真实浏览器用户流仍等待用户明确允许。

## 后续

- 浏览器验收时建议加入字符串 enum 值 `"80"` / `"true"` 的写入路径，确认下拉显示和最终 mutation JSON 类型一致。
