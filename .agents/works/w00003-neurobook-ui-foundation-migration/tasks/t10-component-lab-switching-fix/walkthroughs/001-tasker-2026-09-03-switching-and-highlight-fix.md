---
schema: nbook.walkthrough/v1
taskId: t10-component-lab-switching-fix
sequence: 1
role: tasker
status: blocked
createdAt: 2026-09-03T00:00:00Z
---

# t10 Component Lab 切换塌缩与选中标记修复

## 问题与根因

- t07 为 fixture 动态组件增加的 `Transition mode="out-in"` 会先卸载旧组件，再挂载新组件。`ViewportCanvas` 的自由尺寸模式由 slot 自然内容撑高，退场空帧会让画布塌缩成横线。
- 元素检查器点击选中大块元素后使用常驻实线矩形框。矩形边缘在视口内表现为突兀的左竖线，且持续覆盖被检查内容。

## 实际改动

- `LabShell.vue` 删除 fixture 场景 `Transition` 及其 `.lab-scene-*` 样式，动态组件直接替换，不再产生无内容退场阶段。没有给自由尺寸画布添加固定或最小高度，保留“高度 0 = 组件自然高度”合同。
- `HighlightBox.vue` 增加 `showBox?: boolean`，默认 `true` 保持原调用方行为；`false` 时不渲染 `.nb-lab-highlight-box`，仍按 `rect` 定位并渲染 `.nb-lab-highlight-label`。
- Lab 的已选元素标记传入 `:show-box="false"`；悬停探针继续绘制虚线框。
- `HighlightBox.test.ts` 使用真实 Vue SFC 验证默认“框 + 标签”和 `showBox=false`“仅标签”两种合同。NeuroBook Vitest 配置复用仓库现有 `@vitejs/plugin-vue`，没有新增依赖。
- `component-lab.ts` 增加两组浏览器断言：选中后框节点不存在且标签可见；`ViewportCanvas` 自由尺寸场景切换到 `CollapsibleSidePanel` 后画布高度大于 `80px`，再切换 `JsonViewer` 仍能挂载。
- Component Lab Spec 与 `HighlightBox.md` 同步最终行为。

## 验证

- `bun run test app/component-lab/HighlightBox.test.ts`：通过，1 file、2 tests。
- `bun run test app/component-lab`：通过，1 file、2 tests。
- `bun run test`：通过，433 files passed、1 skipped；3317 tests passed、3 skipped。SQLite experimental、fault-injection 与 workspace-history 日志来自既有测试场景，没有失败用例。
- `bun run typecheck`：通过。
- `bun run scripts:typecheck`：通过。
- `bun run docs:check`：通过，5356 files、0 failures。
- `git diff --check`：通过。

## 浏览器 smoke 阻塞

执行：

`bun run smoke:component-lab -- --url http://127.0.0.1:3000 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`

结果：失败于进入断言前。`GET /lab` 返回 HTTP 500，Playwright 等待 `.lab-root` 可见 30 秒后超时。现有 NeuroBook 运行实例占用 Agent Session Store runtime lease；全新隔离 State Root 又被 Application State migration 门禁拒绝。本任务未获得执行数据库迁移的授权，因此没有修改用户状态或临时状态来绕过门禁，也不把新增浏览器断言记为已通过。

## 未验证与残余风险

- 聚焦浏览器断言已写入 smoke，但受上述运行环境门禁影响未执行到断言阶段。
- 未取得开发者单独授权，未进行人工视觉验收、截图对比或逐项键盘走查。
