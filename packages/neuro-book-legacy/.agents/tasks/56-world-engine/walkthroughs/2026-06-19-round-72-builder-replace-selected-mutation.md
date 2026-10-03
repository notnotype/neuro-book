# Round 72: Builder 替换所选 mutation

## 背景

第七十一轮已经能从当前 mutations JSON 中选择任意一条 mutation 回填到 Builder。但回填后，用户只能“追加”或“替换全部”，还不能把修改后的 Builder 内容写回原来的 mutation 索引。

本轮补齐逐条编辑闭环：选择 mutation → 载入 Builder → 修改表单 → 替换所选 mutation。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - 将 Builder 表单到 `WorldMutationDraft` 的构造逻辑抽成 `buildMutationFromBuilder()`。
  - `addBuilderMutation()` 复用统一构造逻辑，继续支持追加和替换全部。
  - 新增 `replaceSelectedBuilderMutation()`，按 `mutationLoadIndex` 原位替换当前 mutations JSON 中的目标 mutation。
  - 替换成功后保留其他 mutation 不变，并提示实际替换的序号。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 新增“替换所选”按钮。
  - 将原“替换”按钮文案调整为“替换全部”，避免和原位替换混淆。
  - 新增 `replace-selected-mutation` 事件。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `buildMutationFromBuilder`、`replaceSelectedBuilderMutation`、`replace-selected-mutation`、`替换所选`、`替换全部` 的契约断言。

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
- Builder 对多 mutation slice 的编辑体验更完整：不再只能把修改后的 mutation 追加到末尾或覆盖整组。
- 仍未做浏览器验证；按照项目规则，主 IDE Workbench 的真实用户流程实测需要用户确认后再执行。

## 后续

- 可以继续补删除所选 mutation、上移/下移 mutation 等列表级编辑能力。
- 主 IDE Workbench 仍需要浏览器实测：新建 Project、创建 subject、写入多 mutation slice、载入并替换某条 mutation、保存 slice、触发 re-settle 和查询状态。
