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
- 用户随后提供的实际 DOM 证明左竖线还有第二来源：公共 `Tree.vue` 的行 class 同时包含 `border-l-2 border-transparent` 与 `data-[selected]:border-l-[var(--accent-main)]`。元素检查器常驻框和 Tree 选中边框是两个独立问题。

## 实际改动

- `LabShell.vue` 删除 fixture 场景 `Transition` 及其 `.lab-scene-*` 样式，动态组件直接替换，不再产生无内容退场阶段。没有给自由尺寸画布添加固定或最小高度，保留“高度 0 = 组件自然高度”合同。
- `HighlightBox.vue` 增加 `showBox?: boolean`，默认 `true` 保持原调用方行为；`false` 时不渲染 `.nb-lab-highlight-box`，仍按 `rect` 定位并渲染 `.nb-lab-highlight-label`。
- Lab 的已选元素标记传入 `:show-box="false"`；悬停探针继续绘制虚线框。
- `HighlightBox.test.ts` 使用真实 Vue SFC 验证默认“框 + 标签”和 `showBox=false`“仅标签”两种合同。NeuroBook Vitest 配置复用仓库现有 `@vitejs/plugin-vue`，没有新增依赖。
- `component-lab.ts` 增加两组浏览器断言：选中后框节点不存在且标签可见；`ViewportCanvas` 自由尺寸场景切换到 `CollapsibleSidePanel` 后画布高度大于 `80px`，再切换 `JsonViewer` 仍能挂载。
- Component Lab Spec 与 `HighlightBox.md` 同步最终行为。
- 后续修正 `Tree.vue`：删除选中行的透明左边框占位与强调色左边框，保留整行淡强调底、强调文字、中等字重、`data-selected`、`aria-selected` 与 `.nb-ui-focus-ring`。同步 nb-ui 活规范并从 canonical source 重建 `dist/nb-ui.css`。

## 验证

- `bun run test app/component-lab/HighlightBox.test.ts`：通过，1 file、2 tests。
- `bun run test app/component-lab`：通过，1 file、2 tests。
- `bun run test`：通过，433 files passed、1 skipped；3317 tests passed、3 skipped。SQLite experimental、fault-injection 与 workspace-history 日志来自既有测试场景，没有失败用例。
- `bun run typecheck`：通过。
- `bun run scripts:typecheck`：通过。
- `bun run docs:check`：通过，5357 files、0 failures。
- `git diff --check`：通过。
- Tree 聚焦 RED/GREEN：`bun run test -- -t "uses the row surface instead of a left border for tree selection"` 在修复前准确失败于存在 `border-l` 类，修复后 1 test passed。
- nb-ui `bun run test`：通过，15 files、249 tests。
- nb-ui `bun run typecheck`：通过。
- nb-ui `bun run build:css`：通过。
- nb-ui 真实 playground `http://localhost:3010/lab?component=tree`：桌面与 `390×844` 点击“第02章”后均观察到 `aria-selected=true`、`border-left-width: 0px`、选中底色、强调文字与字重 `500`；页面级横向溢出为 false，捕获的 console error、warning 与 pageerror 均为 0。
- nb-ui `bun run test:e2e -- --grep "Tree 选中行不用左边框表达状态"`：通过，Chromium 1 test；用例在 `1440×844` 与 `390×844` 真实点击章节并断言 `aria-selected=true`、`border-left-width: 0px`、选中底色与字重 `500`，同时无页面级横向溢出。
- nb-ui 全量 `bun run test:e2e`：未通过，15 passed、17 failed。失败集中在既有 `#nb-lab-target` 缺失/超时和 4%–6% 全页视觉基线漂移；Tree 专项用例尚未加入该次全量运行。没有更新视觉快照，也不把包级 E2E 记为通过。
- `dist/nb-ui.css` 连续两次从 canonical source 构建的 SHA-256 均为 `5e39308a74c48a8ba0ff989dfdab5ab9f9e07e0a7f2e6d0934bfe2c1e9a887eb`。

## 浏览器 smoke 阻塞

执行：

`bun run smoke:component-lab -- --url http://127.0.0.1:3000 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`

结果：失败于进入断言前。`GET /lab` 返回 HTTP 500，Playwright 等待 `.lab-root` 可见 30 秒后超时。现有 NeuroBook 运行实例占用 Agent Session Store runtime lease；全新隔离 State Root 又被 Application State migration 门禁拒绝。本任务未获得执行数据库迁移的授权，因此没有修改用户状态或临时状态来绕过门禁，也不把新增浏览器断言记为已通过。

## 未验证与残余风险

- 聚焦浏览器断言已写入 smoke，但受上述运行环境门禁影响未执行到断言阶段。
- 未取得开发者单独授权，未进行人工视觉验收、截图对比或逐项键盘走查。
