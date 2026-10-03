# 2026-06-20 Slice Before After Diff

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 mock 检查体验，不接真实 API，不改后端 DTO。重点让 Mutation Editor 在编辑 mutation value 时直接展示该 attr 在当前 slice 前后的状态差异。

## Finding

当前 Workbench 已能展示：

- 当前 slice 的 mutations。
- 当前 slice reduce 后的 subject state。
- schema-aware value input。

但用户检查一个 mutation 是否正确时，仍需要自己把“本切片变更”和“此时状态”拼起来推理。例如 `collectionRemove` 的 value 是 `subject://old-sword`，用户还要确认它是否真的从艾莉娜的 `inventory` 中移除了。

因此 Mutation Editor 需要在 value 控件附近显示更直接的 before / after 对照。

## Changes

- 页面层新增 `previousSnapshotSubjects` 计算：
  - 当前 selected slice 不是第一条时，读取上一条 slice 的 mock snapshot。
  - 第一条 slice 没有 previous snapshot 时返回空数组。
- `WorldEngineWorkbenchPreviewMutationEditor` 新增 `previousSnapshotSubjects` prop。
- Mutation Editor 根据 mutation 的 `subjectId / attr` 从 previous / current snapshot 中读取点分 attr 路径。
- subject 视图的每条 mutation value input 下方增加紧凑对照块：
  - `切片前`
  - `切片后`
- 总视图也在 value input 下方显示一行压缩 before -> after，方便整体浏览时快速扫差异。
- 缺失 attr 用 `unset` 展示，避免空白值让用户误以为 UI 没渲染。
- 目标测试补充静态契约，防止 `previousSnapshotSubjects`、`mutationBeforeValue`、`mutationAfterValue` 和 `切片前 / 切片后` 展示被误删。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 页面正常挂载，列表显示 `6 / 6 slices · 25 mutations`。
  - 滚动到 `艾莉娜把旧剑交给莫然`，选中 `slice-erina-hands-sword`。
  - 点击卡片内 `聚焦 艾莉娜` 后，Mutation Editor 自动展开。
  - `inventory collectionRemove` 的 value input 仍显示 `旧剑 · old-sword` 下拉。
  - value input 下方显示：
    - `切片前 ["subject://old-sword"]`
    - `切片后 []`
  - Inspector 的 State Snapshot 同步显示 `erina.inventory` 为 `[]`。
  - 页面 `scrollWidth` 未超过 viewport width，没有横向溢出。
- dev logs 仍可读到 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没有发现阻断当前页面挂载和交互的新错误。

## Plan Deviation

- 本轮没有抽共享 util。点分 attr 读取只服务 preview Mutation Editor 的 UI 对照，保持在 preview 组件边界内。
- before / after 是 slice 级对照，不是同一 slice 内多条同 attr mutation 的逐条中间态。如果未来支持同 slice 内同 subject 同 attr 的多次 mutation，需要单独设计逐条 step diff。

## Next Notes

- 后续可以把 before / after 从纯文本推进为“变更类型”视觉：新增、删除、修改、无变化。
- 如果真实 API 接入时能返回 selected slice 的 previous state，可以直接替换当前 mock previous snapshot 计算。
