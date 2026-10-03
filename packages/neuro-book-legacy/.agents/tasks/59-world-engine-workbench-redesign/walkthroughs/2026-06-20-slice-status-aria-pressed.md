# 2026-06-20 Slice Status Aria Pressed

## Context

Slice List 顶部状态统计卡已经支持快捷过滤和 toggle，下面的 status 分段控件也能切换相同状态。但这些按钮此前只用视觉样式表达选中态，没有 `aria-pressed`。

对于键盘 / 辅助技术用户来说，按钮当前是否处于 pressed 状态不够明确；同时这也让“统计卡”和“分段控件”两个入口的状态语义不一致。

## Changes

- 四张状态统计卡增加 `aria-pressed`：
  - open
  - done
  - clean
  - draft
- 下方 status 分段控件增加 `aria-pressed`：
  - 全部
  - open
  - done
  - clean
  - draft
- 保留现有视觉选中样式，不改变过滤行为。
- 静态契约测试补充各 status 的 `aria-pressed` 断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：本轮再次尝试恢复 in-app browser，但初始化阶段仍超时，60 秒内没有返回 `browser.documentation()`，因此没有完成真实页面验收。

## Detour / Limitation

- 浏览器连接阻塞仍未解除，本轮继续用代码结构、静态契约测试和 typecheck 验证。
- 后续浏览器恢复后，需要补验：
  - quick stat card 和 status segment 在对应状态下 `aria-pressed=true`。
  - 切换状态后 `aria-pressed` 同步更新。
  - 视觉选中态与 pressed state 一致。

## Notes

- 本轮仍是 mock-only UI/UX 优化，不接真实 API，不改后端 DTO。
- 这次改动主要补齐可访问性和状态语义一致性，为后续更完整的键盘操作体验打底。
