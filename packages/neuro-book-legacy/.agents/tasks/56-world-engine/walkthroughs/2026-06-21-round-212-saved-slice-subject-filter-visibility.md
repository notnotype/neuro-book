# Round 212: 保存后避免 subject 过滤隐藏新 slice

## Summary

继续审查主 Workbench 连续推演流程时发现：作者如果左侧选中 `player`，新建 Slice 的默认 mutation 可能按 round-210 回退到 `world.events`。保存成功后 `handleSliceComposerSaved()` 会清空 search / kind / health 过滤并选中新 slice，但不会清空 subject 过滤；中间 Slice List 会因为当前 `selectedSubjectIds=["player"]` 看不到只触及 `world` 的新 slice，随后自动跳到第一个可见 slice。用户看到的结果会像“写成功了，但时间线没停在刚写的切片”。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`
  - `saved` 事件 payload 增加本次提交的 `mutations`，让父组件能判断新 slice 会不会被当前 subject 过滤隐藏。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - `handleSliceComposerSaved()` 在刷新 timeline 前调用 `clearSubjectFilterIfSavedSliceWouldBeHidden()`。
  - 如果当前 subject 过滤与本次提交的 mutations 不匹配，清空 `selectedSubjectIds` 并回到 `subjectFilterMode=any`，保证刚保存的 slice 在列表中可见。
  - 如果新 slice 本来就命中当前 subject 过滤，则保留用户视角。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，钉住 saved payload 的 mutations 和保存后 subject filter 可见性保护。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file passed, 3 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 本轮没有修改真实 Project 数据，也没有自动执行浏览器验证。
- 实际计划与结果的出入：原本审查连续推演的默认时间；默认时间链路仍由 `usedTimes` / `suggestNextPreviewTime()` 支撑，实际更高频的缺口是保存后的 subject 过滤隐藏新 slice，因此优先修这一处。
