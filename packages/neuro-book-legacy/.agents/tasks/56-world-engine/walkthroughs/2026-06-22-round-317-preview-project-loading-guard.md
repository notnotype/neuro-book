# 2026-06-22 Round 317 - Preview Project Loading Guard

## 背景

独立 `/world-engine.preview` 顶部 Project 选择器已经在 `loadingProjects || actionBusy` 时禁用，但左侧 Project 面板只看 `actionBusy`。

这会留下一个真实入口竞态：页面刚打开或手动刷新 Project 列表时，`loadProjects()` 正在加载并最终会选择 / 刷新当前 Project；此时如果作者从左侧面板新建 Project、创建示例世界或点击 Schema attr 快捷填充，就可能和列表加载 / `loadWorld()` 回流抢上下文。

## 变更

- `WorldEnginePreviewProjectPanel` 新增 `loadingProjects` prop。
- Project 创建区、`新建 Project`、`创建示例世界`、Schema attr 快捷按钮都在 `loadingProjects || actionBusy` 时禁用。
- `world-engine.preview.vue` 向 ProjectPanel 传入 `loadingProjects`。
- `createProject()`、`seedDemoWorld()` 和 `fillMutation()` 函数入口增加 `loadingProjects` guard。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
