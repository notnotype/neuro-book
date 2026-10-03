# Round 225: Merge Loaded Slice By Previous Time

## 背景

Round 224 让 slice detail 返回 `previousTime`，已经修正了懒加载 issue slice 的 before / after 状态上下文。但目标 slice 仍然只是追加进当前 timeline 数组，作者点击 issue 后，列表视觉顺序可能和世界时间不一致。

这不是完整虚拟时间轴问题，但可以用 `previousTime` 做一个小修：如果当前 timeline 里已有前一切片，就把懒加载切片插到它后面。

## 本轮变更

- 新增 `mergeWorldWorkbenchTimelineSlice()` 纯函数：
  - 如果 `loadedSlice.previousTime` 命中当前列表中的某个 slice，则插到该 slice 后面。
  - 如果没有 `previousTime`，说明这是已知最早切片，插到开头。
  - 如果找不到前序切片，则保守追加到末尾。
- `WorldEngineWorkbenchDialog.loadSliceIntoTimeline()` 改为使用该函数合并懒加载 slice。

## 计划出入

- 本轮没有做完整 timeline window / virtual list，也没有让前端解析项目日历字符串排序。
- 这只是解决 Review Queue 懒加载定位后的常见视觉错位，让作者看到目标切片时更接近真实时间线位置。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`：通过，3 tests。
- `bun run typecheck`：通过。

