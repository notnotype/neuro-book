# Round 73: Builder 删除所选 mutation

## 背景

第七十二轮补齐了“选择 mutation → 载入 Builder → 修改 → 替换所选”的逐条编辑闭环。多 mutation slice 的基础编辑还缺一个常用动作：删除某条 mutation。

本轮补“删除所选”，让 Workbench Mutation Builder 具备基础的增、改、删能力。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - 新增 `deleteSelectedBuilderMutation()`。
  - 解析当前 `sliceForm.mutations`，按 `mutationLoadIndex` 删除目标 mutation。
  - 删除后自动把选中索引夹到剩余列表范围内。
  - 若删除最后一条 mutation，会保留空数组并提示“保存前请先添加新的 mutation”。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 新增“删除所选”按钮。
  - 新增 `delete-selected-mutation` 事件。
  - 底部 Builder 操作按钮区改为可换行，避免“追加 / 替换所选 / 删除所选 / 替换全部”在较窄宽度下挤出容器。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `deleteSelectedBuilderMutation`、`delete-selected-mutation` 和“删除所选”的契约断言。

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

- 本轮不改变后端 API、slice 保存格式或 re-settle 语义。
- 删除最后一条 mutation 后，前端允许暂时得到 `[]` 方便继续编辑；保存时后端仍会按既有契约拒绝空 mutations。
- Workbench Builder 现在覆盖多 mutation slice 的基础增、改、删，但仍未做拖拽排序 / 上移下移。

## 后续

- 可以补“上移 / 下移所选 mutation”，让 slice 内 mutation 顺序更容易维护。
- 主 IDE Workbench 仍需要用户确认后做浏览器实测，覆盖真实 Project 的创建、写入、编辑、删除 mutation、保存、re-settle 和状态查询。
