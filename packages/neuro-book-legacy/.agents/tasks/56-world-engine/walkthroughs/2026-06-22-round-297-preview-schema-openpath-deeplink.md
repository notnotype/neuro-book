# Round 297 - Preview Schema OpenPath Deeplink

## 背景

继续从作者真实流程检查 `/world-engine.preview` 时，发现“新建 Project 后设置 subject schema”这一步仍然偏断裂。

主 IDE Workbench 左栏的 `world-engine/schema.yaml` / `world-engine/calendar.yaml` 路径 chip 已经可以打开 Project Workspace 文件，但独立 Preview 只把这两个路径显示成静态标签。作者在 Preview 里创建 Project 后，看得到应该改哪个文件，却不能直接跳去编辑它。

## 实际变更

- `WorldEnginePreviewProjectPanel.vue`
  - 新增 `buildIdeOpenPathHref(path)`。
  - Schema / Calendar 路径 chip 从静态 `span` 改成链接。
  - 链接会打开主 IDE 深链：`/?project=<projectPath>&openPath=<world-engine/schema.yaml|world-engine/calendar.yaml>`。

- `app/pages/index.vue`
  - 新增 `consumeWorkspaceOpenPathFromRoute()`。
  - 主 IDE 在首次初始化、Project route 同步完成，以及同一 Project 下 `openPath` query 变化时，会打开对应 Project Workspace 文件。
  - 打开后会清理 `openPath` query，避免重复消费。
  - Project 切换仍走既有 World Engine 草稿保护与普通 workspace 未保存文件确认。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview 生成 `openPath` 深链，主 IDE 消费 `route.query.openPath`。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有实现 schema 可视化编辑器；仍复用 Project Workspace 文件编辑作为 schema 设置正门。
- 本轮没有自动浏览器验证，符合当前约定。
- 本轮补的是作者路径里的第一步衔接：Preview 新建 Project 后，可以直接跳到主 IDE 打开 `world-engine/schema.yaml` / `world-engine/calendar.yaml`。
