# 2026-06-21 Main Workbench Slice Composer

## Summary

- 本轮针对作者视角 P0 卡点：主 IDE Workbench 已能浏览、筛选、编辑 metadata / mutation value、删除 slice，但缺少日常“新建 slice / 推演下一步”的正门。
- 实现采用最小接线：复用已存在且走真实 API 的 `WorldEngineMutationEditor`，作为主 Workbench 内 Slice Composer 浮层。
- 没有重写 Mutation Builder，也没有改后端 DTO / API。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 顶栏新增 `新建 Slice` 按钮。
  - 新增 `world-slice-composer` 浮层，承载 `WorldEngineMutationEditor`。
  - Slice Composer 写入 / 编辑成功后：
    - 关闭浮层。
    - 清理 search / kind / status 等可能挡住新 slice 的过滤。
    - `loadWorld({preferredSliceId: result.sliceId})` 刷新真实 timeline 并选中新 slice。
    - 将返回的 `issues` 记录到当前会话 transient review queue。
- `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`
  - 新增可选 `usedTimes` prop。
  - 新建模式默认时间从 `suggestSliceTime()` 升级为 `suggestNextPreviewTime(examples, usedTimes)`，避免连续写 slice 时撞到同一 instant。
  - schema / usedTimes 改变且草稿干净时，会刷新新建模式默认时间。
- `app/utils/world-engine-ide-entry.test.ts`
  - 更新静态契约：主 Workbench 允许使用 `WorldEngineMutationEditor` 作为 composer，但仍禁止旧 `WorldEngineTimeline / WorldEngineStateSummary / WorldEngineSliceInspector` tab 组合回流。
  - 增加新建 Slice 入口、composer 浮层、保存后刷新和 transient issues 闭环断言。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 本轮实际结果与计划一致：先复用旧真实 API 编辑器补上作者新建 slice 正门，而不是在主 Dialog 里重做复杂 Builder。
- 尚未自动做浏览器验证；仍需用户明确允许后，再用 `ming-ding-zhi-shi-2` 在主 Workbench 中实跑 2-3 步切片推演。
- 本轮仍未处理 `createSubject` list default 与 `editSlice` 校验不一致的问题；后续已在 [Edit Init Slice List Set Contract](2026-06-21-edit-init-slice-list-set.md) 中补齐。
