# 2026-06-22 Round 319 - Preview Project Panel Loading World Guard

## 背景

上一轮让右侧 Actions 面板在 `loadingWorld` 时禁用，但顶部 Project 选择 / 刷新和左侧 ProjectPanel 仍主要只看 `loadingProjects || actionBusy`。

Project 切换后 `loadWorld()` 回流期间，当前 schema / subjects / timeline 还未稳定；此时继续切 Project、刷新列表、新建 Project、创建示例世界或点击 Schema attr 快捷填充，仍可能与 `loadWorld()` 抢上下文。

## 变更

- 顶部 Project 选择器和刷新按钮禁用条件扩展为 `loadingProjects || loadingWorld || actionBusy`。
- `refreshProjects()` 在 `loadingWorld` 时直接返回。
- `WorldEnginePreviewProjectPanel` 新增 `loadingWorld` prop。
- Project 创建区、`新建 Project`、`创建示例世界` 和 Schema attr 快捷按钮都在 `loadingProjects || loadingWorld || actionBusy` 时禁用。
- `createProject()`、`seedDemoWorld()` 和 `fillMutation()` 函数入口增加 `loadingWorld` guard。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
