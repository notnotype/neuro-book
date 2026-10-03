# 2026-06-30 Round 49 - Brief Status Precedence

## Scope

本轮细化 `get_chapter_writer_brief` v1 的状态聚合优先级。目标是让实现时遇到“无 Scene、缺 anchor、unresolved subject、World Context 查询失败、空查询结果”这些情况时有确定判断。

本轮不修改业务代码。

## Evidence

当前 World Context 查询语义：

- `SceneWorldContextService.getSceneWorldContext()` 在 Scene 缺 `startInstant/endInstant` 时抛 400：`Scene 尚未设置完整 World Engine 时间范围`。
- 没有任何 subject/location subject 时返回空 `slices/subjectStates/unresolvedSubjectIds`。
- subject 全部 unresolved 时返回空 `slices/subjectStates`，并返回 `unresolvedSubjectIds`。
- 有 resolved subject 时按 Scene 时间范围查询 `listSlices({from,to,subjectIds,subjectMode:"any"})`，并在 `endInstant` 查询 subject state。
- `SceneWorldAnchorResolutionService` 已统一把 unresolved subject 暴露到 Scene DTO；缺 `calendar.ts` 时 Plot 聚合读取只降级 formatted time，坏 calendar 继续抛错。

Round 26 / Round 31 已定：

- 无 Scene 或 Scene 缺可写作摘要时是 `needs_plot`。
- 缺完整时间范围是 `needs_world_anchor`。
- World Engine 查询失败、全部需要查询的 subject unresolved、坏 calendar 是 `needs_world_context`。
- 部分 unresolved subject 可以是 `ready`，但必须进入 warnings。

## Precedence

`ChapterWriterBriefService` v1 推荐按以下优先级聚合状态：

1. **路径非法或章节不存在**：直接抛 HTTP/service error，不包装成 status。
2. **`needs_plot`**：归一化章节存在，但没有 Scene；或关键 Scene 缺少 summary/purpose，无法形成 writer 可执行剧情框架。
3. **`needs_world_anchor`**：存在可写 Scene，但任一关键 Scene 缺完整 `startInstant/endInstant`；或 Scene 明显需要 World Engine 查询却没有任何 subject/location anchor。
4. **`needs_world_context`**：anchor 形状足够，但 World Engine 查询失败；或某个关键 Scene 的所有待查询 subject 都 unresolved；或 calendar/schema 配置导致不能可靠查询。
5. **`ready`**：Scene 顺序、剧情摘要、World Anchor 和 World Context 查询均足以生成 writer handoff。

优先级的核心原则：先判断 Plot 能不能形成章节剧情，再判断 Scene 是否已连接 World Engine，最后判断 World Engine 是否能返回可靠上下文。

## Empty Context Is Not Always Failure

这些情况可以不降级为失败，但必须写 warning：

- Scene 有完整时间范围和 resolved subjects，但查询到 0 个相关 slices。
- Scene 有部分 unresolved subjects，但仍有 resolved subjects 可查询。
- `subjectStates` 为空，但 `worldQueryHints` 足以让 writer 用 readonly `execute_world` 自查。

这些情况应降级：

- Scene 没有时间范围：`needs_world_anchor`。
- Scene 需要查询但没有任何 subject/location：`needs_world_anchor`。
- Scene 的 subject 全部 unresolved：`needs_world_context`。
- World Engine facade 抛出配置或查询错误：`needs_world_context`。

## Markdown Behavior

`suggestedBriefMarkdown` 无论 status 是什么都应可读，但不同 status 下用途不同：

- `ready`：可作为 writer message 草案。
- `needs_plot`：给 director 补 Plot 的 TODO。
- `needs_world_anchor`：给 director/leader 补时间和 subject 的 TODO。
- `needs_world_context`：给 leader/world.engine 修复 World Engine 的 TODO。

非 `ready` 时 markdown 第一屏必须明确状态和阻塞原因，避免 leader 误把它直接发给 writer。

## Result

brief v1 的 status 不应由最后一个错误覆盖前面的结构性缺口。实现时采用固定优先级：path error -> `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready`。空 World Context 可以是 warning，不能机械等同失败；但全部 unresolved 和查询错误必须阻断 writer handoff。

