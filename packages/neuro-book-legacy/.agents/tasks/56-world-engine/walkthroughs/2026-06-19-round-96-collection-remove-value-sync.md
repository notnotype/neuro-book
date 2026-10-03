# Round 96: collectionRemove 下拉 value 自动同步

## 背景

第九十五轮让 `collectionRemove` 可以从当前 State Query 结果生成已有项下拉。继续审查这条交互链时发现一个细节：如果下拉候选出现时 `builder.value` 仍是旧值或空值，浏览器可能视觉上显示第一项，但父级 Builder 数据还没有同步成第一项。

这会造成用户以为已经选中了要删除的 collection 项，实际提交时却仍提交旧 value。

## 变更

- 更新 `WorldEngineMutationBuilder.vue`：
  - 引入 `watch` 监听 `collectionValueOptions`。
  - 新增 `syncCollectionRemoveValue()`。
  - 当 `builder.op === "collectionRemove"`、候选项非空、当前 `builder.value` 不在候选集合里时，自动 emit `update-builder-field("value", firstOption.value)`。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `syncCollectionRemoveValue` 契约断言。
- 更新任务 README 与 `PROJECT-STATUS.md`：
  - 记录第九十六轮 value 自动同步。

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

- 本轮只修复前端 Builder 的值同步问题，不改变 World Engine 后端 API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- 下拉显示项与实际 Builder value 会保持一致，降低 collectionRemove 误提交旧值的风险。
- 没有自动做浏览器验证；真实浏览器验收仍需要用户确认后执行。

## 后续

- 后续浏览器验收应重点确认：State Query 出现 inventory 后，切到 Edit，选择 `collectionRemove` 时 value 自动填入 `subject://old-sword`。
