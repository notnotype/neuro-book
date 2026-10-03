# Round 325 - Workbench Sidebar Busy Guard

## Context

Round 324 已让主 IDE Workbench 的 Preview、关闭 Workbench、打开 schema/calendar 配置文件等离开上下文入口在 `workbenchActionBusy` 中由函数层 guard 兜住，并禁用了顶栏按钮。

继续从作者真实推演流程检查时，左侧 Sidebar 仍有一个视觉 / 行为错位：

- subject 行点击会切换 timeline subject 过滤，但 busy 中父层会拒绝。
- `整体世界` 会清空 subject 过滤，但 busy 中父层会拒绝。
- schema/calendar 路径按钮会尝试离开当前 Workbench 上下文，但 busy 中父层会拒绝。

这会让作者在同步回流中看到“按钮像是可点，点了却只提示等待”的轻微卡顿。

## Changes

- `WorldEngineWorkbenchPreviewSidebar.vue`
  - 新增 `busy?: boolean` prop，默认 `false`。
  - `toggleSubject()` 和 `clearSubjects()` 在 busy 时直接返回，避免事件绕过 disabled。
  - schema/calendar 路径按钮、`整体世界`、subject 行按钮在 busy 时禁用。
  - 保留本地搜索、type 过滤、左栏 activity/review 筛选、折叠和 resize 可用；这些只影响本地视图，不触发真实 timeline 请求或离开上下文。
- `WorldEngineWorkbenchDialog.vue`
  - 向 Sidebar 传入 `:busy="workbenchActionBusy"`。
- `world-engine-ide-entry.test.ts`
  - 补充静态契约断言，锁住 Sidebar busy prop、函数层 guard 和关键按钮 disabled。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

本轮没有扩大到所有 Sidebar 本地交互；只禁用会改变真实 Workbench 上下文或离开当前上下文的入口。
