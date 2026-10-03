# Round 283: 下一时间支持默认数字历跨日进位

## Context

继续按“作者真的拿它写世界，第一个卡住的地方在哪”检查主 Workbench 流程。连续写入、父层刷新和编辑旧 slice 路径读下来没有发现新的常规卡点；随后检查到 `suggestNextPreviewTime()` 只支持同一天内时分秒进位。

这意味着最新 slice 如果落在 `23:59:59`，下一条默认时间会回退到 calendar examples，而不是推到次日。对连续推演世界来说，这不是畸形输入，而是自然会遇到的边界。

## Changes

- `app/utils/world-engine-preview.ts`
  - `addOneSecond()` 改为先识别默认数字历时间字符串。
  - 支持 `复兴纪元488年 1月15日 23:59:59` 推到 `复兴纪元488年 1月16日 00:00:00`。
  - 支持 30 日月末推到下月 1 日、12 月 30 日年末推到下一年 1 月 1 日。
  - 只覆盖当前模板 / `ming-ding-zhi-shi-2` 使用的数字年月日时分秒格式，不替代后端 Calendar，也不承诺支持复杂自定义日历。
- `app/utils/world-engine-preview.test.ts`
  - 增加日末、月末、年末三个常用边界断言。

## Validation

- `bunx vitest run app/utils/world-engine-preview.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续寻找作者真实使用的最早卡点。实际只做了一个小修正：默认下一时间从“同一天内小时进位”扩展到默认数字历的日 / 月 / 年边界。没有修改后端 Calendar、API、Agent 工具或 Workbench 结构；编辑旧 slice 和 issue 展示路径本轮只读确认，未改代码。
