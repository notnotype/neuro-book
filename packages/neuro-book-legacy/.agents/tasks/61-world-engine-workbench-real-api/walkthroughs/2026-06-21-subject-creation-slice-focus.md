# 2026-06-21 Subject Creation Slice Focus

## Summary

继续沿作者路径审查主 Workbench：round 205 已允许 init slice 原样编辑后，下一步是让作者创建 subject 或同步主体系统后，能马上看到这个 subject 对应的初始化切片和状态。

原逻辑会先 `loadWorld()` 按默认规则选中最近 slice，然后再设置 `selectedSubjectIds` / `focusedSubjectId`。如果项目里已有更晚的普通 slice，作者会看到左侧选中了新 subject，但中间和右侧仍可能停在旧 slice 上，初始化切片需要靠过滤联动再跳转。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `loadWorld()` / `applyDefaults()` 增加 `preferredSubjectIds` 选项。
  - 新增 `latestSliceTouchingSubjects()`，从真实 timeline 中倒序查找触及目标 subject 的最近 slice。
  - `handleSubjectCreated()` 创建 subject 后先设置 subject 过滤，再 `loadWorld({preferredSubjectIds: [subjectId]})`。
  - `syncPendingSubjectSystemSubjects()` 同步多个主体后同样按 `created` subject 集合定位相关 slice。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，防止创建 / 同步 subject 后的 slice focus 接线回退。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 本轮没有新增浏览器自动验收；项目规则要求浏览器验收需用户明确允许。
- 如果 subject schema 没有 default，不会生成 init slice；此时仍会保留原默认 slice 选择行为。
