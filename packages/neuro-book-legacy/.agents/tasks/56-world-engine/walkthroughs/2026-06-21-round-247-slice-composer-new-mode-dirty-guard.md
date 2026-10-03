# Round 247: Slice Composer New Mode Dirty Guard

## Context

继续补齐 Slice Composer 的草稿安全边界。此前已经处理：

- 关闭 Composer 时确认未保存草稿。
- 关闭 Workbench / Esc 时确认未保存草稿。
- Composer 打开态再次点击顶部新建 / 编辑入口不会误清父层 dirty。

继续审查内部编辑路径时发现：载入已有 slice 后，Composer Header 里会显示 `新建模式` 按钮。用户如果已经修改了编辑草稿，再点 `新建模式`，此前会直接清空编辑表单并回到默认新建草稿，没有确认。

## Changes

- `WorldEngineMutationEditor.vue`
  - `clearEditMode()` 在 `hasDirtyDraft` 为真时先确认：
    - `当前编辑器有未保存草稿，确定切换到新建模式吗？`
  - 用户取消时保持当前编辑草稿。
  - 用户确认时才回到新建 slice 模式。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，防止后续移除该确认文案。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 选中已有 slice，点击 `编辑 Slice`。
- 载入所选 slice 后修改 title / mutations。
- 点击 Composer Header 的 `新建模式`。
- 取消后仍保留当前编辑草稿；确认后才回到新建模式。

## Result

实际结果与计划一致：只补内部 `新建模式` 切换的草稿确认，不改后端、不引入持久草稿、不扩大测试面。
