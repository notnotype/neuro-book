# 2026-06-22 Round 321 - Workbench Timeline Loading Action Guard

## 背景

主 IDE Workbench 的 `workbenchBusy` 已包含 `timelineLoading`，但 `workbenchActionBusy` 只包含 `loading / actionBusy / sliceComposerSaving`。

这意味着 subject timeline 局部刷新期间，顶部新建 Slice、编辑 Slice、删除 Slice、创建示例世界、同步主体系统等上下文动作仍可能被触发。作者在 subject 过滤切换或 timeline 回流中继续操作，容易和服务端 timeline 查询结果互相覆盖。

## 变更

- `workbenchActionBusy` 纳入 `timelineLoading`。
- 新增 `blockWorkbenchActionBusy()`，用于函数入口层阻止工作台同步期间的上下文动作。
- 以下入口增加函数层 guard：
  - `seedDemoWorld()`
  - `syncPendingSubjectSystemSubjects()`
  - `deleteSelectedSlice()`
  - `openSliceComposer()`
  - `openSelectedSliceComposer()`
  - `openSubjectCreatorPanel()`

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
