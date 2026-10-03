# Round 23 Calendar-free Plot Read

## Context

本轮修复 Plot 聚合读取对 World Engine `calendar.ts` 的强依赖。

真实回归不是 Scene World Anchor DTO 本身，而是 Plot 为了把 `subjectIds/locationSubjectId` 显示成 subject name，无条件调用 `worldEngineFacade.listSubjects()`。该入口会构建完整 `WorldEngineService` module，并加载 schema 与 calendar。旧 Project 或尚未初始化 World Engine 的 Project 缺少 `world-engine/calendar.ts` 时，用户即使只打开 Plot tree/workbench，也会被 World Engine calendar 配置错误挡住。

## Decision

采用用户确认的错误策略：

- Plot 聚合读取遇到缺失 `world-engine/calendar.ts` 时降级。
- raw `startInstant/endInstant` 必须保留，`startTime/endTime` 置为 `null`。
- subject identity 读取不能加载 schema/calendar。
- `calendar.ts` 存在但损坏，且当前读取需要格式化 raw instant 时继续抛错。
- `get_scene_world_context` 仍是实际 World Engine 查询能力；当需要 slices/state/time format 时保留 World Engine 配置错误语义。

## Implementation

- `worldEngineFacade.listSubjectIdentities(projectPath, {ids?, type?})`
  - 只初始化 Project SQLite。
  - 只创建 libsql client 与 `WorldEngineRepository`。
  - 只读 `WorldSubject` 表。
  - 不加载 schema/calendar，不做 reduce。
- `SceneWorldAnchorResolutionService`
  - 批量解析 `subjects/locationSubject/unresolvedSubjectIds`。
  - 使用 `listSubjectIdentities()` 判断 resolved/unresolved。
  - 格式化 `startInstant/endInstant` 时只对缺失 calendar 降级；坏 calendar 继续抛错。
- `PlotFacade`
  - `getPlotTree/getPlotWorkbench/getStoryThreadDetailDto/getStorySceneDetailDto/getChapterPlotDetailDto` 改用独立 resolution service。
  - 创建、更新、重排后的展示解析仍保持在事务提交后。
- `SceneWorldContextService`
  - resolved/unresolved 筛选改用 calendar-free identity。
  - 真实 slices/state/time 查询仍使用 World Engine 正式接口。
- 前端 Scene Card / Row 的连接态同时检查 `startTime/endTime/startInstant/endInstant/subjectIds/locationSubjectId`。

## Verification Plan

- 新增 `scene-world-anchor-resolution.service.test.ts` 覆盖 subject/location 解析、缺 calendar 降级、坏 calendar 抛错。
- 扩展 `server/api/projects/plot/[...segments].test.ts` 覆盖无 calendar Project 的 tree/workbench 读取、占位 subject unresolved、raw instant 保留和坏 calendar 抛错。
- 保留 Scene World Context 测试，确认全部 unresolved 时不查询 slices/state，resolved subject 存在时仍走 World Engine 正式查询路径。

## Actual Delta

本轮不恢复 `StoryPlot / Plot Beat`，不实现 `ChapterOverride`，不改变 World Engine 正式 HTTP/API 的 `listSubjects()` 语义。新增的 `listSubjectIdentities()` 是内部桥接入口，只解决 Plot 读取不应依赖 calendar 的问题。
