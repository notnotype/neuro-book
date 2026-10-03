# 2026-06-22 Round 312 - Preview State Busy Guard

## 背景

上一轮已让独立 `/world-engine.preview` 的 Write Slice 区域在写入 / 编辑请求飞行中整体禁用，但 World State 面板里的刷新、subject 点击、载入编辑和删除 slice 仍可触发。

从作者真实操作路径看，慢请求期间继续点击 timeline 或 subject，容易造成“刚保存的草稿/状态被另一个动作打断”的并发错觉。

## 变更

- `WorldEnginePreviewStatePanel` 新增 `actionBusy` prop。
- World State 面板在 `loadingWorld || actionBusy || !projectReady` 时禁用刷新、subject 选择、载入编辑和删除 slice。
- `world-engine.preview.vue` 把页面级 `actionBusy` 传入 StatePanel。
- 页面层用户入口函数补充请求飞行中保护：
  - `createProject`
  - `seedDemoWorld`
  - `createSubject`
  - `writeSlice`
  - `deleteSlice`
  - `loadSubjectIntoQuery`
  - `loadSliceForEdit`
  - 用户直接触发的 `queryState`
- `queryState({ clearActionIssues: false })` 仍允许在写入 / 删除成功后的内部刷新链路中运行，避免破坏现有成功后刷新状态。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行 `bun run typecheck`；当前任务只做窄入口契约验证，避免过度测试。
