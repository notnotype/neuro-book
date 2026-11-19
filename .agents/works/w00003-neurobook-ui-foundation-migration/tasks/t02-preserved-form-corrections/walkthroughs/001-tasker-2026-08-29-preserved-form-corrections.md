---
schema: nbook.walkthrough/v1
taskId: t02-preserved-form-corrections
sequence: 1
role: tasker
status: completed
createdAt: 2026-08-29T12:20:00+08:00
---

# t02 保全表单控件修复交接

## 结论

`t02-preserved-form-corrections` 的 allowlist 变更已完成并具备可复现证据：

- `FormCheckbox` checked/indeterminate 渐变以 `#000000` 作为 `color-mix()` 纯黑端点，visual span 恢复 `peer-focus-visible:border-[color:var(--focus-outline)]` 与 `peer-focus-visible:shadow-[var(--focus-ring)]`；disabled/modelValue 组件合同未改动。
- `FormInput` 的 prefix/suffix 包装与裸 input、`PinInputInput` 均带 `.nb-ui-native-input`；`src/styles.css` 的 search decoration、WebKit number spinner 与 Firefox number appearance 规则均以 marker 为作用域，未标记宿主 input 不匹配。
- 相邻 Vitest 合同测试、Component Lab fixture 与 Chromium lab 场景已同步；`dist/nb-ui.css` 由 `bun run build:css` 重建。
- 现有 `SliderFixture.vue` 方案未改动。

## 实际改动

仅 allowlist 内以下 12 个已跟踪文件和 1 个新增 fixture 文件有 t02 变更：

- `packages/nb-ui/src/components/form/FormCheckbox.vue`
- `packages/nb-ui/src/components/form/FormInput.vue`
- `packages/nb-ui/src/components/form/PinInput.vue`
- `packages/nb-ui/src/styles.css`
- `packages/nb-ui/src/components/form/form-controls.contract.test.ts`
- `packages/nb-ui/src/components/token-consumption.test.ts`
- `packages/nb-ui/playground/app/component-lab/fixtures/FormCheckboxFixture.vue`
- `packages/nb-ui/playground/app/component-lab/fixtures/FormCheckboxLabTarget.vue`
- `packages/nb-ui/playground/app/component-lab/fixtures/FormInputFixture.vue`
- `packages/nb-ui/playground/app/component-lab/fixtures/FormNumberInputFixture.vue`
- `packages/nb-ui/e2e/lab.spec.ts`
- `packages/nb-ui/docs/ui-development-spec.md`
- `packages/nb-ui/dist/nb-ui.css`

当前主工作区同时存在其它 Work/用户改动；本 Task 未触碰它们，也未修改 Work README 或 Task README。

## 回归证据

### RED / 诊断

初始 `bun run test:e2e` 复用了已存在约 12 小时的 `nb-ui-e2e-final` 服务（端口 3100），该进程不属于本轮启动；因此其失败结果按 stale 服务证据处理，不作为当前源码回归结论。之后未停止或重启该服务，遵守用户/其它 Work 进程边界。

在新端口 3110 启动当前 `packages/nb-ui` playground 后，t02 受影响用例首次暴露两处 allowlist 内既有断言与 fixture 不一致：

1. prefix 断言用 `getByText("@", {exact: true})`，真实 fixture 文本为 `@WORLD/`。
2. 数字测试向原生 `input[type=number]` 填入 `-` / `1.`，Playwright 拒绝向 number input 输入这些非法中间值；真实当前 fixture 的合法 target 是 `type=number`、`step=0.05`、行距步进边界 `1.0~3.0`。

按开发者授权，仅修正 `e2e/lab.spec.ts` 这两项测试断言，没有改公共组件或 fixture 来迁就测试，也未通过跳过/隐藏用例规避失败。

### GREEN

3110 服务由 hub 启动：

- 启动命令：`node ../../node_modules/nuxt/bin/nuxt.mjs dev playground --port 3110`
- 服务日志出现 `Local: http://localhost:3110/`；HTTP 探测 `curl -I http://localhost:3110/` 返回 `HTTP/1.1 200 OK`。
- 临时 Playwright 配置位于系统 Temp：`C:\Users\USER~1\AppData\Local\Temp\neuro-book\acceptance\t02-e2e-current\playwright.config.mjs`，仅将 `baseURL` 指向 3110、关闭 webServer 自动启动并将结果输出到系统 Temp。

修正后聚焦命令：

```text
node ../../node_modules/@playwright/test/cli.js test e2e/lab.spec.ts --config=C:/Users/USER~1/AppData/Local/Temp/neuro-book/acceptance/t02-e2e-current/playwright.config.mjs --workers=1 --grep "复选框|原生作用域|输入框：prefix|数字输入" --reporter=list
```

结果：`4 passed (5.4s)`，exit code `0`。覆盖：合法数字编辑/步进/边界、prefix + focus 事件、checkbox fallback + focus 事件、marker selector 隔离 + checkbox keyboard focus。

随后最新聚焦回归命令：

