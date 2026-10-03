# 2026-06-20 Mutation Value Editing

## Scope

本轮继续优化 `/world-engine.workbench-preview` mock 页面，不接真实 API，不改后端 DTO。重点让底部 `Mutation Editor` 从只读检查面板变成可以编辑 mutation value 的本地 mock 工作台。

## UX Finding

此前 Inspector 已能编辑 slice metadata，但 `Mutation Editor` 仍主要是查看器。用户在 subject 视图里能看到“此时状态”和“本切片变更”，却不能直接修正 mutation value，这会让底部面板看起来像占位的展示区，而不是可用的编辑区。

浏览器第一次复验后还发现：subject 视图的“本切片变更”区域在 1366 宽下过窄，`name` 被截成 `ame`，输入框和应用按钮也显得拥挤。因此本轮顺手调整了 subject 视图内部布局。

## Changes

- 新增 preview 专用 `WorldWorkbenchPreviewMutationValuePatch` 类型。
- `WorldEngineWorkbenchPreviewMutationEditor` 新增 mutation value 草稿：
  - subject 视图和总视图都可编辑 value。
  - 回车或点击 check 图标应用。
  - undo 图标还原当前草稿。
  - JSON-like 输入会尝试 `JSON.parse`；非法 JSON 显示局部错误，不污染 mock 数据。
- 页面层新增 `applyMutationValuePatch()`：
  - 更新当前 mock slice 的指定 mutation value。
  - 更新顶栏 notice。
  - 调用 `rebuildSnapshotsFromSlice()` 重算当前及后续 mock snapshots。
- mock snapshot 重算覆盖常用 op：
  - `set`
  - `unset`
  - `add`
  - `listAppend`
  - `collectionAdd`
  - `collectionRemove`
- subject 视图内部的“此时状态 / 本切片变更”双列延后到 `2xl`，1366 宽下改为纵向堆叠，保证 value 输入区足够宽。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- 浏览器 1366×768 复验：
  - 从首个 Slice Card 点击 `王都` 的“只看”按钮，进入单 subject timeline。
  - 在 Mutation Editor 中把 `capital.name` 从 `王都` 改成 `新王都` 并应用。
  - Slice Card、Mutation Editor、Inspector State Snapshot 均同步显示 `新王都`。
  - 顶栏 notice 显示 `已更新 mutation：capital.name`。
  - 页面 `scrollWidth` 保持 1366，无横向溢出。
  - value 输入框宽约 346px，视觉不再挤压。
- 非法 JSON 草稿复验：
  - 输入 `{broken` 并应用后，Editor 显示 `value 看起来像 JSON，但不是合法 JSON`。
  - Inspector 仍保持上一次合法值 `新王都`，没有写入坏数据。

## Plan Deviation

- 原计划只做 mutation value 编辑。浏览器复验时发现 subject 视图编辑列太窄，所以同步调整了布局断点和编辑行结构。这是同一条编辑体验的必要修复。
- mock snapshot 重算不是后端 reduce 的替代品，只用于预览页本地编辑反馈。后续接真实 API 时，这一层应替换为服务端 state/query 或 reduce 结果。

## Next Notes

- 现在 Mutation Editor 已经有真实编辑反馈。后续可以继续补更强的 schema-aware 控件，例如 bool 下拉、number stepper、ref subject picker、collection item picker。
- 当前编辑只修改 value，不修改 `subjectId / attr / op`。如果后续要把 Mutation Editor 做成完整编辑器，需要设计 row add/delete、attr picker 和 op 切换。
