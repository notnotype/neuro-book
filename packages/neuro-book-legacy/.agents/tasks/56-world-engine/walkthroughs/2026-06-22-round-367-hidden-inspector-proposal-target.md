# Round 367 - Hidden Inspector Proposal Target

## 背景

Round 366 让 timeline slice card 的 `files N` 入口可以打开 Inspector 并滚到 `Subject file proposals`。继续检查隐藏 Inspector 的作者流时发现：顶栏 Inspector 按钮和右侧恢复 rail 已经能显示当前 slice 的主体文件建议数量，但点击时仍只是普通展开右栏，没有复用 `subject-file-proposals` 目标。

这会让隐藏 Inspector 状态下的 proposal 数量入口和 slice card 入口行为不一致。

## 本轮目标

- 隐藏 Inspector 时，顶栏 Inspector 按钮也能直达 `Subject file proposals`。
- 右侧恢复 rail 也使用同一目标打开行为。
- mock `/world-engine.workbench-preview` 与真实 Workbench 保持一致。
- 不改变 proposal 生成规则，不自动写 `simulation/subjects` 六文件。

## 实现

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `toggleInspectorPanel()`。
  - Inspector 已显示时点击会隐藏；隐藏时如果当前 slice 有主体文件建议，则调用 `openInspectorPanel("subject-file-proposals")`。
  - 顶栏 Inspector 按钮与右侧恢复 rail 都改用该函数。
  - 恢复 rail 按钮 title 在有建议时显示“展开检查器并定位主体文件建议”。

- `world-engine.workbench-preview.vue`
  - 引入 `buildWorldWorkbenchSubjectFileProposals()`，为 mock 当前 slice 计算 proposal 数量。
  - 补齐 `selectedSliceSubjectFileProposalCount`、`inspectorButtonAttentionClass`、proposal count badge 和恢复 rail 数量徽标。
  - 顶栏 Inspector 按钮与右侧恢复 rail 同样复用 `toggleInspectorPanel()`。

- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 更新静态契约断言，保护隐藏入口走 `subject-file-proposals` 目标打开链路。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 本轮继续处理作者流里的入口一致性，没有新增后端/API 行为。
- mock preview 额外补齐了隐藏 Inspector 状态下的 proposal 数量徽标，使沙盘和真实 Workbench 的入口一致。
