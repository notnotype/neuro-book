# 2026-06-29 Goal File Current State Audit

## Trigger

- 本轮开始前读取了 Codex goal objective 附件：`C:\Users\notnotype\.codex\attachments\5582535b-b098-424e-b0a1-f47e03aaabfb\goal-objective.md`。
- 附件目标是继续实现 Task 78：Plot Scene / World Engine Bridge。
- 当前仓库状态显示 Task 78 已标记为 Implemented，因此本轮先做当前状态审计，不直接改业务代码。

## Evidence Read

- `PROJECT-STATUS.md`：确认 Plot System 已收敛为 Scene-only 桥接层，`StoryPlot / Plot Beat` 不再是正式模型。
- `docs/tasks/78-plot-scene-world-engine-bridge/README.md`：确认任务合同、实施记录、测试记录已覆盖 Scene World Anchor、StoryPlot 删除、World Context API、Workbench UI 和入口复验。
- `reference/plot/system.md`：确认稳定 reference 已定义 Scene World Anchor、`GET /api/projects/plot/scenes/:sceneId/world-context`、Agent 工具和消费顺序。
- `reference/world-engine/README.md`：确认 World Engine 仍是动态世界状态与时间线唯一真相源。
- 关键实现文件：
  - `prisma/project.schema.prisma`
  - `shared/dto/plot.dto.ts`
  - `server/plot/core/types.ts`
  - `server/plot/facade/plot.facade.ts`
  - `server/plot/services/scene-world-anchor.validator.ts`
  - `server/plot/services/scene-world-context.service.ts`
  - `server/api/projects/plot/[...segments].ts`
  - `server/agent/tools/plot-tools.ts`
  - `server/workspace-files/project-workspace.ts`
  - `app/components/novel-ide/plot/workbench/*`
  - `app/utils/novel-writing-mode-entries.test.ts`

## Current Findings

- Scene World Anchor 已落库：`startInstant/endInstant/subjectIdsJson/locationSubjectId` 存在于 Project Prisma schema，并在迁移代码里幂等补列。
- DTO / Facade 已按项目日历字符串解析和格式化，服务层保持 `Instant = bigint`。
- `SceneWorldContextService` 已按 Scene 时间范围 + subject/location 查询 World Engine slices 和 subject states，并过滤无关 patches。
- HTTP API 已提供 `GET /api/projects/plot/scenes/:sceneId/world-context`。
- Agent tools 已提供 `get_scene_world_context`，`create_story_scene/update_story_scene` 支持 `worldAnchor`。
- `create_story_plot/create_story_plots/update_story_plot` 只剩历史任务文档、迁移代码和测试语境；正式 tools / schema / UI 未继续暴露。
- Plot Workbench Inspector、Subject 选择器、WorldEngineContextPanel、SceneCard 已接入 World Engine 连接和上下文预览。
- Plot 入口契约测试覆盖顶栏、侧栏、Plot 面板入口和 Plot World Context 打开 World Engine Workbench 的事件链。

## Verification Run

命令：

```powershell
bunx vitest run server/plot/services/scene-world-context.service.test.ts server/workspace-files/project-workspace.test.ts server/agent/tools/plot-tools.test.ts app/utils/novel-writing-mode-entries.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"
```

结果：

- 4 个测试文件通过。
- 13 个测试通过。

覆盖面：

- Scene World Context 查询收窄、未连接时间错误、空 subject 行为。
- 旧 `StoryPlot` 真实 SQLite 迁移：备份、合并到 Scene、删除旧表、清理 `plot://` ref。
- Agent Plot tools：World Anchor 输入、`get_scene_world_context`、`plot.selection` project scope。
- 前端写作入口：Plot 入口可见、World Context 跳转 World Engine Workbench。

## Result

- 当前证据支持 Task 78 的目标已经在当前 worktree 中完成。
- 本轮未发现需要补业务代码的缺口。
- 本轮实际补齐了 Task 78 缺失的 `walkthroughs/` 轮次记录目录和审计记录。
- 本轮补齐了 README 中显式的架构选型对比：A Plot 独立保存状态、B Plot 直接引用 World Slice/Patch、C Scene World Anchor 桥接、D Chapter 驱动桥接、E Agent Profile/Prompt 编排桥接；最终确认采用 C，保留 D 作为后续 writer-facing 生成层。

## Remaining Notes

- Task 79 Profile Build System 是独立任务，已经有自己的 `walkthroughs/` 和宏观架构设计记录；本轮不把 Task 78 的审计内容混入 Task 79。
- 本轮没有自动浏览器验证；只运行了聚焦单元/契约测试。Task 78 README 中保留了此前浏览器验证记录。
