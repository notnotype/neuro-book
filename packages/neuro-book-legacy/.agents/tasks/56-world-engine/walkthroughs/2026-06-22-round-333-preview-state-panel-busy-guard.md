# Round 333 - Preview State Panel Busy Guard

## Context

继续检查独立 Preview 的常用操作入口。StatePanel 的刷新、载入 subject、载入 slice、删除 slice 按钮在模板层都已经按 `loadingWorld || actionBusy || !projectReady` 禁用。

但父页面里仍有两个函数层不一致：

- `@refresh` 直接调用 `loadWorld()`，如果组件事件绕过 disabled，会在已有 action 请求飞行中重新读取世界数据。
- `deleteSlice()` 只检查 `actionBusy`，没有检查 `loadingWorld`；如果世界数据正在回流，绕过按钮事件仍可能触发删除确认和请求。

## Changes

- `world-engine.preview.vue`
  - 新增 `refreshWorldFromStatePanel()` 作为用户刷新入口。
  - 该入口在 `loadingWorld` 或 `actionBusy` 中直接返回，再调用内部 `loadWorld()`。
  - StatePanel 的 `@refresh` 改为调用 `refreshWorldFromStatePanel()`。
  - `deleteSlice()` 增加 `loadingWorld` guard。
- `world-engine-ide-entry.test.ts`
  - 补充静态契约，确认 StatePanel 用户刷新不再直连 `loadWorld()`，删除入口也挡 `loadingWorld`。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

内部 `loadWorld()` 仍保留给 Project 切换、新建 Project、写入 / 删除成功后的流程复用；本轮只给 StatePanel 用户刷新入口加请求飞行保护。
