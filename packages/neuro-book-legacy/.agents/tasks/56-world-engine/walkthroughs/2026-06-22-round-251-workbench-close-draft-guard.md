# Round 251: Workbench Close Draft Guard

## Context

继续做主 Workbench 的小型代码审查时发现：前几轮已经保护了 Slice Composer 草稿，但 Workbench 内还有两类常用会话态草稿：

- Inspector 里的 metadata 草稿。
- 底部 Mutation Editor 里的 value 草稿。

这些草稿不会写入 localStorage，关闭 Workbench 或切换 Project 会被 `resetWorkbenchSessionState()` 清空。此前关闭 Workbench 只检查 `sliceComposerDirty`，如果作者刚改了 Inspector 或 mutation value 但没保存，关闭时会静默丢失。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `workbenchUnsavedDraftLabels()` 汇总关闭 Workbench 会丢弃的会话态草稿：
    - Slice Composer 草稿。
    - metadata 草稿数量。
    - value 草稿涉及的 slice 数量。
  - `requestWorkbenchClose()` 改为统一确认：
    - `当前 Workbench 有未保存内容：...。确定关闭并放弃吗？`
  - 只关闭 Slice Composer 浮层时，仍保留原来的 Composer 专属确认，不把 Inspector / value 草稿混进去。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，防止 Workbench 关闭确认退回只检查 Slice Composer 草稿。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 修改 Inspector metadata 但不保存，关闭 Workbench 时应确认。
- 修改 mutation value 但不保存，关闭 Workbench 时应确认。
- 只关闭 Slice Composer 浮层时，只检查 Composer 草稿，不阻止保留在主 Workbench 的其它草稿。

## Result

实际结果与计划一致：只保护现有会话态草稿的关闭路径，不引入持久化、不改变保存 API、不扩大测试面。
