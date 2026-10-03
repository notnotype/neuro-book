# Round 70: Builder 载入首条 mutation

## 背景

第六十九轮把 Workbench Mutation Builder 拆成了独立组件，但审查时发现一个编辑体验缺口：Builder 只能单向生成 mutations JSON。用户编辑已有 slice 时，JSON 里已经有 mutation，却不能把某条 mutation 回填到 Builder 表单继续改，只能手写 JSON 或重新从 schema shortcut 开始。

本轮先补一个最小入口：从当前 mutations JSON 载入首条 mutation 到 Builder。后续如果需要，可以再扩展为选择任意一条 mutation。

## 变更

- 更新 `WorldEngineMutationBuilder.vue`：
  - 在 Builder 顶部增加“载入首条”按钮。
  - 点击后向父组件发送 `load-first-mutation` 事件。
  - 清理上一轮残留但未使用的 `sync-object-rows` 事件。
- 更新 `WorldEngineMutationEditor.vue`：
  - 新增 `loadFirstMutationToBuilder()`。
  - 解析当前 `sliceForm.mutations`。
  - 将首条 mutation 的 `subjectId`、`attr`、`op`、`value` 回填到 Builder。
  - 对非法 JSON 或空 mutations 给出局部错误提示。
  - 对 object value 继续复用既有 `syncObjectRowsFromBuilderValue()`，保证开放 object / 固定 fields 表单跟随回填。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `loadFirstMutationToBuilder`、`load-first-mutation` 和“载入首条”的契约断言。

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
- Builder 仍然不是 mutations JSON 的唯一编辑入口；它现在能从 JSON 首条 mutation 回填，降低编辑旧 slice 时的手写成本。
- 当前只支持载入首条 mutation。若用户需要编辑多条 mutation，后续应做 mutation 列表选择或逐条表单编辑。

## 后续

- 可以继续把“载入首条”升级为“选择并载入第 N 条 mutation”。
- 主 IDE Workbench 仍需要用户确认后做浏览器实测，覆盖新建 Project、写 slice、编辑旧 slice、显式 re-settle 和状态查询。
