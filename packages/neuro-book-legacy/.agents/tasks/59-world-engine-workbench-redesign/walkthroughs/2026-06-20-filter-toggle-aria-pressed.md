# 2026-06-20 Filter Toggle Aria Pressed

## Context

Slice List 的 status / kind 过滤已经逐步补齐上下文计数和 `aria-pressed`。继续检查同一屏里的其它高频 toggle 后发现，仍有几类状态按钮只靠视觉样式表达选中态：

- 主画布多 subject 过滤时的 `任一 subject / 全部 subject` 模式切换。
- 左侧 Subjects 的 `active / open / done / value` 快捷筛选。
- 左侧 subject 行本身，点击后会加入或移除主画布 subject 过滤。

这些控件都是用户频繁使用的“世界视角 / 单 subject 视角”入口。如果只靠颜色和边框表达状态，键盘 / 辅助技术用户不容易判断当前按钮是否处于 pressed 状态。

## Changes

- `WorldEngineWorkbenchPreviewSliceList`：
  - `任一 subject` 增加 `aria-pressed="props.subjectFilterMode === 'any'"`。
  - `全部 subject` 增加 `aria-pressed="props.subjectFilterMode === 'all'"`。
- `WorldEngineWorkbenchPreviewSidebar`：
  - 左侧 `active / open / done / value` 快捷筛选按钮增加对应 `aria-pressed`。
  - subject 行按钮增加 `aria-pressed="selectedSubjectSet.has(subject.id)"`。
- 静态契约测试补充上述 `aria-pressed` 断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 本地页面 HTTP 检查：`http://localhost:3000/world-engine.workbench-preview` 返回 200。

## Browser Verification

- 本轮没有绕过浏览器插件限制。
- 当前 in-app Browser 插件目录仍缺少 skill 要求的 `scripts/browser-client.mjs`，因此不能按规定连接浏览器完成真实视觉验收。
- 后续浏览器插件恢复后，需要补验：
  - 多 subject 模式下，`任一 subject / 全部 subject` 的视觉选中态与 `aria-pressed` 一致。
  - 左侧 `active / open / done / value` 点击后 pressed state 同步变化。
  - subject 行选中 / 取消选中后 pressed state 与主画布 subject 过滤一致。

## Notes

- 本轮仍是 mock-only UI / UX 优化，不接真实 API，不改后端 DTO。
- 这次改动继续把工作台里“可切换状态”的按钮语义统一起来，为后续更完整的键盘巡检体验打底。
