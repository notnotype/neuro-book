# 2026-06-22 Round 315 - Preview Schema Shortcut Busy Guard

## 背景

独立 `/world-engine.preview` 已在请求飞行中禁用 Actions 表单、World State 面板和顶部 Project 切换入口。

继续检查后发现左侧 Schema attr 快捷按钮仍可点击。它会触发 `fillMutation()`，直接改写 `sliceForm.mutations`、`mutationLoadIndex` 和 Builder 字段，从而绕过 Write Slice 区域的 `fieldset :disabled="actionBusy"`。

## 变更

- `WorldEnginePreviewProjectPanel` 的 Schema attr 快捷按钮在 `actionBusy` 时禁用。
- `world-engine.preview.vue` 的 `fillMutation()` 函数入口增加 `actionBusy` 保护，避免事件绕过 UI 后仍改写草稿。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
