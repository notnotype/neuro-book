# 2026-06-20 Mock Reducer Refactor

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 mock 编辑底座，不接真实 API，不改后端 DTO。重点修正上一轮 mutation value 编辑后，页面内联 mock reducer 过重且在第一张 slice 上可能重复应用相对 mutation 的问题。

## Finding

上一轮为了让 Mutation Editor value 编辑能同步右侧 State Snapshot，在 route 页面内加入了轻量 snapshot 重算。代码巡检时发现两个问题：

- route 页面承担了过多 reducer 细节，不利于未来替换成真实 API 或更完整 mock 数据接口。
- 旧重算逻辑在从第一张 slice 开始重算时，会以已经 reduce 后的第一张 snapshot 为 base，再应用第一张 slice 的 mutations。`set` 不明显，但 `add / listAppend / collectionAdd` 这类相对操作可能被重复叠加。

## Changes

- 新增 `app/utils/world-engine-workbench-preview-state.ts`。
- 抽出 `applyWorkbenchPreviewMutationPatch()`：
  - 输入当前 slices、subjects、schema 和 mutation value patch。
  - 返回更新后的 slices、snapshots 和 notice label。
- 抽出 `reduceWorkbenchPreviewSnapshots()`：
  - 从 subject 身份和 schema default 构造初始状态。
  - 再按 slice 顺序逐步应用 mutations。
  - 每个 slice 产出一个 reduce 后的 snapshot。
- route 页面删除内联 attr path / collection / snapshot reducer，只保留事件编排。
- 目标测试补充新 util 的静态契约检查。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`

## Browser Verification

- 本轮尝试用浏览器重新验证 `capital.name` 编辑链路。
- 页面 DOM 内容已渲染出 Workbench，但自动化点击在 HMR 后出现短时 timeout，日志里也混有上一轮旧 prop 警告。
- 因此本轮不把浏览器点击链路记为通过，只记录为“尝试但不稳定”。上一轮同一编辑路径已经完成过干净浏览器验证；本轮的行为重构由 typecheck 和目标 vitest 覆盖。

## Plan Deviation

- 原本只是整理页面代码；巡检时发现第一张 slice 的相对 mutation 重算隐患，所以将 reducer 改成从 schema default + subject 身份重新 reduce 全部 slices。

## Next Notes

- 后续可以为 `reduceWorkbenchPreviewSnapshots()` 增加真实行为单测，不只做静态契约检查。
- 如果继续扩展 mock 编辑器，建议让 value parser / reducer / UI 行编辑拆成更小的 preview 专用模块，避免 Mutation Editor 继续膨胀。
