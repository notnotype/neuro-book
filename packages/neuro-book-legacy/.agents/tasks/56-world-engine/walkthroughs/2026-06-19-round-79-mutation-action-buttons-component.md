# Round 79: Mutation Action Buttons 组件拆分

## 背景

第七十八轮已经把 Builder 顶部 mutation 列表选择 / 载入 / 上移 / 下移控制条抽成 `WorldEngineMutationListControls`。继续审查 `WorldEngineMutationBuilder.vue` 时，底部“追加 / 替换所选 / 删除所选 / 替换全部”仍然是独立动作区，适合拆成更小的展示组件。

本轮目标是降低 Builder UI 体量，不改变 mutation JSON、保存流程、re-settle 契约或用户可见行为。

## 变更

- 新增 `WorldEngineMutationActionButtons.vue`：
  - 接收 `canUseSelectedMutation`，控制“替换所选 / 删除所选”的禁用状态。
  - 负责渲染追加、替换所选、删除所选、替换全部四个按钮。
  - 向上发出 `add-mutation`、`replace-selected-mutation`、`delete-selected-mutation`。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 引入 `WorldEngineMutationActionButtons`。
  - 删除内联底部按钮模板。
  - 继续向父编辑器转发原有事件，父层无需改动。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加新组件读取与契约断言。
  - 将底部动作按钮文案和事件断言迁移到新组件。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、16 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮是纯组件拆分，不改变 Workbench 行为。
- Builder 现在主要承载 schema-aware 表单与 object value / fixed fields 输入区；mutation 列表控制和底部动作按钮都已有单独组件落点。
- 主 IDE Workbench 仍未做浏览器真实验收；按照项目规则，需要用户确认后再执行。

## 后续

- 如果 Builder 继续增长，优先考虑拆 object value / fixed fields 输入区。
- 主 IDE Workbench 需要浏览器实测真实 Project 的多 mutation 写入、编辑、移动、删除、保存和 re-settle。
