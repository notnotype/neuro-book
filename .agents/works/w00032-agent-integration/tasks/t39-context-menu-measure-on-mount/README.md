---
schema: nbook.task/v2
taskId: t39-context-menu-measure-on-mount
status: done
updated: 2026-11-18
---

# ContextMenu 挂上时就量位置

## 目标与范围

nb-ui 的 ContextMenu 一挂上就是打开的（宿主用 v-if 挂）时，也夹回视口并聚焦第一项；调用方不用再常挂着靠 open 驱动。来源：t37 下一步（[t37](../t37-status-line-customization/README.md) 决定 5），开发者 2026-11-18 同意。

合同：组件的同名文档 `packages/nb-ui/src/components/popup/ContextMenu.md`（删掉“首次挂载不会主动测量钳位”的限制，改写成两种挂法都量）；不涉及 Spec。

做法：小任务，按 2026-11-18 起的规矩（reviewing 的“按任务大小降级”）不写计划、不做计划与实现审查。

## 当前状态

2026-11-18 完成并合入 master（修正 343d9e503，合入 9977a1b49）。

- `ContextMenu.vue`：夹回视口与聚焦首项抽成 `place`，`open`、`x`、`y` 变化时与挂上时就打开时都调它；挂上时那次在设 `isMounted` 之后调，`nextTick` 等到 Teleport 的内容渲染出来。等渲染期间菜单已关的不再量、不抢焦点。
- `ContextMenu.test.ts`：新用例“挂着再打开、打开时才挂上：都夹回视口并聚焦首个可用项”。去掉挂上时的那次调用，用例在 `mountedOpen` 上失败（left 1424，视口 1024），恢复后通过。
- `ContextMenu.md` 跟上；`AgentStatusBar.vue` 删掉“要常挂着”的注释（状态栏照旧常挂着，行为不变）。

验证（worktree，负载 12 到 20）：

- nb-ui、nb-agent-ui 类型检查通过；nb-ui vitest 623 条通过。
- `test:affected` 选中 10 个包，跑满 20 分钟被截停在 neuro-book 的 bun 测试中途；截停前 dev-panel、nb-agent-ui、nb-form、nb-harness、nb-layout、nb-markdown、nb-models、nb-ui 全过；nb-story 1 条 `revisions.test.ts` 5 秒超时，单独重跑 4/4 通过（与本改动无关的命令行用例）。
- neuro-book 补跑会打开右键菜单的 4 个 DOM 测试（ExplorerTree、EditorTabBar、ProviderRail、WorkbenchRegionStrip）21 条通过；真实浏览器 `e2e/editor-code-menu.e2e.ts` 14 条通过。
- 未验证：neuro-book 其余的 bun 与 vitest 用例没跑完；“打开时才挂上”只在 happy-dom 里测过，现有调用方都是常挂着，真实浏览器里没有这种用法。

## 下一步

无。
