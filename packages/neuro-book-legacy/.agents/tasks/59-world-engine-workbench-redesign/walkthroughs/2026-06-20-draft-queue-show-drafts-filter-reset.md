# 2026-06-20 Draft Queue Show Drafts Filter Reset

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- `Draft Queue` 中的单个草稿项已经会清掉阻挡目标的 search / kind / subject 过滤。
- 但队列顶部的 `查看草稿切片` 按钮此前只切换 `status=draft`，如果用户还保留搜索词或其它过滤，可能点完按钮仍看到空列表。
- 本轮把 `查看草稿切片` 改成完整草稿视角入口：清空 search / kind / subject 过滤，并切到 `status=draft`。

## Changes

- `WorldEngineWorkbenchPreviewSliceList`
  - 新增 `showDraftSlices()`。
  - `focusDraftQueueItem()` 复用 `showDraftSlices()`，避免队列项和队列顶部按钮行为分叉。
  - `查看草稿切片` 按钮从直接 `updateSliceHealthFilter('draft')` 改为调用 `showDraftSlices()`。
  - 按钮 title 改为 `清空 search / kind / subject 过滤，只看有未应用草稿的切片`。
- `world-engine-workbench-preview.test.ts`
  - 补充 `showDraftSlices` 与按钮 title 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 打开 `http://localhost:3000/world-engine.workbench-preview`。
  - `重置 mock` 后修改首个 slice title，生成 metadata draft。
  - 在 Slice List 搜索框输入 `zzzz-no-match`，列表进入“没有匹配当前条件的切片”空状态，但 Draft Queue 仍可见。
  - 点击 `查看草稿切片`。
  - 搜索框被清空，页面进入 `status drafts`，列表显示 1 张草稿 slice。
  - 浏览器日志无 warning / error。
  - 验证后执行 `重置 mock`，队列清空。

## UI/UX Notes

- 这次修正让 `查看草稿切片` 更符合用户预期：它不是“再叠一层 status 过滤”，而是“带我去所有草稿”。
- 具体草稿项和顶部按钮现在共用同一套过滤重置逻辑，后续行为更容易保持一致。
- 保留 `status=draft` 是为了让用户处理草稿后仍处在草稿工作流中。
