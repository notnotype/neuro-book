# Round 101: Preview collectionRemove 当前状态候选下拉

## 背景

主 IDE Workbench 已经支持 `collectionRemove` 从当前 State Query 结果中生成已有项下拉。但独立 Preview 的 Mutation Builder 仍只能手写 value。第 100 轮刚让 Preview 与 Workbench 的默认 op/value 刷新规则对齐，本轮继续补齐 collection 删除辅助，避免两个入口体验分叉。

## 变更

- 更新 `WorldEnginePreviewMutationBuilder.vue`：
  - 接收 `stateResult`。
  - 复用 `collectionRemoveValueOptions()` 生成已有 collection 项候选。
  - 当 `builder.op === "collectionRemove"` 且候选项非空时，将 value 输入切换为下拉。
  - 候选项出现且当前 value 不匹配候选集合时，自动同步第一候选值。
- 更新 `WorldEnginePreviewActions.vue`：
  - 接收并传递 `stateResult`。
- 更新 `world-engine.preview.vue`：
  - 将 Preview 的 State Query 结果传给 Actions / Builder。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 Preview Actions 传递 `stateResult` 的契约断言。
  - 增加 Preview Mutation Builder 使用 `collectionRemoveValueOptions()`、`syncCollectionRemoveValue()` 和下拉提示文案的断言。

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

- 本轮只补齐独立 Preview 的前端输入辅助，不改变后端 API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- Preview 与 Workbench 都可以在查询状态后，通过下拉选择要移除的 collection 项。
- 没有自动做浏览器验证；真实浏览器验收仍需要用户确认后执行。

## 后续

- 下一步真实浏览器验收时，可同时覆盖独立 Preview 与主 IDE Workbench 的 collection 删除链路。
