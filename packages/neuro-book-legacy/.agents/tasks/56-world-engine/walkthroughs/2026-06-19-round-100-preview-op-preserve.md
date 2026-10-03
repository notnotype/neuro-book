# Round 100: Preview Builder 默认 value 刷新保留用户选择的 op

## 背景

第九十四轮已经修复主 IDE Workbench：Builder 刷新默认 value 时不再覆盖用户手动选择的合法 op。但继续对照独立 Preview 时发现同类逻辑仍然存在：

`refreshBuilderDefaults()` 使用 `defaultMutationForPreviewAttr()`，会在刷新 value 的同时把 `mutationBuilder.op` 重置为 schema 默认 op。这意味着 Preview 中用户手动选择 `collectionRemove` 后，subject / attr 刷新链路仍可能把它改回 `collectionAdd`。

## 变更

- 更新 `world-engine.preview.vue`：
  - 引入 `defaultValueForPreviewAttr()`。
  - `refreshBuilderDefaults()` 改为只刷新 value，不再写入 `mutationBuilder.op`。
  - schema shortcut 的 `fillMutation()` 仍使用 `defaultMutationForPreviewAttr()`，继续负责默认 op。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 Preview 页面使用 `defaultValueForPreviewAttr` 的契约断言。
- 更新任务 README 与 `PROJECT-STATUS.md`：
  - 记录 Preview 与 Workbench Builder 行为对齐。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮只修复独立 Preview 的前端 Builder 默认值刷新逻辑，不改变后端 API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- Workbench 与 Preview 在“schema shortcut 决定默认 op，普通刷新只更新 value”的规则上对齐。
- 没有自动做浏览器验证；真实浏览器验收仍需要用户确认后执行。

## 后续

- 后续真实浏览器验收时，应同时覆盖主 IDE Workbench 和独立 Preview 的 `collectionRemove` op 是否稳定。
