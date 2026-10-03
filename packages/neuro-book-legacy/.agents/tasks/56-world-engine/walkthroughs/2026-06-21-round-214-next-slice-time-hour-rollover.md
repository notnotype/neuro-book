# Round 214: 下一切片时间支持小时进位

## Summary

继续沿作者连续推演路径审查 `suggestNextPreviewTime()` 时发现：round-213 已经让下一条 slice 默认时间优先从最新 timeline 推导，但底层秒级推进只允许在同一小时内变化。也就是说，如果最新切片时间是 `复兴纪元488年 1月15日 14:59:59`，下一条默认时间无法得到 `15:00:00`，会回退到 calendar examples，可能再次把作者带回世界元年示例。

## Changes

- `app/utils/world-engine-preview.ts`
  - 将默认时间推进从“同小时内秒数递增”扩展为“24 小时制同一天内秒数递增”。
  - `14:59:59` 现在会推到 `15:00:00`。
  - `23:59:59` 这类跨日边界仍不在前端硬算，后续如需要应通过更完整的 calendar projection 支撑。
- `app/utils/world-engine-preview.test.ts`
  - 增加 `14:59:59 -> 15:00:00` 的纯函数回归。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 file passed, 19 tests passed.

## Notes

- 本轮没有修改真实 Project 数据，也没有自动执行浏览器验证。
- 计划与结果基本一致：只修连续推演默认时间的小时边界，不扩成前端 Calendar 重写。
