---
schema: nbook.task/v2
taskId: t04-quick-input-surface
---

# S4 QuickInput 原语与 nb-ui 双展示入口

## 目标

在 nb-ui 新建纯受控 `QuickInput` 全局浮层原语（S4），并为 `AlertDialog` 增加通用 `closed` 事件。详细合同见计划 §5（`local://workbench-command-foundation-plan.md`）。

## 范围

1. `packages/nb-ui/src/theme/z-index.ts`：`NB_Z_INDEX.commandPalette:9200`，注释语义为 S4 全局命令面板。
2. 新增 `src/components/feedback/QuickInput.vue`：props/emits/类型见计划 §5（`QuickInputItem`/`QuickInputProps`，`focusRequest`、`restoreFocus`、`closed`；attrs 透传面板根）。使用 reka-ui `DialogRoot/Portal/Overlay/Content/Title`（modal、`disableOutsidePointerEvents`）；`role=combobox` + listbox + activedescendant；`moveHighlight` 导航、hover/click accept、Home/End、composition Enter 抑制；DOM 冒泡层消费 Escape/Tab 并 stopPropagation；关闭不加退出动画、打开消费 `.nb-ui-popover-motion`；`closed` 于 close-auto-focus→queueMicrotask→下一宏任务（排在 Reka FocusScope 清理之后）按 open-cycle token 发一次；portal body 回退、透明遮罩 9200/Content 在后；布局 `min(640px,calc(100vw-24px))`、top `clamp(16px,8vh,72px)`、`max-height min(560px,calc(100dvh-48px))`；材质复用 `.nb-ui-popover-surface` 等，无新 token。
3. `src/components/index.ts` 导出组件与公开类型。
4. `AlertDialog.vue`：增加 `closed` emit，语义同时序；有 trigger 保留原焦点策略。
5. playground `/lab` 登记：`registry.ts`（`LabComponentId "quick-input"` + labComponents 条目，场景 default/empty/disabled/loading/long-list/dialog-stack）、新 `fixtures/QuickInputFixture.vue`、`LabStage.vue` 静态映射；`playground/app/pages/components.vue` 手写画廊加演示。
6. 测试：`QuickInput.test.ts`（disabled/全禁用/空列表 accept 抑制、composition Enter 不提交）；`components.test.ts` 扩 AlertDialog `closed` 只发一次。
7. 门禁：`bun run test`、`bun run typecheck`、`bun run build:css`、`bun run test:e2e`（`NB_UI_E2E_PORT=3217`、`NB_UI_E2E_REUSE_SERVER=1` 可复用任务内 playground）、`git diff --check`；`dist/nb-ui.css` 随变更提交。

## 边界

- 不把应用命令/匹配/MRU 依赖下沉 nb-ui；不改 DialogWindow/Dialog 既有实现；不在 playground 之外新增展示路由。

## 依赖

t01（文档同步）；与 t02/t03 并行（不同包）。