```text
node ../../node_modules/@playwright/test/cli.js test e2e/lab.spec.ts --config=C:/Users/USER~1/AppData/Local/Temp/neuro-book/acceptance/t02-e2e-current/playwright.config.mjs --workers=1 --grep "复选框|原生作用域|输入框：prefix|数字输入" --reporter=list
```

结果：`4 passed (5.4s)`，exit code `0`。

另有一次包含场景切换/选择器/事件日志的扩展聚焦运行：prefix、checkbox、native scope、数字用例通过；选择器与事件日志在 `#nb-lab-target` 等待处失败，原因是当前 `FormSelectFixture` 与 `ButtonFixture` 没有 target marker。这些 fixture 不属于 t02 本次修复目标，未扩大范围修复。

### Vitest 与类型检查

```text
bun run test -- src/components/form/form-controls.contract.test.ts src/components/token-consumption.test.ts
```

结果：`Test Files 2 passed (2)`、`Tests 14 passed (14)`，exit code `0`。

```text
bun run typecheck
```

结果：Nuxt types generated in `playground/.nuxt`，命令正常结束，exit code `0`。

### CSS 构建确定性

系统 Temp 目录：

```text
C:\Users\USER~1\AppData\Local\Temp\neuro-book\acceptance\t02-css-determinism
```

第一次构建：

```text
bun run build:css
```

将 `dist/nb-ui.css` 复制为 `first.css` 并计算 SHA-256。第二次再次执行同一命令，比较字节与 SHA-256。

结果：

- 第一次产物：`111598` bytes；SHA-256 `67c2ce197485f7dd52598a9fd3f45c859ccd379ea0dfc2f8b9246c9b20bea5ec`
- 第二次产物：`111598` bytes；SHA-256 `67c2ce197485f7dd52598a9fd3f45c859ccd379ea0dfc2f8b9246c9b20bea5ec`
- `cmp` 输出 `byte-identical`
- 当前 `packages/nb-ui/dist/nb-ui.css` SHA-256 同上

### 全量 E2E

当前源码 3110 服务上的全量命令（使用系统 Temp 配置）实际执行过：

```text
node ../../node_modules/@playwright/test/cli.js test --config=C:/Users/USER~1/AppData/Local/Temp/neuro-book/acceptance/t02-e2e-current/playwright.config.mjs --workers=1 --reporter=list
```

另按包脚本要求实际执行过：

```text
bun run test:e2e -- --config=C:/Users/USER~1/AppData/Local/Temp/neuro-book/acceptance/t02-e2e-current/playwright.config.mjs --workers=1 --reporter=list
```

两次均为 `32 tests`，最终 `15 passed`、`17 failed`、exit code `1`。当前 t02 目标相关四个用例在完整运行中均通过：

- `数字输入：合法编辑、步进与边界 clamp`
- `输入框：prefix 渲染、focus 入事件日志`
- `复选框：无 label 时回退显示布尔值，focus 入事件日志`
- `表单原生作用域与复选框键盘焦点保持隔离`

其余失败精确归类如下，未扩大修复：

- `选择器：Enter 展开、富选项、禁用项、焦点归还、body 不锁`：当前既有 `FormSelectFixture` 没有 `#nb-lab-target`。
- `选择器向上展开时 data-side=top`：同上。
- `事件日志 100 条封顶且可清空`：当前既有 `ButtonFixture` 没有 `#nb-lab-target`。
- `shots: 4 主题 × 明暗配色矩阵`：同一既有 target marker 缺失。
- 8 个主题/配色视觉基线：快照与当前工作树视觉输出不一致，差异比例约 `0.10~0.26`；该视觉基线不属于 t02 表单目标，未更新快照。
- `组件基准：button`、`组件基准：tabs`、`组件基准：segmented-control`：既有 target marker 缺失/等待超时。
- `组件基准：switch-field` 与 `窄屏 390 视口基准`：既有视觉快照差异。

这些失败不应被写成“全量 E2E 通过”；它们是当前工作树既有 lab/视觉基线问题，且没有证据表明由 t02 表单修复引起。

## 其它验证与未运行项

- `git diff --check -- <13 个 allowlist 文件>`：通过，exit code `0`；仅有 Git 的 LF→CRLF warning，没有 whitespace error。
- 未运行 formatter、lint、项目全量 `bun run test`；按 Task 明示约束留给 Leader 统一决定。
- 未执行浏览器人工验收；Task 明确禁止人工浏览器验收。自动化 Chromium 已执行。
- 未执行 NeuroBook 主仓接入验证；这是 nb-ui 阶段 2 的明确残余风险。
- 未 commit、push、PR、合并、发布或部署。

## Leader 判断建议

`t02` 表单修复、相邻合同测试、fixture marker、CSS 样式与确定性产物已形成闭合证据；建议 Leader 按 allowlist 审查当前实际 diff 后完成 Task。全量 E2E 仍保留 17 个与 t02 表单目标无关的既有 lab/视觉基线失败，不能作为绿色全量门禁宣称；人工浏览器验收按合同保持未运行。
