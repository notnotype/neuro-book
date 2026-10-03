# Round 285: Schema 来源路径显性化

## Context

目标流程第一步包含“创建 Project，并以命定之诗2为例设置 subject schema”。当前 World Engine 的 schema 真相源已经是 Project Workspace 内的 `world-engine/schema.yaml`，calendar 真相源是 `world-engine/calendar.yaml`；新 Project 模板也会复制这两个文件。

但 Workbench 和独立 Preview 只展示 schema 的类型 / 属性，不直接告诉作者配置文件在哪。作者要把通用模板改成 `ming-ding-zhi-shi-2` 这种项目 schema 时，第一步会先卡在“去哪改 schema”。

## Changes

- `WorldEngineWorkbenchPreviewSidebar.vue`
  - 在主 Workbench 左栏 Schema 区域展示 `world-engine/schema.yaml` 与 `world-engine/calendar.yaml` 路径 chip。
- `WorldEnginePreviewProjectPanel.vue`
  - 在独立 Preview 的 Schema 区域展示同样的 schema / calendar 来源路径。
- `world-engine-ide-entry.test.ts`
  - 补独立 Preview schema 来源路径静态契约。
- `world-engine-workbench-preview.test.ts`
  - 补 Workbench sidebar schema 来源路径静态契约。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是检查 schema 设置入口。实际没有实现完整 schema 编辑器，也没有改后端 schema API；本轮只把当前已存在的文件真相源露到 Workbench / Preview 的 Schema 区域，帮助作者从新 Project 进入 schema 设置流程。
