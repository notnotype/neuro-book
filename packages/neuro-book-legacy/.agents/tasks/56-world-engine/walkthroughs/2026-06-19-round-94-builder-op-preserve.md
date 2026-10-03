# Round 94: Builder 默认 value 刷新保留用户选择的 op

## 背景

继续审查主 IDE Workbench Mutation Builder 时发现一个交互问题：`collection` 属性会提供 `collectionAdd` 与 `collectionRemove` 两个 op，但 `refreshBuilderDefaultValue()` 复用了 `defaultMutationForPreviewAttr()`，在刷新默认 value 的同时也会把 `mutationBuilder.op` 写回 schema 默认 op。

这会导致用户手动选择 `collectionRemove` 后，后续默认值刷新链路可能把它重置回 `collectionAdd`，表现为“remove 选项弹回 add”。

## 变更

- 更新 `world-engine-preview.ts`：
  - 导出 `defaultValueForPreviewAttr()`，用于只推导 mutation value 默认值，不决定 mutation op。
- 更新 `WorldEngineMutationEditor.vue`：
  - `refreshBuilderDefaultValue()` 改为使用 `defaultValueForPreviewAttr()`。
  - schema shortcut 仍使用 `defaultMutationForPreviewAttr()`，继续负责一键填入默认 op。
  - object field 默认值也改为 value-only helper。
  - `WorldEngineMutationEditor.vue` 当前为 796 行，仍低于 800 行约束。
- 更新测试：
  - `world-engine-preview.test.ts` 增加 `defaultValueForPreviewAttr()` 对 `collection itemType=ref(item)` 的默认值断言。
  - `world-engine-ide-entry.test.ts` 增加 Editor 使用 value-only helper 的契约断言。

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

- 本轮只修复前端 Builder 的默认值刷新逻辑，不改变 World Engine API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- `collectionRemove` 这类用户手动选择的合法 op 不再被默认值刷新链路覆盖。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- 后续浏览器验收时需要重点试一次 collection：添加 item、再删除 item，并确认 Builder op 选择不会跳回默认值。
