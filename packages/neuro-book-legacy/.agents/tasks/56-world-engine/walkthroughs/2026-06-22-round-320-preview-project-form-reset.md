# 2026-06-22 Round 320 - Preview Project Form Reset

## 背景

独立 `/world-engine.preview` 新建 Project 成功后，表单仍保留刚创建时的标题和摘要。默认标题只精确到分钟，作者连续创建试用 Project 时容易重复点击出同名 / 近似同名 Project，也不容易判断当前表单是否已经完成上一轮创建。

## 变更

- Preview 默认 Project 标题时间戳精确到秒。
- 新增 `defaultPreviewProjectTitle()` 统一生成默认标题。
- 新增 `resetCreateProjectForm()`，新建 Project 成功并选中新 Project 后重置标题和摘要，为下一次创建准备新的默认表单。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
