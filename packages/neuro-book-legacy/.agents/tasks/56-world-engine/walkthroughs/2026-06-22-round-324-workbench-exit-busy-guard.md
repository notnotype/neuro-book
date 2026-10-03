# Round 324 - Workbench Exit Busy Guard

## Context

上一轮已把主 IDE Workbench 顶栏 Drafts 按钮的禁用态对齐到 `workbenchActionBusy`。继续检查真实作者流程时，发现还有几个“离开当前上下文”的入口在 timeline / action 回流中仍可触发：

- 打开独立 Preview。
- 关闭 Workbench。
- 从左侧 Schema / Calendar 路径打开 Project Workspace 文件。

这些动作不是普通布局切换，会让作者离开当前 Workbench 上下文；如果在同步中触发，容易看到半刷新的状态，或在回流前切走工作台。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `openPreview()` 增加 `blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再打开 Preview。")`。
  - `requestWorkbenchClose()` 在保存保护之后增加 `blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再关闭 Workbench。")`。
  - `openWorkspacePathFromWorkbench()` 在保存保护之后增加 `blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再打开配置文件。")`。
  - 顶栏 `Preview` 与关闭按钮绑定 `:disabled="workbenchActionBusy"`，视觉禁用态与函数层 guard 对齐。
- 保留 Inspector 展开 / 收起、侧栏折叠、面板 resize 等纯 UI 操作，不在本轮锁死。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收；仍需用户明确允许后再跑 Preview / 主 IDE Workbench 真实浏览器流程。

## Notes

本轮实际范围小于“全面忙碌态梳理”：只处理会离开 Workbench 上下文的高风险入口，没有继续追加后端畸形输入守卫，也没有扩大测试矩阵。
