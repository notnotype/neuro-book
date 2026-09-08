---
schema: nbook.walkthrough/v1
taskId: t16-dialog-window-nb-ui-migration
sequence: 2
role: tasker
status: in_progress
createdAt: 2026-09-08T19:10:00+08:00
---

# t16 Walkthrough 002：Reka 非模态迁移、resize 与消费者切换

## 结论

nb-ui `DialogWindow` 已从手写浮窗迁移到 Reka Dialog 非模态基础，主应用三个消费者已切换到 `@notnotype/nb-ui/components`，旧 local 入口已删除。组件行为已由行为测试与真实 Chromium E2E 验证；类型检查、主应用聚焦测试、docs/governance 检查全部通过。

## 实现内容

### 公共组件（packages/nb-ui）

`src/components/feedback/DialogWindow.vue`：

- 显式 `<DialogRoot :modal="false">`，不渲染 Overlay；`DialogContent as-child` 把 Reka 的 ref/aria 属性转发到真实窗口 DOM。
- `interact-outside` / `pointer-down-outside` / `focus-outside` 全部 `preventDefault`，保持页面外部可交互同时不因外部交互关闭；Escape 经 `escape-key-down` 转成既有 `request-close`（`closeOnEsc` 且不忙碌）。
- 标题合同：`header` slot 或 `title` 都包在 `DialogTitle`；两者皆缺时渲染视觉隐藏 `DialogTitle`，`aria-labelledby` 始终有效。
- 新增可选、受控 resize：`resizable`（默认 false）、`minWidth`（320）、`minHeight`（240）、`update:width` / `update:height`；右/下/右下角手柄带 `role="separator"`、`aria-label`、方向键调整（10px，Shift 1px），pointer 拖动在 pointerup 提交，`busy` 阻断关闭与 resize。
- 关闭语义与旧实现一致：无 `request-close` 监听器时默认关闭，有监听器时只发请求。
- 尺寸边界：窄屏宽度收敛到 `viewport - 24px` 内；`maxHeight` 默认 `calc(100dvh - 80px)` 与旧主应用实现一致；拖拽 handle 只覆盖标题区，关闭按钮不再触发拖动。
- Portal 默认 `body`；`teleportTarget` 支持 string / false。主应用主题宿主 `.novel-ide-theme` 由消费者显式传入，公共组件不硬编码产品宿主（t16 README 合同已同步）。

新增配套交付：

- `src/components/feedback/DialogWindow.md`（frontmatter `[state:local, env:portal, env:global]`，含 props/emits/slots 类型声明、布局/交互/状态、不支持项与上游边界、env:portal 与 env:global 理由）。
- `playground/app/component-lab/registry.ts` 登记 `dialog-window`（scenes default/resizable；controls resizable/closable；targetSelector 固定为稳定触发按钮 `#nb-lab-target`，因为关闭态窗口不在 DOM）。
- `playground/app/component-lab/fixtures/DialogWindowFixture.vue` 与 `LabStage.vue` import/映射；修复插入时意外删掉的 `DropdownFixture`、`popover`、`alert-dialog` 映射。
- `playground/app/pages/components.vue` 的 DialogWindow 演示改为受控宽高的 resizable 实例（含 footer 与滚动 body）。
- `e2e/lab.spec.ts` 新增 DialogWindow E2E。
- `README.md`、`docs/ui-development-spec.md` 13 条更新；`dist/nb-ui.css` 重新构建（新增 cursor-resize 与 data-state 关闭动画类；移除已无消费方的 `pl-4`，经 grep 确认无残留引用）。
- `components.test.ts` 新增行为测试：resize 手柄键盘宽度/高度更新、pointer drag 提交、busy 阻断关闭与 resize、最小值边界不产生无效事件（修掉了一个真实缺陷：尺寸在 min 时仍发出无效 `update:height`）。

### 消费者切换（packages/neuro-book）

