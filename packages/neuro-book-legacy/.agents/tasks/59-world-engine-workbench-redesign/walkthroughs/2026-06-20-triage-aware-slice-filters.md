# 2026-06-20 Triage-aware Slice Filters

## Scope

本轮继续推进 `/world-engine.workbench-preview` mock UI/UX，不接真实 API，不改后端 DTO。重点把上一轮的 issue triage 状态反映到主画布 Slice List 和 Slice Card 中，让用户处理 review issue 后，列表也能同步显示 `open / done` 状态。

## Finding

上一轮已经支持在 Inspector 中把 issue 标记为 `待处理 / 已确认 / 已忽略`，但中间 Slice List 仍只按 raw `slice.issues` 判断 review 状态：

- 已确认或已忽略的切片仍显示为 `review`。
- 切片卡片只显示 `N issues`，无法区分还有多少 open。
- status 过滤只有 `review / clean`，用户无法只看仍待处理的切片，也无法查看已经处理完的 review 切片。

从用户视角看，这会造成明显断裂：右侧 Inspector 说 issue 已处理，中间主列表却仍像未处理。

## Changes

- 新增 preview-only 类型 `WorldWorkbenchPreviewSliceReviewSummary`，从当前 slices 和本地 triage 状态派生每个 slice 的 review 汇总。
- route 页面新增 `sliceReviewSummaries` computed：
  - `total`
  - `open`
  - `confirmed`
  - `ignored`
  - `done`
- `WorldEngineWorkbenchPreviewSliceList` 新增 `sliceReviewSummaries` prop，并构造 `sliceReviewSummaryMap`。
- Slice List status 过滤从 `review / clean` 改为：
  - `open N`：仍有待处理 issue 的切片。
  - `done N`：有 issue，但全部已确认或忽略的切片。
  - `clean`：没有 issue 的切片。
- `matchesHealth()` 现在按 triage-aware summary 过滤，而不是只看 raw `slice.issues.length`。
- `WorldEngineWorkbenchPreviewSliceCard` 新增 `sliceReviewSummary` prop。
- Slice Card 的 review badge 改为：
  - `open X/Y`
  - `done X/Y`
  - `clean`
- 目标测试补充静态契约，覆盖 `sliceReviewSummaries`、`WorldWorkbenchPreviewSliceReviewSummary`、`openReviewSliceCount`、`doneReviewSliceCount`、`sliceReviewSummary` 和 `reviewBadgeLabel`。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 使用当前 `http://localhost:3000/world-engine.workbench-preview` 完成 smoke：
  - 刷新页面后，Slice List status 显示 `open 2 / done 0 / clean`。
  - 初始卡片可见 `open 1/1`，不再出现旧 `review 2` 过滤按钮。
  - 点击 `open 2`：
    - 列表显示 `2 / 6 slices`。
    - open 切片卡片显示 `open 1/1`。
  - 在 Inspector 点击 `确认`：
    - status 统计变为 `open 1 / done 1`。
    - 当前 open 列表变为 `1 / 6 slices`，已确认切片自动退出 open 过滤。
  - 点击 `done 1`：
    - 列表显示 `1 / 6 slices`。
    - 已处理切片卡片显示 `done 1/1`。
    - 列表中不再显示 `open 1/1` badge。
  - 点击 `重置 mock`：
    - 回到 `6 / 6 slices`。
    - status 恢复 `open 2 / done 0`。
    - 卡片恢复 `open 1/1`，不再显示 `done 1/1`。
  - 全程无横向溢出。
- 浏览器 dev logs 未出现 2026-06-20 新 warn/error。

## UX Review

- 这轮修复了 triage 状态和主画布之间的信任问题：用户在 Inspector 中处理 issue 后，Slice List 会立即反映“还有哪些切片需要看”。
- `open / done / clean` 比旧的 `review / clean` 更符合连续检查工作流；它把“存在问题”和“仍需处理”拆开了。
- Slice Card 的 `open X/Y` / `done X/Y` 让用户不打开 Inspector 也能扫读 review 进度。

## Plan Deviation

- 原本下一步可以做 Review Queue 的 open-only 模式；实际先修了主列表状态，因为这是更基础的用户心智问题：主画布必须可信，队列模式才有意义。
- 本轮仍不引入真实 issue resolution 合同，所有状态来自浏览器 mock 草稿。

## Next Notes

- 后续可以基于本轮 summary，让 Review Queue 支持 `只看 open` 模式。
- 后续可以让左侧 Subjects 的 review stats 也区分 open/done，而不是只按 raw issue 计数。
