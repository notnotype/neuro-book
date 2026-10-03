# 2026-06-20 Metadata Draft Preview

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上轮新增统一 `Draft Queue` 后，metadata 草稿可以被找回，但主画布仍主要显示已应用的旧标题，用户只能依赖 `meta draft` 判断“这里有改动”。
- 本轮把 metadata 草稿预览投射到 Slice List / Slice Card，让用户在主画布直接看到未应用的 `time / title / summary / kind`。

## Changes

- `WorldWorkbenchPreviewMetadataDraftSummary`
  - 从只包含 `sliceId / sliceTitle` 扩展为携带 `draftTime / draftTitle / draftSummary / draftKind`。
  - summary 只承载草稿预览；已应用原值仍由 `slice` 本体提供，避免 Inspector 为非当前 slice 填半真原值。
- `WorldEngineWorkbenchPreviewInspector`
  - `metadataDraftSummaries` 上报当前 slice 和跨 slice 暂存草稿的完整 metadata draft preview。
- `WorldEngineWorkbenchPreviewSliceList`
  - 新增 `metadataDraftSummaryMap`。
  - `Draft Queue` 队列项优先显示 metadata 草稿后的 `time / title / kind`，并加 `preview` 标签。
  - Slice Card 接收对应 `metadataDraftSummary`。
- `WorldEngineWorkbenchPreviewSliceCard`
  - 有 metadata draft 时，卡片左侧显示 `draft preview` 和变更字段摘要。
  - 卡片标题、摘要、time、kind 优先显示草稿值。
  - 卡片标题下保留一行 `已应用：...`，让用户能区分草稿态和当前已应用状态。
- `world-engine-workbench-preview.test.ts`
  - 补充 metadata draft preview 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 打开 `http://localhost:3000/world-engine.workbench-preview`。
  - `重置 mock` 后修改首个 slice title，制造 metadata 草稿。
  - Slice List 顶部 `Draft Queue` 出现，队列项显示草稿后的标题，并带 `meta preview`。
  - Slice Card 显示 `draft preview · title`，主标题显示草稿标题，下面显示 `已应用：世界初始化：雨城进入持续暴雨`。
  - 浏览器日志无 warning / error。
  - 验证后已执行 `重置 mock`，清空浏览器临时草稿。

## UI/UX Notes

- 这次补的是“找得到草稿之后，看得懂草稿内容”的一环。
- `meta draft` 仍作为状态徽标存在；`draft preview` 则说明卡片上展示的是未应用预览值。
- Draft Queue 和 Slice Card 都只负责发现和预览，不负责提交；应用和还原仍在 Inspector 中完成。
- 浏览器自动化里输入框选择文本没有完全替换旧值，而是追加了测试标题；这不影响验证目标，因为 UI 已确认队列和卡片会实时显示 metadata draft title preview。后续若要做更细的表单输入自动化，可改用更稳定的测试入口。
