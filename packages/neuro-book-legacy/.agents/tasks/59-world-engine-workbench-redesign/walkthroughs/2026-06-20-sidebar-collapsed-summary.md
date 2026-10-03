# 2026-06-20 Sidebar Collapsed Summary

## Context

本轮继续从用户视角检查 `/world-engine.workbench-preview`。左侧栏可收起是三栏 workbench 的核心能力，但当前收起态只保留 schema / subjects 图标和竖排 `Subjects` 文案。用户收起左栏后，会失去 active subject 数、当前 subject 过滤数、open review subject 数和 value draft subject 数这些重要状态。

这会让“收起左栏以扩大切片列表”变成一种信息损失较大的操作。

## Changes

- `WorldEngineWorkbenchPreviewSidebar` 的 collapsed rail 新增 `world-sidebar-collapsed-summary`。
- 收起态以非交互窄徽标保留关键信号：
  - active subjects：显示当前活跃 subject 数。
  - selected subjects：仅在已有 subject 过滤时显示。
  - subjects with open review issues：仅在存在 open review subject 时显示。
  - subjects with value drafts：仅在存在 value draft subject 时显示。
- 徽标使用现有 World Engine 局部视觉变量，不新增全局主题。
- 这些徽标不是按钮，避免 48px 窄栏里出现难以理解的微型操作入口；展开 / 收起仍由顶部 panel 按钮负责。
- 静态契约测试补充 collapsed summary 和四类 title 文案断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：本轮尝试使用 in-app browser 进行视觉验收，但浏览器连接连续超时；最后一次重置后等待到工具调用上限约 120 秒仍未返回 `browser.documentation()`。因此本轮没有完成真实浏览器截图验收。

## Detour / Limitation

- 按任务流程，本轮应该进行浏览器测试。
- 因 in-app browser 连接阻塞，本轮绕道为：
  - 通过 Vue 模板结构确认 collapsed rail 新元素只在 `props.collapsed` 分支渲染。
  - 通过静态契约测试钉住 `world-sidebar-collapsed-summary` 与四类状态标题。
  - 通过 `typecheck` 确认模板表达式类型安全。
- 后续浏览器连接恢复后，需要补一次视觉确认：收起左侧栏后，48px rail 内 active/open/value/selected 徽标不应挤压顶部按钮，也不应造成横向滚动。

## Notes

- 本轮仍是 mock-only UI/UX 优化，不接真实 API，不改后端 DTO。
- 这个改动让用户可以放心收起左栏，同时保留最小的 subject 状态感知。
