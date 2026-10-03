# Round 366 - Slice Card Proposal Scroll Target

## 背景

Round 365 把 timeline slice card 的 `files N` 改成了主体文件建议入口：点击后会选中 slice 并打开右侧 Inspector。继续按作者流检查时，仍有一处小摩擦：`Subject file proposals` 区域在 Inspector 中段偏下，打开 Inspector 后作者可能还要在右栏里滚动寻找。

对于“我看到 files N，想处理六文件建议”这个意图，入口应该直接把作者带到建议区域。

## 本轮目标

- 点击 `files N` 后不仅打开 Inspector，还滚动到 `Subject file proposals` 区域。
- 真实 Workbench 和 mock Workbench 保持一致。
- 不改变 proposal 生成规则，也不自动写 `simulation/subjects` 六文件。

## 实现

- `WorldEngineWorkbenchPreviewSliceList.vue`
  - `openInspectorPanel` prop 增加可选目标参数：`subject-file-proposals`。
  - `openSubjectFileProposals()` 调用 `props.openInspectorPanel("subject-file-proposals")`。

- `WorldEngineWorkbenchDialog.vue`
  - 增加 `subjectFileProposalFocusVersion`。
  - `openInspectorPanel("subject-file-proposals")` 时递增该版本号。
  - 将版本号传给 Inspector。

- `world-engine.workbench-preview.vue`
  - mock 沙盘使用同样的版本号与目标参数。

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 增加 `subjectFileProposalFocusVersion` prop。
  - `Subject file proposals` section 增加 ref。
  - 版本号变化且当前存在 proposals 时，`nextTick()` 后调用 `scrollIntoView({block: "start"})`。

- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 增加静态契约断言，保护目标参数、版本号传递和 Inspector 滚动钩子。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 本轮继续处理作者流可发现性，没有新增后端/API 行为。
- 真实浏览器中滚动定位仍需要在后续浏览器验收清单里人工确认；本轮只用静态契约防止链路退化。
