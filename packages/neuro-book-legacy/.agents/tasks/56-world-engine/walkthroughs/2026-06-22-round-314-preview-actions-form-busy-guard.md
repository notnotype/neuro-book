# 2026-06-22 Round 314 - Preview Actions Form Busy Guard

## 背景

前几轮已让独立 `/world-engine.preview` 在请求飞行中禁用顶部 Project 切换、World State 面板和 Write Slice 区域。

继续检查作者真实输入路径后，发现 `Create Subject` 与 `Query` 的按钮虽然会禁用，但输入框仍可编辑。慢请求期间如果作者开始填写下一个 subject，成功回流会清空 `id/name`；如果作者改了 query 条件，返回结果可能对应旧请求，而输入框已显示新条件。

## 变更

- `WorldEnginePreviewActions` 的 `Create Subject` 区域改为 `fieldset :disabled="actionBusy"`。
- `WorldEnginePreviewActions` 的 `Query` 区域改为 `fieldset :disabled="actionBusy"`。
- 现有 `Write Slice` 区域保持同样的 fieldset 禁用结构。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
