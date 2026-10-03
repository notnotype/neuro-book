# Round 229: Pending subject keeps focus

## Summary

Round 228 让待接入-only subject 过滤后清空旧 `selectedSliceId`，避免 Inspector 残留旧切片。继续审查同一链路时发现还有一个更隐蔽的状态串线：`reloadTimelineForCurrentSubjectFilter()` 会调用 `applyDefaults()`，而 `applyDefaults()` 会根据当前 timeline 的 fallback slice 调整 `focusedSubjectId`。

待接入-only 视角下，服务端不会收到 subject filter，因此会返回普通 timeline；如果此时 `applyDefaults()` 把焦点改回某个旧 slice 的已注册主体，作者再点击“新建 Slice”时，Composer 默认目标就可能不是刚刚选中的待接入主体，也就绕开了“请先同步主体系统”的提示。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 待接入-only subject 过滤分支在清空 `selectedSliceId` 后，将 `focusedSubjectId` 恢复为本次选择的最后一个 subject。
  - 同时清空 `highlightedMutationFocus`，避免旧 issue focus 在无选中 slice 视角下残留。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，固定待接入-only subject 过滤会恢复 focused subject。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - passed：1 file, 3 tests.
- `bun run typecheck`
  - passed.

## Notes

- 本轮没有改后端/API，也没有扩大测试面。
- 本轮没有自动执行浏览器验证。后续获准实跑时，应覆盖：先选待接入 subject，再点“新建 Slice”，应继续提示先同步主体系统，而不是打开写向其它 subject 的 Composer。
- 实际计划与结果的出入：本轮原本只检查 Inspector 残留问题是否修干净；读到 `applyDefaults()` 会重写 focus 后，补了这一步焦点恢复。
