# Round 226: Review issue subject timeline reload

## Summary

继续沿“作者真的拿它写世界，第一个卡住的地方在哪”检查主 IDE Workbench 的 issue 审查路径。Round 222 以后，左栏 subject timeline 已经走服务端 `GET /slices?subjectIds=...&subjectMode=...`，但 Review Queue 点击 issue 时仍只是直接改 `selectedSubjectIds`，没有重新拉取对应 subject 的服务端 timeline。

这会造成一个假视角：UI 顶部和左栏看起来已经切到某个 subject，但中间 slices 仍可能是点击 issue 前的旧窗口，只额外混入一个按 `sliceId` 懒加载的目标切片。作者下一步想沿这个 subject 继续检查上下文时，会看到不完整或不一致的时间线。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `focusReviewIssue()` 在定位到目标 slice 后，会清空本地 search / kind / status 过滤，并切到 issue subject。
  - 随后调用 `reloadTimelineForCurrentSubjectFilter({ preferredSliceId, preferredSubjectIds })`，真正读取该 subject 的服务端 filtered timeline。
  - 如果目标 issue slice 不在服务端最近窗口中，会把已通过 `GET /slices/:sliceId` 懒加载的 `targetSlice` 再用 `mergeWorldWorkbenchTimelineSlice()` 合并回来，保证点击的 issue 仍可见。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补一条静态契约断言，钉住 Review Queue 点击 issue 后必须刷新 subject timeline，并保留目标 issue slice。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - passed：1 file, 3 tests.
- `bun run typecheck`
  - passed.

## Notes

- 本轮没有改后端/API，也没有扩大测试面。
- 本轮没有自动执行浏览器验证；如后续获准实跑，建议覆盖：在 Review Queue 点击一个 issue 后，左栏 subject 过滤、Slice List 可见内容、底部 Review Focus 是否都指向同一 subject / slice。
- 实际计划与结果的出入：原本检查的是“未加载 issue slice 的定位链路”，读代码后发现更关键的问题是点击 issue 后没有触发服务端 subject timeline reload；因此本轮修的是视角和数据源一致性。
