---
schema: nbook.walkthrough/v1
taskId: t16-dialog-window-nb-ui-migration
sequence: 1
role: tasker
status: in_progress
createdAt: 2026-09-08T14:20:00+08:00
---

# t16 Walkthrough 001：DialogWindow 范围与前置清理

## 结论

开发者已批准 DialogWindow 迁移方向：Reka 负责 Dialog 的可访问性与模态基础，但该组件必须保持 `modal=false` 的非模态浮动窗口语义；拖拽与窗口尺寸调整由项目层实现。

本轮确认 t15 不能承载 DialogWindow：t15 的目标和交付物只属于 AgentProfileSettingsView。已在同一 Work 下建立新的 current Task：

- Task：`t16-dialog-window-nb-ui-migration`
- role：`tasker`
- 范围：nb-ui DialogWindow、全部主应用消费者、nb-ui playground、公开文档和行为验证

## 消费者基线

静态读取确认当前 DialogWindow 直接消费者：

- nb-ui playground：`packages/nb-ui/playground/app/pages/components.vue`
- NeuroBook：`AgentContextInspectorDialog.vue`、`AgentJobsDialog.vue`、`ThemeEditorDialog.vue`
- 旧入口：`packages/neuro-book/app/components/common/DialogWindow.vue`
- 目标入口：`packages/nb-ui/src/components/feedback/DialogWindow.vue` 与 `@notnotype/nb-ui/components` 导出

当前 nb-ui 实现使用 `useDraggable`，支持非模态、标题栏拖动、关闭和 body/footer slot，但还没有窗口 resize，也未使用 Reka Dialog 原语。当前 Reka `DialogContentNonModal` 明确不 trap focus、不禁用外部 pointer events；t16 必须显式使用 `DialogRoot :modal="false"`，不能从模态 Dialog 复制 Overlay 或 focus trap。

## 前置清理

在 t16 实现前完成两项独立清理：

1. `docs/specs/ui/agent-profile-settings.md` 的 Smoke 入口保留公开命令，但场景改为泛化的 Component Lab 受控场景登记，不再指向 fixture 文件路径，以保持 planned Spec 黑盒合同。
2. `packages/neuro-book/app/component-lab/fixtures/AgentProfileSettingsViewFixture.vue` 删除同时存在的 `min-h-[560px]` 与 `min-h-0`；当前策略为 `h-full max-h-full min-h-0`，高度由 Lab 画布/宿主分配，长表单由内部滚动处理。此处不再声称存在 560px 最小高度。

验证：

```text
bun run --cwd packages/neuro-book test -- app/components/novel-ide/settings/agent-profile/AgentProfileNavList.test.ts
→ Test Files 1 passed; Tests 10 passed

git diff --check
→ 通过；仅显示 Windows LF→CRLF 提示
```

## 未完成项

- t16 尚未修改 DialogWindow 源码、消费者或 nb-ui playground；
- Reka 非模态标题、外部交互、Escape、resize 手柄和全部消费者的真实浏览器行为尚未验证；
- Product gate 仍不属于本 Task，不能以 Lab 或 playground 证据宣称 Work/Product gate 完成；
- `packages/neuro-book/eval-tmp.ts` 保持用户未跟踪状态，未读取、修改或删除。

## 下一步

先为 nb-ui DialogWindow 增加行为测试与同名黑盒组件文档，再实现 `DialogRoot :modal="false"` 的迁移和项目层 resize，最后切换全部消费者并运行 nb-ui 与 NeuroBook 聚焦验证。
