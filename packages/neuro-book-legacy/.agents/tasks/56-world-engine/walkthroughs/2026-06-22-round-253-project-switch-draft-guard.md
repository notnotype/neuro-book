# Round 253: Project Switch Draft Guard

## Context

Round 251 / 252 已经保护了 Workbench 自己的关闭入口，但继续审查 Project 切换路径时发现：主 IDE 顶部切换 Project 是父页面行为。

此前情况：

- Workbench 内部知道 Slice Composer / metadata / value 会话草稿。
- 父页面 `handleSwitchNovel()` 只知道文件系统未保存文件，不知道 World Engine Workbench 草稿。
- 如果 Workbench 打开且有会话草稿，作者从顶部切换到另一个 Project，`projectPath` prop 会变化。
- 子组件 watcher 会 `resetWorkbenchSessionState()`，草稿被清空。

这会绕过 Workbench 自己的关闭确认。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `hasUnsavedDraftsChange` 事件。
  - 通过 `workbenchUnsavedDraftLabels().length > 0` 监听 Slice Composer / metadata / value 草稿状态。
  - 任何草稿状态变化都会向父页面上报布尔值。

- `app/pages/index.vue`
  - 新增 `worldEngineWorkbenchHasUnsavedDrafts`。
  - `WorldEngineWorkbenchDialog` 接入 `@has-unsaved-drafts-change`。
  - `handleSwitchNovel()` 在真正切换 Project 前，如果 Workbench 打开且存在 World Engine 草稿，会先弹出选择：
    - `放弃草稿并切换`
    - `取消`
  - 用户取消时不切换 Project。
  - 用户确认放弃时先关闭 Workbench 并清理父层标记，再继续原有未保存文件检查和 Project 切换。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，覆盖父子事件、切换 Project 前确认、取消路径。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 打开主 Workbench。
- 修改 Inspector metadata 或 mutation value 但不保存。
- 从顶部 Project 下拉切换到另一个 Project。
- 应先看到 World Engine 草稿确认；取消后 Project 不切换。

## Result

实际结果与计划一致：只把 Workbench 会话草稿状态上报给父页面，并在 Project 切换前确认；不改后端、不引入持久草稿、不扩大测试面。
