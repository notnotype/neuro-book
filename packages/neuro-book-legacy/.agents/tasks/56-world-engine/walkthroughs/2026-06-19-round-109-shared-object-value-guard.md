# Round 109: 共享 object value 校验 util

## 背景

第 107 轮为独立 Preview 增加了 `previewAttrNeedsJsonObject()` 与 `isJsonObjectValue()`，用于在提交前判断 object / list<object> / collection<object> 的 value 必须是非数组 JSON object。

继续审查时发现 Workbench Mutation Editor 里仍保留了本地 `jsonRecordOrNull()`，和 `isJsonObjectValue()` 判断同一件事。虽然当前行为一致，但两套判断会让 Preview / Workbench 在后续扩展 object 语义时更容易漂移。

## 变更

- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 引入共享 `isJsonObjectValue()`。
  - `parseJsonObjectBuilderValue()` 改用共享 util。
  - object 行编辑器里嵌套 object 字段的提交前校验改用共享 util。
  - `syncObjectRowsFromBuilderValue()` 改用共享 util 识别当前 builder JSON 是否为 object。
  - 删除本地 `jsonRecordOrNull()`。

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

- Preview / Workbench 的 JSON object 形状判断已收敛到同一个 util。
- 本轮不改变用户可见行为，只降低后续维护漂移风险。
- 没有自动做浏览器验证；真实浏览器用户流仍等待用户明确允许。

## 后续

- 浏览器验收时继续重点覆盖 Preview 与 Workbench 两个入口的 object value 输入和错误提示是否一致。
