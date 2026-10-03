# Round 213: 下一切片时间从最新 timeline 推导

## Summary

继续审查连续推演流程时发现一个比前几轮更直接的时间线问题：`ming-ding-zhi-shi-2` 的 calendar projection 同时给出 `复兴纪元1年 1月1日 00:00:00` 和 `复兴纪元488年 1月15日 14:00:00` 两个示例。旧 `suggestNextPreviewTime()` 总是从第一个 example 推导下一秒，因此真实 Project 已经有 488 年初始化切片时，Slice Composer 新建下一步事件会默认跳回 `复兴纪元1年 1月1日 00:00:01`。

## Changes

- `app/utils/world-engine-preview.ts`
  - `suggestNextPreviewTime()` 现在优先从 `usedTimes` 的尾部向前寻找可递增时间，并在同一小时内找第一个未占用秒点。
  - 没有可用 timeline 时间时，才回退到 calendar examples。
  - 这让主 Workbench / 独立 Preview 在已有时间线基础上连续写 slice 时，默认时间跟随最新 timeline，而不是回到 calendar 第一个示例。
- `app/utils/world-engine-preview.test.ts`
  - 增加真实项目形态用例：examples 包含 1 年与 488 年，已占用时间在 488 年时，下一默认时间必须继续 488 年。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 file passed, 19 tests passed.
- `bun run typecheck`
  - passed.
- 非破坏性脚本核查 `workspace/ming-ding-zhi-shi-2`
  - 当前最后时间：`复兴纪元488年 1月15日 14:00:05`
  - 新默认时间：`复兴纪元488年 1月15日 14:00:06`

## Notes

- 本轮没有修改真实 Project 数据，也没有自动执行浏览器验证。
- 这次计划与结果一致：目标就是补连续推演默认时间，避免作者写下一步事件时跳回世界元年。
