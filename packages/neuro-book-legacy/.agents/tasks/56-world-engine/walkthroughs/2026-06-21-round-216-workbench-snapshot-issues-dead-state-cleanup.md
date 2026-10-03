# Round 216 - Workbench Snapshot Issues Dead State Cleanup

## 背景

Round 215 把主 Workbench 的当前 State Snapshot issues 和完整世界 issues 接回 Inspector。继续检查底部审查工作台时发现，`WorldEngineWorkbenchDialog.vue` 里还保留了 `previousSnapshotIssues`：它会被赋值和清空，但没有传给任何组件，也不会在 UI 中展示。

这会制造错误心智：阅读代码的人会以为“前一切片状态 issues 已经进入审查工作台”，但实际作者只能看到当前 snapshot issues 与完整 state issues。

## 本轮调整

- 删除 `previousSnapshotIssues` ref。
- 删除加载 snapshot 时对 `previousResult.issues` 的赋值。
- 删除各个重置路径中的 `previousSnapshotIssues.value = []`。
- 保持 `previousSnapshotSubjects` 不变；底部审查工作台仍继续使用前态 subjects 展示 before / after。

## 验证

- `rg -n "previousSnapshotIssues" app/components/novel-ide/world-engine app/utils/world-engine-ide-entry.test.ts`
  - 源码与测试入口无匹配；文档本身保留该词用于记录本轮清理。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 3 个测试通过。
- `bun run typecheck`
  - 通过。

## 后续

- 如果后续要在审查工作台展示“前态 issues / 后态 issues”对比，应作为一个明确 UI 需求重新接线，而不是保留未使用状态。
