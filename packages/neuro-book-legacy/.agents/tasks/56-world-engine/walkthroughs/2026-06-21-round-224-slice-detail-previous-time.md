# Round 224: Slice Detail Previous Time

## 背景

Round 223 让 Review Queue 可以通过 `GET /slices/:sliceId` 懒加载未出现在当前 timeline 的 issue slice。但单点加载的 slice 是追加进当前 `slices` 集合的，如果目标切面实际早于当前列表末尾，`selectedSliceIndex - 1` 会拿到错误的“前一切片”，导致底部审查工作台的 before / after 状态上下文可能不准。

前端不能可靠地按项目日历字符串排序，也不应该拿 raw instant。因此本轮把“前一切片时间”作为 slice detail 的公开日历字符串返回。

## 本轮变更

- `GET /api/projects/world-engine/slices/:sliceId` 返回 `previousTime?: string`。
  - 后端仍用 `instant` 查询真实前序切片。
  - HTTP 只暴露项目日历字符串，不暴露 raw instant。
- `WorldEngineWorkbenchDialog` 的 `loadSelectedSliceSnapshots()` 查询前态时优先使用：
  - `slice.previousTime`
  - 否则才回退到当前已加载数组中的前一项。

## 计划出入

- Round 223 walkthrough 中记录“懒加载 slice 追加进当前 timeline，不做复杂排序”。本轮没有改为前端排序，而是补后端 `previousTime`，解决最影响审查工作台的前态状态问题。
- Slice List 视觉顺序仍可能因为懒加载追加而不完全按时间排序；但当前作者点击 issue 后最关键的审查上下文已经由 `previousTime` 校正。如果后续要做完整虚拟时间轴，再单独设计排序 / window API。

## 验证

- `bunx vitest run 'server/api/projects/world-engine/[...segments].test.ts'`：通过，40 tests。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`：通过，3 tests。
- `bun run typecheck`：通过。

