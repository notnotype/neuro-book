# Round 360 - Save Proposal Focus Alignment

## 背景

Round 357-359 补强了保存后发现主体文件建议的路径：保存提示、Inspector 顶栏徽标和隐藏时恢复入口。但代码审查时发现一个语境不一致风险：

- 保存提示使用 `payload.contextSubjectId` 计算 proposal 数量。
- 真实 Inspector 使用父层 `focusedSubjectId` 生成 proposal。
- 普通保存 `world.events` slice 时，刷新后的 `alignFocusedSubject()` 可能把 `focusedSubjectId` 切回 `world`。

这样会出现“顶部提示有主体文件建议，但右侧 Inspector 实际看不到对应角色建议”的作者流断裂。

## 本轮目标

- 让保存提示里的 proposal context 与 Inspector 实际 focused subject 对齐。
- 只在确实存在 proposal 时调整 focused subject，避免无条件改变作者焦点。
- 不自动写 `simulation/subjects` 六文件。

## 实现

- `WorldEngineWorkbenchDialog.vue`
  - 在 Slice Composer 保存后刷新 timeline，再找到保存后的真实 slice。
  - 使用 `proposalContextSubjectId = payload.contextSubjectId || focusedSubjectId.value` 计算 proposal 数量。
  - 如果 proposal 数量大于 0，且该 context subject 是已注册 World Engine subject，就把 `focusedSubjectId` 对齐到 `proposalContextSubjectId`。
  - 然后再显示 `可在右侧 Inspector 查看 N 个主体文件建议`。

- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，保护保存回流中的 `proposalContextSubjectId` 和 focused subject 对齐。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 本轮不是继续增加 UI，而是修复刚补出的提示链路和右栏实际内容之间的语境一致性。
- P0 边界不变：只展示 / 复制 / 打开主体文件建议，不自动写六文件。
