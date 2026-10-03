# Round 50 - 主 IDE 内嵌 World Engine Workbench

## 背景

Round 49 先在主 IDE Header 增加了 World Engine 入口，但它只是打开 `/world-engine.preview?projectPath=<当前 Project>` 新标签。这个入口能让功能可发现，但还不是主 IDE 内的正式工作流。

本轮继续沿着“独立 workbench/dialog，而不是左侧窄 tab”的方向推进：把 Header 按钮改为打开一个主 IDE 内嵌的全屏 World Engine Workbench，同时保留 Preview 作为调试兜底入口。

## 本轮计划

1. 新增 World Engine Workbench Dialog。
2. Workbench 直接使用当前 Project 的 `projectPath` 读取真实 API。
3. 第一版先覆盖浏览、查询、示例数据和显式 re-settle，不把 Preview 里的完整 Mutation Builder 一次性搬进来。
4. 更新 Header 入口接线、契约测试和任务文档。

## 实现

- 新增 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 使用 `Dialog size="full"` 作为主 IDE 内嵌工作台。
  - 读取 `/api/projects/world-engine/schema`、`subjects`、`slices`。
  - 左侧显示 subjects，中间按 `Timeline / State / Schema` 三个视图组织。
  - Timeline 支持选择 slice、查看 mutations、一键创建示例世界。
  - State 支持按 selected subject 查询 reduce 后状态，可填写 attrs、at 和 listLimit。
  - Schema 展示 calendar format / examples 和 subject type attrs。
  - 右侧 Inspector 展示 selected subject / selected slice，并提供显式 `resettleTimeline` 表单。
  - Header 右上角保留打开独立 `/world-engine.preview?projectPath=<当前 Project>` 的按钮。
- 更新 `app/pages/index.vue`：
  - 引入 `WorldEngineWorkbenchDialog`。
  - 新增 `worldEngineWorkbenchOpen` 状态。
  - `open-world-engine` 事件现在打开内嵌 workbench，不再直接打开新标签。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 契约从“Header 直接打开 Preview”改为“Header 打开 Workbench，Workbench 覆盖 World Engine API 与 Preview 兜底入口”。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`
  - 2 个测试文件通过。
  - 14 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 代码审查自检

- 没有改 `NovelIdeTab` / 左侧 sidebar / ToolPanel 持久化，避免扩大 UI 状态影响面。
- Workbench 组件没有使用 `any` / `unknown`；组件内 DTO 对 API JSON value 使用浅层展示类型，完整 JSON 校验仍由后端和 Preview util 负责，避免 Vue computed 展开递归 `JsonValue` 导致 typecheck 深层推导失败。
- 本轮没有删除独立 Preview；Preview 仍是完整手工写入 / 编辑 slice 的调试入口。

## 与计划的出入

本轮按计划实现了主 IDE 内嵌 Workbench，但没有把 Preview 的 Mutation Builder / `editSlice` 表单迁入 Workbench。原因是这部分交互比浏览 / 查询 / re-settle 更复杂，直接复制会造成两套大表单并行维护。下一轮应抽取或重建正式 mutation 编辑器，而不是继续扩大 Preview 页面。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮由契约测试和 typecheck 覆盖。

## 后续

- 把 Preview 的 Mutation Builder / `writeSlice` / `editSlice` 能力迁入 Workbench，形成真正的主 IDE 世界编辑入口。
- 评估是否把 Preview 降级为开发调试页，避免长期双线维护。
- 后续用户确认后，需要在浏览器中从主 IDE Header 打开 World Engine Workbench，跑一键示例世界、state query 和 re-settle。
