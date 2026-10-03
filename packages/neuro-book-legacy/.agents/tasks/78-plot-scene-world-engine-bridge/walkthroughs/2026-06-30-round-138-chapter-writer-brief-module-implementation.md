# Round 138: Chapter Writer Brief Module Implementation

## Scope

本轮完成 Slice 3 `Chapter Writer Brief Module`。目标是在 Plot 模块内新增一个只读深 Module，把 `projectPath + chapterPath` 聚合为可给 writer 的 Scene / World Context brief，而不是让 Agent tool 层手动串 Plot 与 World Engine。

本轮修改了 DTO、repository read model、Scene World Context helper、brief service、facade、HTTP route、OpenAPI route-map 和聚焦测试。没有进入 Slice 4 `Agent Tool Binding`。

## Files Changed

### DTO

- `shared/dto/plot.dto.ts`
  - 新增 `ChapterWriterBriefStatusSchema`：`ready | needs_plot | needs_world_anchor | needs_world_context`。
  - 新增 `ChapterWriterBriefSceneDtoSchema`，显式包含：
    - Scene `writingTip`
    - Thread `summary`
    - Thread `writingTip`
    - `worldAnchor`
    - nullable `worldContext`
    - per-scene `warnings`
  - 新增 `ChapterWriterBriefDtoSchema`，必含 `suggestedBriefMarkdown`。

### Read Model / Repository

- `server/plot/core/types.ts`
  - 新增 `ChapterWriterBriefSceneWithThread` read model 类型。

- `server/plot/contracts/plot-repositories.ts`
  - `SceneRepository` 新增 `findChapterScenesForBrief(chapterPath)`。

- `server/plot/repositories/prisma-scene.repository.ts`
  - 新增 `findChapterScenesForBrief()`，按 chapter order 取 Scene，并一次 select Thread `title/isMainThread/summary/writingTip`。
  - 没有扩胖 UI 用的 `findChapterScenes()` / `ChapterPlotDetailDto`。

### Scene World Context Helper

- `server/plot/services/scene-world-context.service.ts`
  - 保留 HTTP strict 方法 `getSceneWorldContext(projectPath, sceneId)`。
  - 新增实体级 helper `getSceneWorldContextForScene(projectPath, scene)`，供 brief service 复用查询 Implementation。
  - brief service 先主动判断 missing anchor，不通过捕获 HTTP strict 错误文本判定 status。

### Brief Service / Facade / HTTP

- `server/plot/services/chapter-writer-brief.service.ts`
  - 新增 `ChapterWriterBriefService`。
  - status precedence：
    - no scenes -> `needs_plot`
    - missing start/end instant -> `needs_world_anchor`
    - unresolved subject 或 world context 查询失败 -> `needs_world_context`
    - otherwise -> `ready`
  - `suggestedBriefMarkdown` renderer 放在 service implementation 内，tool/HTTP 不拼接 markdown。
  - Markdown 输出 Scene、Thread、World slices 和 subject state names；不输出 raw attrs dump 或 raw patch JSON。

- `server/plot/facade/plot.facade.ts`
  - `PlotModule` 接入 `ChapterWriterBriefService`。
  - 新增 `PlotFacade.getChapterWriterBrief(projectPath, chapterPath)`。

- `server/api/projects/plot/[...segments].ts`
  - 新增 `GET /api/projects/plot/chapter-writer-brief?projectPath=&chapterPath=` branch。

### OpenAPI

- `server/openapi/route-map.ts`
  - 新增 `GET projects/plot/chapter-writer-brief` logical operation。
  - `emitRouteMeta: false`，canonical spec 记录该 operation，route-local representative 仍是 world-context。

- `server/openapi/generate-spec.test.ts`
  - 真实 route-map 断言新增 `/api/projects/plot/chapter-writer-brief`，query params 为 `projectPath/chapterPath`。

## Tests

- `server/plot/services/chapter-writer-brief.service.test.ts`
  - 覆盖 `ready`、`needs_plot`、`needs_world_anchor`、`needs_world_context`。
  - 断言 markdown 包含 Scene/Thread/World Context 关键字段。
  - 断言 markdown 不含 raw attrs / `"hp"` / `POV` / `tone` / `do-not-reveal`。

- `server/api/projects/plot/[...segments].test.ts`
  - 新增 HTTP route 测试：真实创建 Project、chapter path、Thread、World Slice、Scene，然后调用 `chapter-writer-brief` 返回 ready brief。

## Verification

### Focused Combined Tests

命令：

```powershell
bun vitest run server/openapi/generate-spec.test.ts server/openapi/generate-openapi-meta.test.ts server/plot/services/chapter-writer-brief.service.test.ts "server/api/projects/plot/[...segments].test.ts"
```

结果：

- 4 test files passed。
- 21 tests passed。

### DTO Test

命令：

```powershell
bun vitest run shared/dto/plot.dto.test.ts
```

结果：

- 1 test file passed。
- 2 tests passed。

### Metadata Generation

命令：

```powershell
bun run generate:openapi
```

结果：

- `Generating OpenAPI meta for 40 route files from 61 route entries...`
- `Done. 40 routes updated, 0 failed.`

## Actual Result / Plan Delta

计划是新增 `ChapterWriterBriefDtoSchema`、`findChapterScenesForBrief()`、Scene 实体级 World Context helper、`ChapterWriterBriefService`、facade、HTTP route 和 OpenAPI entry。实际结果符合计划。

实现中保持了既定边界：

- 没有扩胖 `ChapterPlotDetailDto`。
- 没有通过捕获 `getSceneWorldContext()` 的错误 message 判定 status。
- `suggestedBriefMarkdown` 是 service 内部 renderer，不散落到 HTTP/tool adapter。
- `chapter-writer-brief` OpenAPI entry 标记 `emitRouteMeta: false`，没有破坏 world-context route-local representative。

本轮没有做 Agent tool binding，也没有 profile compiled artifact 验证；这些属于 Slice 4。

## Remaining Work

下一步进入 Slice 4 `Agent Tool Binding`：

1. 新增 `get_chapter_writer_brief` runtime tool。
2. 注册到 `server/agent/tools/index.ts`。
3. 新增 typed binding `builtin.plot.getChapterWriterBrief`。
4. director toolset 暴露该 tool。
5. writer 继续无 Plot tools。
6. 验证 `get_agent_profile` 的 director `toolKeys`、runtime tool result `content[0].text = suggestedBriefMarkdown`、`details = ChapterWriterBriefDto`，并检查 compiled artifacts。
