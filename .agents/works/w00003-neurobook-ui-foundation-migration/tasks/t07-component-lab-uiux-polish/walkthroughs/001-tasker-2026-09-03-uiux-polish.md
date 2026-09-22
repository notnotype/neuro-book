---
schema: nbook.walkthrough/v1
taskId: t07-component-lab-uiux-polish
sequence: 1
role: tasker
status: completed
createdAt: 2026-09-03T00:00:00Z
---

# t07 Component Lab 响应与动效精修

## 实际改动

- `LabShell.vue` 使用 `matchMedia('(max-width: 700px)')` 监听运行中视口变化。进入窄屏时收起左右侧栏；监听在卸载时移除。离开窄屏不自动展开，保留使用者状态。
- `CollapsibleSidePanel.vue` 增加宽度与 flex-basis 的主题 token 转场，不改变受控 props/emits、焦点逻辑或内容所有权。
- `LabShell.vue` 为 fixture 动态组件增加 `out-in` 场景转场，使用 `--motion-fast` 与 `--ease-standard`；`prefers-reduced-motion: reduce` 下关闭场景和侧栏转场。
- `component-lab.ts` 增加运行中 `1440→390→1440` 的收起/不自动展开断言，以及 reduced-motion 计算样式断言。窄屏断言等待 Vue DOM 更新完成，避免把同步 viewport 改变与异步渲染混为一谈。
- `docs/specs/ui/component-lab.md` 补充运行中窄屏策略和动效合同。

## 验证

- `bun run typecheck`（目录 `packages/neuro-book`）：通过。
- `bun run smoke:component-lab -- --url http://127.0.0.1:3001 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`：通过。
  - 实际覆盖 Lab 路由、四个检查 tab、场景切换、数据重置、主题恢复、运行中窗口缩放、手机 `390×844` 画布与页面级横向溢出。
  - smoke 的 console/pageerror 监听未报告错误或警告。
  - reduced-motion 下 `.nb-lab-panel` 的计算 `transitionDuration` 为 `0s`。
- `bun run docs:check`：待提交前运行。
- `git diff HEAD --check`：待提交前运行。

## 修正记录

首次 smoke 在 `setViewportSize` 后立即计数，观察到旧 DOM，失败是验证时序而非实现结论。改为等待 `.nb-lab-panel-head` 数量变为 0 后重跑，结果通过。

## 未验证与残余风险

未取得开发者单独授权，未进行人工视觉验收、截图对比或键盘逐项走查。自动 smoke 证明了 DOM 状态和关键交互路径，不替代人工视觉结论。开发服务运行于本地 `127.0.0.1:3001`，提交前停止。
