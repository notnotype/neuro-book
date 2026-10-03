# Round 110: collectionRemove 字符串候选值保真

## 背景

继续做浏览器前的交互审查时发现，`collectionRemoveValueOptions()` 会把当前 state 里的 collection 项格式化成下拉候选。对象、数字、布尔都需要靠字符串作为 HTML select value，再由 Builder 提交路径用 `parseLooseJsonValue()` 还原。

问题出在字符串项：如果 collection 里本来就是字符串 `"80"`、`"true"`、`"null"`，旧逻辑会把 select value 设置为 `80`、`true`、`null`。提交时宽松 JSON 解析会把它们变成 number / boolean / null，导致后端按 stable JSON 删除时删不到原来的字符串项。

## 变更

- 更新 `app/utils/world-engine-preview.ts`：
  - `collectionRemoveValueOptions()` 继续用人读 label 展示原值。
  - 对会被 `parseLooseJsonValue()` 当作 JSON 的字符串，提交 value 改为 JSON 字符串字面量，例如：
    - 原字符串 `80` -> value `"80"`
    - 原字符串 `true` -> value `"true"`
    - 原字符串 `null` -> value `"null"`
  - 普通字符串如 `plain` 仍保持原样。
  - 非字符串项继续用 JSON 字面量。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 在 `collectionRemoveValueOptions()` 测试中增加 `codes: ["80", "true", "null", "plain"]`。
  - 断言 JSON-like 字符串 value 使用 JSON 字符串字面量，普通字符串不额外加引号。

## 验证

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：2 个测试文件、19 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

```powershell
bunx vitest run "server/api/projects/world-engine/[...segments].test.ts"
```

结果：1 个测试文件、6 个测试通过。

```powershell
bunx vitest run server/world-engine/world-engine.facade.test.ts
```

结果：1 个测试文件、36 个测试通过。

## 审查结论

- `collectionRemove` 下拉现在不会把 JSON-like 字符串误转类型。
- 这轮修复对 object 项、number 项、boolean 项仍保持原有 JSON 字面量提交流程。
- 没有自动做浏览器验证；真实浏览器用户流仍等待用户明确允许。

## 后续

- 浏览器验收时建议覆盖 collection 中包含 `"80"` / `"true"` 这类字符串项的删除路径，确认下拉显示和提交行为一致。
