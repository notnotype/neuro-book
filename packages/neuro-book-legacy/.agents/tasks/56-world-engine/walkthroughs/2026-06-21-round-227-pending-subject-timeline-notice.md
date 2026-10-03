# Round 227: Pending subject timeline notice

## Summary

继续检查作者从左栏 subject 进入世界时间线的路径。真实 Workbench 左栏现在会合并两类主体：

- 已注册到 World Engine 的 subject。
- 只存在于 `simulation/subjects` discovery 中、尚未注册到 World Engine 的待接入主体。

此前 Slice Composer 已经会拦住待接入 subject，提示先同步主体系统；但作者如果只是点击左栏待接入 subject 查看 timeline，会看到空结果，却不知道这是“暂无 World Engine 身份”，还是“这个角色确实没有历史切片”。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 新增 `pendingSubjectTimelineNoticePrefix`。
  - `updateSelectedSubjectIdsForTimeline()` 检测本次选择里尚未注册到 World Engine 的 subject。
  - 如果存在待接入 subject，顶部 notice 显示：暂无 World Engine 时间线，并提示使用左侧“同步主体系统”或选择已注册 subject。
  - 清空过滤或切回已注册 subject 时，只清掉这条特定 notice，不清掉保存成功等其它消息。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，固定待接入 subject timeline 提示存在。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - passed：1 file, 3 tests.
- `bun run typecheck`
  - passed.

## Notes

- 本轮不改变后端 API，也不改变待接入 subject 的真实语义：未注册前仍没有 World Engine timeline。
- 本轮没有自动执行浏览器验证；后续获准实跑时，应覆盖：左栏点击一个待接入 subject 后，顶部出现同步提示；同步完成后再点击该 subject，不再显示这条提示。
- 实际计划与结果的出入：本轮原本只做轻代码审查；读到待接入 subject 的选择链路后，确认这是作者更容易遇到的解释性卡点，因此补了一个窄提示。
