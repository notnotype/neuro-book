# Round 217 - Workbench Review Issue Focus

## 背景

继续沿着作者真实使用路径检查：当作者在 Review Queue 或 Slice Card 上看到 issue 后，下一步通常是点击 issue 去看对应切片和 subject。此前 `focusReviewIssue()` 直接把 `selectedSliceId` 设置为 `item.sliceId`，没有先确认该 slice 是否存在于当前已加载 timeline，也不会清理可能遮挡目标的 search / kind / status / subject 过滤。

这会导致两类卡手：

- issue 指向的 slice 当前不在最近 200 条已加载结果里时，选中态会指向一个不存在的 slice，主画布可能看起来“没有反应”。
- issue 所属 slice 存在，但当前过滤条件遮挡目标时，作者点击 issue 后仍可能看不到目标 slice。

## 本轮调整

- `focusReviewIssue()` 先检查 `slices.value` 里是否存在目标 slice。
- 目标 slice 不存在时，不再修改 `selectedSliceId`；改为提示 `Issue 所属 slice ... 当前未加载，无法定位到时间线。`，同时保留 subject / attr focus 供当前上下文参考。
- 目标 slice 存在时，清空 `sliceSearch`、`sliceKindFilter`、`sliceHealthFilter`，并把 subject 过滤切到当前 issue 的 subject，确保时间线能显示目标。
- 底部审查工作台继续自动展开并高亮对应 attr。
- 静态契约测试补充上述定位保护，避免退回到“盲设 selectedSliceId”的行为。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 3 个测试通过。
- `bun run typecheck`
  - 通过。

本轮未自动执行浏览器验证。

## 后续

- 如果作者频繁遇到 “issue 所属 slice 当前未加载”，说明最近 200 条前端加载策略不够，需要回到 API 设计，给 `GET /slices` 增加按 `subjectIds` / issue slice id 定位的查询能力。
