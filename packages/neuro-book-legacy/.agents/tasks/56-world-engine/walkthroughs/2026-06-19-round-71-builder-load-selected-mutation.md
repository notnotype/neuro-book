# Round 71: Builder 选择载入 mutation

## 背景

第七十轮补了“载入首条 mutation”，解决了 Builder 只能单向生成 JSON 的问题。但真实 slice 往往包含多条 mutation，只能载入首条仍然会让用户在编辑第二条、第三条时回到手写 JSON。

本轮把入口升级为“选择并载入”：用户可以在 Builder 顶部选择 `#N subject.attr op`，再把对应 mutation 回填到 Builder 表单。

## 变更

- 更新 `WorldEngineMutationBuilder.vue`：
  - 顶部新增 mutation 下拉选择。
  - 载入按钮从“载入首条”改为“载入”。
  - 事件从 `load-first-mutation` 调整为 `load-mutation(index)`。
  - 增加 `update-mutation-load-index` 事件，父组件继续持有当前选择。
- 更新 `WorldEngineMutationEditor.vue`：
  - 新增 `mutationLoadIndex`。
  - 新增 `mutationLoadOptions`，从当前 `sliceForm.mutations` 解析出 `#N subject.attr op` 选项。
  - 将 `loadFirstMutationToBuilder()` 改为 `loadMutationToBuilder(index)`。
  - 载入成功提示显示实际载入的 mutation 序号。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `mutationLoadOptions`、`updateMutationLoadIndex`、`loadMutationToBuilder`、`load-mutation` 等契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮仍不改变后端 API、slice 保存格式或 re-settle 语义。
- Builder 可以从当前 JSON 的任意一条 mutation 回填，编辑多 mutation slice 时不再被锁死在首条。
- 当前仍是“载入到 Builder 后再追加 / 替换整组 JSON”的模式，尚未提供“原位替换第 N 条 mutation”。如果后续要进一步减少手写 JSON，应设计 mutation list 的逐条编辑语义。

## 后续

- 可继续增加“替换所选 mutation”按钮，把 Builder 表单结果写回原索引。
- 主 IDE Workbench 仍需要用户确认后做浏览器实测，覆盖真实 Project 的创建、写入、编辑、re-settle 和查询流程。
