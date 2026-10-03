# Round 75: Builder mutation 选择索引同步

## 背景

第七十四轮后，Builder 已覆盖多 mutation slice 的基础列表编辑能力：追加、替换全部、选择载入、替换所选、删除所选、上移 / 下移所选。审查时发现一个交互一致性问题：某些操作会重写 `sliceForm.mutations`，但 `mutationLoadIndex` 不一定跟随用户刚操作的 mutation。

例如追加后，列表里已经多了一条新 mutation，但选择下拉仍可能停在旧索引；后续点击“载入 / 替换所选 / 删除所选”时，用户需要额外确认当前选中项。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - 载入 slice 后将 `mutationLoadIndex` 重置为 `0`。
  - 新建模式、schema shortcut、subject 切换生成默认 mutations 后，将 `mutationLoadIndex` 重置为 `0`。
  - Builder “追加”后自动选中新追加的 mutation。
  - Builder “替换全部”后自动选中第 1 条 mutation。
  - 增加 watcher：当用户手写 JSON 或其他操作导致 `mutationLoadOptions` 长度变短时，把 `mutationLoadIndex` 自动夹回有效范围；列表为空时重置为 `0`。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加索引同步与 `mutationLoadOptions.value.length` watcher 的契约断言。

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
- Builder 的选择状态更贴近用户刚完成的动作，降低误操作所选 mutation 的概率。
- 浏览器验证仍未执行；按照项目规则，主 IDE Workbench 的真实用户流程实测需要用户确认后再跑。

## 后续

- 若继续增强多 mutation 编辑，应考虑把选择、移动、替换、删除这组列表操作拆成独立子组件。
- 主 IDE Workbench 仍需要浏览器实测，覆盖多 mutation slice 的追加、移动、替换、删除和保存流程。
