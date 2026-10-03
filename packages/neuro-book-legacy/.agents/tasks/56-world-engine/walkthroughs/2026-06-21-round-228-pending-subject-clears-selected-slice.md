# Round 228: Pending subject clears selected slice

## Summary

Round 227 已经让左栏选择待接入 subject 时显示同步提示。但继续沿作者视角检查发现：如果待接入 subject 没有 World Engine 身份，`sliceSubjectFilterQuery()` 不会向服务端发送 subject filter，真实 Workbench 会重新拿到完整 timeline。随后 `applyDefaults()` 可能保留旧的 `selectedSliceId`。

结果是：中间 Slice List 因本地 subject filter 显示空状态，但右侧 Inspector 仍展示上一条旧 slice。作者会看到两个互相打架的信号：左侧选的是待接入 subject，中间说没有切片，右侧却还在讲旧切片。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `updateSelectedSubjectIdsForTimeline()` 同时计算本次选择中的已注册 subject。
  - 当本次 subject 过滤非空、且没有任何已注册 World Engine subject 时，timeline reload 后清空 `selectedSliceId`。
  - 这样待接入-only 视角下，Inspector / 审查工作台不会继续展示旧 slice。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，固定待接入-only subject 过滤会清空旧 slice 选择。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - passed：1 file, 3 tests.
- `bun run typecheck`
  - passed.

## Notes

- 本轮不改变后端/API；待接入 subject 未注册前仍没有 World Engine timeline。
- 本轮没有自动执行浏览器验证。后续获准实跑时，应覆盖：先选一个已注册 subject / slice，再选待接入 subject，确认右侧 Inspector 不再残留旧切片。
- 实际计划与结果的出入：原本以为 Round 227 的顶部提示足够；读完整个 selection / reload 链路后发现旧 selected slice 仍会制造混乱，因此补了这一小步。
