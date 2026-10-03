# 2026-06-22 Round 316 - Preview Project Form Busy Guard

## 背景

独立 `/world-engine.preview` 的主要操作区已经在请求飞行中禁用，但左侧 Project 创建表单仍可编辑。

如果作者点击“新建 Project”后，在请求返回前继续修改标题或摘要，成功回流时页面选中的是旧请求创建出的 Project，而表单里可能已经显示新输入，容易让“创建了哪个 Project”产生错位感。

## 变更

- `WorldEnginePreviewProjectPanel` 的 Project 创建区改为 `fieldset :disabled="actionBusy"`。
- `新建 Project` 与 `创建示例世界` 保留原有按钮级 disabled 语义，同时输入框也会在请求飞行中禁用。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
