# Round 49 - 主 IDE Header 入口

## 背景

此前 World Engine 已有独立 `/world-engine.preview` 调试入口，并能走真实 API 完成 Project 创建、subject 创建、slice 写入 / 编辑、状态查询和显式 re-settle。但它还没有从主 IDE 可发现的入口，用户需要手动输入 preview 路由。

本轮目标是做一个低风险的正式入口：不急着把完整 timeline / subject 面板塞进主 IDE 左侧工具栏，而是先让当前 Project 可以从主 IDE Header 直达 World Engine preview。

## 本轮计划

1. 调研主 IDE Header、Sidebar、ToolPanel、首页父组件和 store 的接线。
2. 选择最小接入点，避免扩大 `NovelIdeTab` 类型和左侧面板状态持久化影响面。
3. 在 Header 增加 World Engine 按钮，由首页负责携带当前 Project 打开 preview。
4. 补轻量契约测试和文档。

## 实现

- 更新 `app/components/novel-ide/NovelIdeHeader.vue`：
  - 新增 `open-world-engine` emit。
  - 在非 user-assets 模式下显示 `World` Header 按钮，图标使用 `i-lucide-globe-2`。
- 更新 `app/pages/index.vue`：
  - 新增 `openWorldEnginePreview()`。
  - 使用 `router.resolve()` + `URLSearchParams` 打开 `/world-engine.preview?projectPath=<currentNovelId>` 新标签。
  - Header 绑定 `@open-world-engine="openWorldEnginePreview"`。
- 更新 `app/i18n/locales/zh-CN.ts` 与 `app/i18n/locales/en-US.ts`：
  - 增加 `ide.header.worldEngine`。
- 新增 `app/utils/world-engine-ide-entry.test.ts`：
  - 检查 Header 入口、图标、i18n key 和首页 `projectPath` 传递契约。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 1 个测试用例通过。
- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 个测试文件通过。
  - 13 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮没有改左侧 `NovelIdeTab`、没有新增主 IDE 内嵌 World Engine 面板，也没有改 World Engine API / Agent 工具 / 数据模型。

这是有意收缩后的第一步接入：主 IDE 已有可发现入口，但完整产品化工作区仍需要后续单独设计 timeline、subject 状态视图、mutation 编辑器和 re-settle 提示。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮由契约测试和 typecheck 覆盖。

## 后续

- 设计主 IDE 内嵌 World Engine 面板，而不是继续扩大 preview 页面。
- 决定 World Engine 是否要成为左侧 sidebar tab；如果是，需要同步处理 `NovelIdeTab`、store 持久化、ToolPanel 标题和 user-assets 模式隐藏规则。
- 设计 preview / 正式面板之间的功能分工，避免长期维护两套重叠 UI。
