# Round 106: 开放 object itemType 前端投影对齐

## 背景

第 104 轮修复了后端 `findAttrSchema()` 对开放 object `itemType: object` 子路径的解析：`memories.second` 应该是 object 属性，而不是非法的 `scalar type=object`。

继续做浏览器前的前端交互审查时，先检查了 `collectionRemove` 下拉：object collection 项会被格式化为 JSON 字符串放入 Builder value。Workbench 的提交路径会在 `builderValueMode=json` 时重新解析为 JSON object，Preview 的简化 Builder 也会通过 `parseLooseJsonValue()` 重新解析，因此这条路径可工作。

但审查发现前端 schema path 推导仍有后端第 104 轮的同源语义偏移：`resolvePreviewAttrPath()` 遇到开放 object 的 `itemType: object` 时会生成 `kind: scalar, type: object`。这不一定马上报错，但会让 UI hint / value mode 和后端领域语义不一致。

## 变更

- 更新 `app/utils/world-engine-preview.ts`：
  - `resolvePreviewAttrPath()` 遇到 `itemType: object` 时返回 `kind: object`。
  - 其他 `itemType` 仍按 scalar type 投影。
- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - Workbench object 行编辑器的临时字段 schema 同步采用相同规则。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 在“按手写嵌套 attr path 继承开放 object 的 itemType 投影”中增加 `deepMemory.first` 断言。
  - 确认 `deepMemory.first` 被解析为 `kind: object`，op 仍为 `set/unset`。

## 验证

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bunx vitest run "server/api/projects/world-engine/[...segments].test.ts" server/world-engine/world-engine.facade.test.ts
```

结果：2 个测试文件、42 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 前后端现在都把开放 object `itemType: object` 子路径视作 object 属性。
- `collectionRemove` object 项下拉仍使用 JSON 字符串作为 HTML select value，但提交路径会重新解析为 JSON object；本轮未改成复杂 value carrier，避免扩大组件事件契约。
- 没有自动做浏览器验证；真实浏览器用户流仍等待用户明确允许。

## 后续

- 浏览器验收时重点看 object collection 删除下拉是否易用：虽然行为可工作，但 JSON 字符串标签在复杂对象上可能不够友好，后续可考虑结构化 label 或预览摘要。
