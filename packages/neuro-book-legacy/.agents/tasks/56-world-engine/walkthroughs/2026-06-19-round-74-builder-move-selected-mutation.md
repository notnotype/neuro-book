# Round 74: Builder 上移 / 下移所选 mutation

## 背景

第七十三轮后，Workbench Mutation Builder 已具备多 mutation slice 的基础增、改、删能力。由于 slice 内 mutation 的 `seq` 顺序会影响同一切面内的 reduce 顺序，用户还需要能调整 mutation 顺序。

本轮补“上移 / 下移所选 mutation”，让 Builder 覆盖基础列表编辑能力。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - 新增 `moveSelectedBuilderMutation(direction)`。
  - 按当前 `mutationLoadIndex` 上移或下移一位。
  - 移动后同步更新 `mutationLoadIndex` 到新位置，便于连续移动。
  - 已在最上 / 最下时给出 notice，不改变 JSON。
  - 首次实现用数组解构交换，`typecheck` 报出数组元素可能为 `undefined`；已改为显式读取并防御判断后再赋值。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 在 mutation 选择区旁增加上移 / 下移图标按钮。
  - 新增 `move-selected-mutation` 事件。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `moveSelectedBuilderMutation`、`move-selected-mutation`、`上移所选 mutation`、`下移所选 mutation` 的契约断言。

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
- Builder 现在覆盖多 mutation slice 的基础列表编辑：追加、替换全部、选择载入、替换所选、删除所选、上移 / 下移所选。
- 浏览器验证仍未执行；按照项目规则，主 IDE Workbench 的真实用户流程实测需要用户确认后再跑。

## 后续

- 若继续扩展列表编辑，可考虑把 mutation list 操作区从 `WorldEngineMutationBuilder` 再拆成子组件，避免 Builder 文件持续变厚。
- 主 IDE Workbench 仍需要浏览器实测：新建 Project、创建 subject、写入多 mutation slice、调整 mutation 顺序、保存、re-settle 和查询状态。
