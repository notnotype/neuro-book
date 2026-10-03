# 2026-06-22 Round 318 - Preview Actions Loading World Guard

## 背景

独立 `/world-engine.preview` 的 World State 面板已经在 `loadingWorld` 时禁用，但右侧 Actions 面板只看 `actionBusy`。

Project 切换或 `loadWorld()` 回流期间，schema、subjects 和 timeline 还没稳定；这时允许创建 subject、写 slice 或 query state，容易让请求使用旧表单上下文，或让 UI 在新 Project 数据到达后出现错位。

## 变更

- `WorldEnginePreviewActions` 新增 `loadingWorld` prop。
- `Create Subject`、`Write Slice`、`Query` 三个区域的可提交条件都要求 `!loadingWorld`。
- 三个区域的 `fieldset` 都改为 `:disabled="loadingWorld || actionBusy"`。
- `world-engine.preview.vue` 向 Actions 传入 `loadingWorld`。
- `createSubject()`、`writeSlice()` 和用户触发的 `queryState()` 入口增加 `loadingWorld` guard。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
