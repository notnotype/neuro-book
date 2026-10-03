# Round 329 - Slice Time Sort Key

## Context

从 busy guard 回到作者连续推演正路径时，继续检查 Slice Composer 的下一条默认时间。

主 Workbench 会把完整 timeline、subject filtered timeline、Review Queue 懒加载 slice 中发现的时间合并成 `knownSliceTimes`。这些时间来源不保证永远按真实时间从旧到新排列；如果下一条默认时间只依赖数组尾部，作者连续写 slice 时可能从较旧 instant 往后推，导致默认时间倒退或撞到已有 slice。

## Changes

- `world-engine-preview.ts`
  - `suggestNextPreviewTime()` 不再依赖 `usedTimes` 的传入顺序尾项。
  - 新增前端轻量排序：默认数字历 `...年 ...月...日 HH:mm:ss` 与普通 `HH:mm:ss` 可解析时按时间从新到旧尝试；不可解析字符串仍保留原来的后写优先。
  - 默认数字历候选改用 `addSecondsToPreviewTime()`，允许从 `23:59:59` 推到下一日，而不是只做同一天内加秒。
- `world-engine-preview.test.ts`
  - 补充乱序 `usedTimes` 下仍从最新 instant 推导下一时间。
  - 补充最新 instant 后一秒已占用时继续跳到下一秒。
  - 补充乱序且最新时间在日末时跨日推导。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts` 通过：1 个测试文件、19 个测试。
- 未自动执行浏览器验收。

## Notes

本轮只修前端默认时间建议，不改变后端 Calendar / instant 排序契约。复杂自定义日历仍回退到 examples 或原有字符串策略。
