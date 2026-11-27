---
schema: nbook.task/v2
taskId: t15-overlay-scrollbar-keeps-hidden
status: active
updated: 2026-11-27
---

# 叠加滚动条接上的元素改 class 后原生滚动条又出来

## 目标与范围

开发者 2026-11-27 报告：Agent 对话视图有滚动条时整体往左偏，不合 UI 规范。

根因：nb-ui 的 `OverlayScrollbar` 接上滚动元素时用 `classList.add("nb-ui-scrollbar-none")` 隐藏原生滚动条；`AgentConversationView.vue` 给消息流绑了 `:class="{'acv-stream--faded': !streamAtTop}"`，离开或回到顶部时 Vue 重写 class，加上的类被冲掉，原生细滚动条回来占宽，同一元素上还叠着叠加滑块。

修法：`OverlayScrollbar` 改打属性 `data-nb-overlay-scroller`，样式按属性与原类名共用一条规则；修在 nb-ui，所有调用方一起受益。

合同：行为合同不变（[workbench/views.md](../../../../../docs/specs/workbench/views.md) 输出 12，nb-ui 开发规范“滚动条”）；组件文档 `OverlayScrollbar.md` 的“接上”一条改写；开发规范易错清单加一条“不往别人的 `class` 里加类名”。

开发者还提到“三个滚动条”：本次只复现并修了同一元素上原生与叠加两条；第三条未复现，等开发者给位置。

## 当前状态

- 已合入 master：`f46b0b3b1`（修复）、`cc0cfb131`（按审查收紧用例与措辞）。
- 验证：
  - `lab-agent-ui.e2e.ts` 新用例“滚到顶部再离开……”：修复前失败（`scrollbar-width` 为 `thin`），修复后通过；`workbench-views.e2e.ts` 的“面板头的动作与滚动条随鼠标显示……”通过。
  - `bun run test:affected` 通过，除两类：负载 15 到 34 时的超时，单独重跑 4 个文件全部通过；`sdk.test.ts` 的 nb-layout 快照（`NestedGrid`）在 master 上同样失败，是原有问题。
  - nb-ui `typecheck` 通过。
- 审查：Sonnet 审查无阻塞问题；采纳了用例断言渐隐类确实切换、去掉无头浏览器里恒为 0 的宽度断言、两处措辞收窄。

## 下一步

无。第三条滚动条等开发者给位置，另开 Task。
