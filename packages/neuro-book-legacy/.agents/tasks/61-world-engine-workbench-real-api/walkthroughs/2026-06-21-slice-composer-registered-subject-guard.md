# Slice Composer registered subject guard

## Summary

继续沿主 IDE Workbench 的作者写入路径检查。真实 Workbench 左侧 subject 列表会合并两类主体：

- 已注册到 World Engine 的 `worldSubjects`
- 从 `simulation/subjects` discovery 补进来的 pending subject

但 Slice Composer 实际写入只会把 `worldSubjects` 传给 `WorldEngineMutationEditor`。此前 `sliceComposerSubjectId` 会直接使用 `focusedSubjectId` 或 `selectedSubjectIds`，如果作者选中一个“待接入”主体后点“新建 Slice”，默认 mutation 会指向尚未注册到 World Engine 的 subject，提交时后端必然拒绝。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 新增 `worldSubjectIdSet`，区分已注册 subject 与左栏合并出来的 pending subject。
  - `sliceComposerSubjectId` 只接受已注册 subject；当前焦点不是已注册 subject 时，回落到第一个 `worldSubjects`。
  - `openSliceComposer()` 在当前焦点是 pending subject 时不打开 Composer，提示先同步主体系统或选择已注册 subject。
  - 当前 Project 还没有任何 World Engine subject 时，也不打开 Composer，提示先创建 subject 或同步主体系统。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 Slice Composer 默认目标使用已注册 subject，并对 pending / empty subject 场景有提示。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 未自动执行浏览器验证；后续获准实跑时，应覆盖：选中一个待接入主体后点击“新建 Slice”，页面提示同步主体系统，而不是打开会提交失败的草稿。
