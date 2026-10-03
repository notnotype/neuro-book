# 2026-06-21 Panel Controls And Select Refinement

## Context

用户在 Workbench Preview 视觉修正后指出 4 个局部交互问题：

- Sidebar 展开态的收起按钮占用了一个独立竖列，挤压左栏内容。
- Inspector 关闭后缺少可见恢复入口，无法重新展开。
- 底部“审查工作台”收起 / 展开缺少动画反馈。
- Sidebar 的 type 过滤仍使用原生 `select`，需要改用 `app/components/common` 里的表单组件。

本轮只处理面板控制和控件一致性，不改 World Engine API、DTO 或 mock 数据。

## Changes

- `WorldEngineWorkbenchPreviewSidebar.vue`
  - 展开态收起按钮移入 Schema 标题行右侧，不再通过额外右侧留白占用一整列。
  - 收起态保留独立恢复按钮，维持 collapsed rail 的可发现性。
  - type filter 从原生 `<select>` 改为 common `FormSelect`，与项目表单控件视觉和交互一致。
- `world-engine.workbench-preview.vue`
  - 当右侧 Inspector 被隐藏时，在右侧保留 `world-inspector-restore-rail` 恢复条。
  - 点击恢复条会把 `inspectorVisible` 切回 `true`，避免关闭后无入口重新展开。
- `WorldEngineWorkbenchDialog.vue`
  - 同步真实 Workbench Dialog 的 Inspector 恢复条，保持 mock preview 与真实 Workbench 的面板行为一致。
- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 底部审查工作台 collapsed 状态使用固定 `40px` 高度。
  - 面板容器增加 height transition，收起 / 展开时有明确动画反馈。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts`：通过。
- `bun run typecheck`：通过。

## Notes

- 本轮未自动做浏览器视觉验收，遵守项目约束；后续可人工确认 1920 宽屏和较窄桌面视口下的左栏按钮、Inspector 恢复条、底部面板动画和 common select 样式。
- 真实 Workbench 只同步了 Inspector 恢复入口，没有把 mock-only 的三栏 UI 细节强行迁入真实 API 页面。