- `AgentContextInspectorDialog.vue`、`AgentJobsDialog.vue`、`ThemeEditorDialog.vue` 从 `nbook/app/components/common/DialogWindow.vue` 改为 `@notnotype/nb-ui/components`，并显式 `teleport-target=".novel-ide-theme"` 保留主题变量继承；props（width/height/maxHeight/bodyClass/busy/request-close）逐一核对未变。
- 删除 `app/components/common/DialogWindow.vue`；全仓精确 grep 无旧入口引用。
- `desktop/shared/src/desktop-ui-contract.test.ts` 的 DialogWindow 静态契约改读 nb-ui 源文件（断言语义更新为 `:modal="false"`、无 Overlay、`DialogTitle`、`data-dialog-window`、`data-dialog-resize`）。
- `packages/neuro-book/AGENTS.md` 组件复用指引同步（DialogWindow 现来自 `@notnotype/nb-ui/components`）。

### 用户临时任务（独立于 t16 提交）

- 用户反馈 World Engine Workbench 窗口偏小，请求调大：`WorldEngineWorkbenchDialog.vue` 的 Dialog 尺寸显式覆盖为 `calc(100vw - 8px)` × `calc(100vh - 8px)`（原 `size="full"` 24px 边距），近全屏。

## 验证证据（全部实际执行）

```text
bun run --cwd packages/nb-ui typecheck                         → 通过（0 diagnostics）
bun run --cwd packages/nb-ui test -- src/components/components.test.ts → 110 passed
bun run --cwd packages/nb-ui test                              → 15 files / 259 passed
bun run --cwd packages/nb-ui build:css                         → dist/nb-ui.css 更新（+18/-3 行，已审阅）
bun run --cwd packages/nb-ui test:e2e -- e2e/lab.spec.ts -g "DialogWindow"
  → chromium: DialogWindow：稳定触发目标、非模态交互与 resize 行为 1 passed
    断言：无 overlay、aria-labelledby、右/下/角三手柄、外部点击不关闭、键盘 ArrowRight → 570×520、无页面横向溢出；console/pageerror 归零
bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json      → 通过（含删除旧入口与 WE 尺寸改动）
bun run --cwd desktop/shared test -- src/desktop-ui-contract.test.ts → 通过
bun run --cwd packages/neuro-book test -- app/components/novel-ide/agent/context-inspector app/components/novel-ide/jobs app/components/novel-ide/settings/theme
  → 2 files / 18 passed
bun run docs:check      → {"failures":[],"checkedFiles":5408}
bun run governance:check → failures: []、warnings: []
git diff --check        → 通过
```

## 未运行 / 残余风险

- E2E 全套结果：`bun run --cwd packages/nb-ui test:e2e` → 17 通过 / 17 失败。新增的 DialogWindow 用例通过；失败分两类，均已证实与本会话改动无关：
  - lab.spec.ts 三个既有用例（form-select rich/default、button 事件日志）在 `gotoLab` 等待 `#nb-lab-target` 超时：`FormSelectFixture.vue` / `ButtonFixture.vue` 中的 `#nb-lab-target` 在提交 `56a56c35 chore(t150)` 中被移除（83c88e0d 时分别还有 2/1 处），E2E 契约与 fixture 从此漂移；本会话未修改这两个 fixture。
  - visual/shots 全部基线用例失败：用 HEAD 版本 `dist/nb-ui.css`（不含本会话任何改动）重跑 nbook-dark 用例仍失败，且失败组件（主题页、button/tabs/switch-field/segmented-control、窄屏）模板与本会话 CSS 差异（仅 dialog 新类与无消费方的 `pl-4` 删除）无交集 → 属既有环境/Chromium 版本与 win32 快照基线漂移。两个既有问题均不在 t16 范围，报告给开发者后另行处理。
- 主应用 IDE 页面级浏览器自动验收：dev 实例（3001）被用户实时交互占用，多次独立 Chromium 探测中 IDE 顶栏渲染不稳定；组件行为已由 nb-ui playground 真实浏览器 E2E 覆盖，产品宿主主题继承由显式 `teleport-target=".novel-ide-theme"` 保证，页面级观感由用户在当前打开的实例直接确认。
- Product gate 仍不属于本 Task；不宣称 Work/Product gate 完成。
- `packages/neuro-book/eval-tmp.ts` 保持用户未跟踪状态，未读取、修改或删除。
- Windows autocrlf 对 `t16 README` 与 `dist/nb-ui.css` 显示 LF→CRLF 转换提示，非内容差异。
