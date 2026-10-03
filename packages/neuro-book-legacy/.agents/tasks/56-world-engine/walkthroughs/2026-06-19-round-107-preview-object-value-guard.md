# Round 107: Preview object value 提交护栏

## 背景

继续做浏览器前的前端审查时，重点检查 object collection 的 `collectionRemove` 下拉是否会把 object 项误提交为字符串。Workbench 的正式 Mutation Builder 会按 `builderValueMode=json` 重新解析 JSON，因此该路径可工作。

但独立 Preview 的简化 Builder 仍只有单行 value 输入，并且在追加 / 替换 mutation 时只调用 `parseLooseJsonValue()`。如果用户为 `object`、`list<object>` 或 `collection<object>` 输入普通文本，前端会生成 string value，直到写 slice 时才被后端拒绝。这对真实试用不友好。

## 变更

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `previewAttrNeedsJsonObject(attr, op)`，集中判断当前 Builder value 是否必须是 JSON object。
  - 新增 `isJsonObjectValue(value)`，判断 JSON value 是否为非数组 object。
- 更新 `app/pages/world-engine.preview.vue`：
  - 计算 `mutationBuilderNeedsJsonObject`。
  - `addBuilderMutation()` 在追加 / 替换前校验 object value，非法时直接显示 `mutation value 必须是 JSON object`。
  - 把 object value 要求传给 Preview Actions。
- 更新 `app/components/novel-ide/world-engine/WorldEnginePreviewActions.vue`：
  - 透传 `mutationBuilderNeedsJsonObject` 到 `WorldEnginePreviewMutationBuilder`。
- 更新 `app/components/novel-ide/world-engine/WorldEnginePreviewMutationBuilder.vue`：
  - object value 输入切换为 JSON textarea。
  - `collectionRemove` 有当前状态候选时仍优先显示已有项下拉。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 `previewAttrNeedsJsonObject()` 对 object、list<object>、collection<object>、unset 和普通 text list 的判断。
  - 覆盖 `isJsonObjectValue()` 对 object / array / string 的判断。

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

- 独立 Preview 的 object value 体验与 Workbench 更接近：用户会看到 JSON textarea，并在前端先收到 object 形状错误。
- `collectionRemove` object 项候选仍使用 JSON 字符串作为 select value；提交路径会重新解析为 object，本轮保留这个轻量方案。
- 没有自动做浏览器验证；真实浏览器用户流仍等待用户明确允许。

## 后续

- 浏览器验收时需要重点观察 Preview JSON textarea、Workbench object editor、collectionRemove 下拉三条路径是否都顺手。
