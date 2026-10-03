# Round 86: Workbench Mutation Builder value 类型提示

## 背景

独立 Preview 已经显示当前 mutation value 的类型提示，例如 `list<ref(location)>`、`collection<ref(item)>`。主 IDE Workbench 的 Builder 虽然已经按 schema 切换 number / boolean / enum / ref / object 等输入控件，但标题区域没有明确展示当前 value 类型。

这会让用户在写 `listAppend` / `collectionAdd` 时缺少一个快速确认：当前输入的是 list item 还是 collection item、是普通文本还是 `ref(item)`。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - 增加 `builderValueHint` 计算属性。
  - 复用 `previewAttrValueType()`，保持 list / collection 优先 `itemType` 的规则。
  - hint 格式与 Preview 对齐：`list<text>`、`collection<ref(item)>`、`scalar:int`，未知 attr 显示 `dynamic value`。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 新增 `builderValueHint` prop。
  - 在 Builder 标题旁显示一个小型 monospace 类型提示。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 Workbench Editor / Builder 的 value hint 契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、16 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮只增加 UI 类型提示，不改变 mutation JSON、保存 API、schema 投影或 re-settle 语义。
- Workbench 和 Preview 的 `itemType` 可见性现在对齐，降低 list / collection value 输入时的心智负担。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- Workbench 的 list / collection 专用输入还可以继续增强，例如集合项模板、批量添加、collectionRemove 的现有值辅助选择。
- 主 IDE Workbench 浏览器实测仍是下一阶段关键验证。
