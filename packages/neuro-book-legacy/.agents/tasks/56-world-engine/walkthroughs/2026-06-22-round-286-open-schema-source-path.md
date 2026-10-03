# Round 286: 从 Workbench 打开 Schema 源文件

## Context

Round 285 已把 `world-engine/schema.yaml` 与 `world-engine/calendar.yaml` 展示到 Workbench / Preview 的 Schema 区域。但作者要真正“设置 subject schema”时，仍需要离开 World Engine Dialog 后自己去文件树找路径。

主 IDE 已有 `openWelcomeWorkspacePath()`，可以切到文件树并打开 Project Workspace 内文件。本轮复用这个现有入口，让 Workbench 的 schema / calendar path chip 直接打开配置文件。

## Changes

- `WorldEngineWorkbenchPreviewSidebar.vue`
  - schema / calendar path chip 改为按钮。
  - 点击后发出 `openWorkspacePath` 事件，参数分别为 `world-engine/schema.yaml` / `world-engine/calendar.yaml`。
- `WorldEngineWorkbenchDialog.vue`
  - 接收 sidebar 的 `openWorkspacePath`。
  - 保存中会阻止打开配置文件。
  - 如果存在 Workbench 会话草稿，会先确认关闭并放弃草稿。
  - 确认后向父页面发出 `openWorkspacePath`，并关闭 Workbench。
- `app/pages/index.vue`
  - 将 `WorldEngineWorkbenchDialog @open-workspace-path` 接到现有 `openWelcomeWorkspacePath()`。
- `world-engine-ide-entry.test.ts`
  - 补从 Dialog 到 `index.vue` 的事件链静态契约。
- `world-engine-workbench-preview.test.ts`
  - 补 sidebar path chip 点击事件静态契约。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是把 schema 设置入口从“知道路径”推进到“能顺手打开”。实际复用了主 IDE 文件树打开能力，没有新增 schema 编辑器，也没有改变 schema/calendar 文件格式或后端 API。
