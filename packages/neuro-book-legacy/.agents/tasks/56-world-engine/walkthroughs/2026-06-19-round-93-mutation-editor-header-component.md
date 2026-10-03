# Round 93: Mutation Editor Header 组件拆分

## 背景

继续审查主 IDE Workbench 时发现 `WorldEngineMutationEditor.vue` 已增长到 816 行，超过项目「单文件组件不要超过 800 行」的约束。该文件顶部的标题、载入按钮、编辑模式提示和 dirty guard 提示是纯 UI 区域，适合先拆出独立组件，避免继续把交互外壳堆在父编辑器里。

## 变更

- 新增 `WorldEngineMutationEditorHeader.vue`：
  - 承载 `Edit Timeline` 标题、说明文字、`载入所选 Slice`、`新建模式`、当前编辑 slice 提示和 dirty guard 提示。
  - 通过 `load-selected-slice`、`clear-edit-mode`、`discard-draft-and-load-selected-slice` 事件回传操作。
- 更新 `WorldEngineMutationEditor.vue`：
  - 引入 `WorldEngineMutationEditorHeader`。
  - 父组件继续保留保存、载入、dirty guard 状态和业务函数。
  - 文件体量从 816 行降到 797 行。
- 更新 `world-engine-ide-entry.test.ts`：
  - 纳入 `WorldEngineMutationEditorHeader.vue` 读取。
  - 断言新组件保留关键文案和事件名。
  - 断言父编辑器实际接入 `WorldEngineMutationEditorHeader`。
- 更新任务 README 与 `PROJECT-STATUS.md`，记录第九十三轮拆分。

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

- 本轮是组件边界拆分，不改变 World Engine HTTP API、Project SQLite schema、Agent 工具、mutation 语义或 re-settle 行为。
- 父编辑器仍是状态和行为的归属，新组件只负责展示与事件转发。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- 如果 Mutation Editor 后续继续增长，优先拆分表单主体或右侧 schema shortcut 区域。
- 下一阶段仍建议转向真实浏览器验收，确认主 IDE Workbench 在完整用户流里足够顺手。
