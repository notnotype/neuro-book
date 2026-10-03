# 2026-06-29 Round 10 - Chapter Writer Brief API Contract

## Scope

本轮把 `get_chapter_writer_brief` 从概念设计推进到 API / OpenAPI / Agent tool 合同。目标是降低 Agent 手动串 Plot + Scene World Context + Thread summary 的成本，同时不让 Plot 成为动态状态源。

本轮不修改业务代码。

## Current Evidence

现有 Plot API handler：

- `GET /api/projects/plot/chapter?projectPath=...&chapterPath=...` 返回章节 Scene 列表。
- `GET /api/projects/plot/scenes/:sceneId/world-context?projectPath=...` 返回单 Scene 的 World Engine context。

现有 Agent Plot tools：

- `get_chapter_plot`
- `get_story_scene_context`
- `get_scene_world_context`
- Thread / Scene create/update tools

当前缺口：没有一个只读聚合入口能一次返回“某章可交给 writer 的 Plot + World Engine brief”。leader 或 director 需要手动多次调用工具并自行判断 warning。

## Proposed Route

推荐新增：

```text
GET /api/projects/plot/chapter-writer-brief?projectPath=...&chapterPath=...
```

不推荐放在 `GET /api/projects/plot/chapter/writer-brief`，因为现有 catch-all handler 已有 `chapter` 分支。`chapter-writer-brief` 是独立 segment，路由判断更直接。

## Proposed DTO

放在 `shared/dto/plot.dto.ts`：

```ts
export const ChapterWriterBriefStatusSchema = z.enum([
    "ready",
    "needs_plot",
    "needs_world_anchor",
    "needs_world_context",
]);

export const ChapterWriterBriefWarningDtoSchema = z.object({
    sceneId: z.string().optional(),
    severity: z.enum(["info", "warning", "blocking"]),
    code: z.enum([
        "chapter_has_no_scenes",
        "scene_missing_summary",
        "scene_missing_world_time",
        "scene_missing_subjects",
        "scene_has_unresolved_subjects",
        "world_context_empty",
        "world_context_query_failed",
    ]),
    message: z.string(),
});

export const ChapterWriterBriefSceneDtoSchema = z.object({
    sceneId: z.string(),
    title: z.string(),
    order: z.number().int().nonnegative(),
    threadId: z.string(),
    threadTitle: z.string(),
    threadSummary: z.string(),
    summary: z.string(),
    purpose: z.string().nullable(),
    writingTip: z.string().nullable(),
    worldAnchor: StorySceneWorldAnchorDtoSchema,
    worldContext: SceneWorldContextDtoSchema.nullable(),
});

export const ChapterWriterBriefDtoSchema = z.object({
    chapterPath: z.string(),
    status: ChapterWriterBriefStatusSchema,
    scenes: z.array(ChapterWriterBriefSceneDtoSchema),
    worldQueryHints: z.array(z.string()),
    warnings: z.array(ChapterWriterBriefWarningDtoSchema),
    suggestedBriefMarkdown: z.string(),
});
```

## Service Contract

新增：

```text
server/plot/services/chapter-writer-brief.service.ts
```

职责：

- 读取 `chapterPath` 下 Scene 顺序。
- 批量读取 parent Thread summary。
- 复用 `SceneWorldAnchorResolutionService.resolveMany()`。
- 对可查询 Scene 调 `SceneWorldContextService.getSceneWorldContext()`。
- 生成 status、warnings、worldQueryHints、suggestedBriefMarkdown。

不负责：

- 写 World Engine。
- 写 Plot。
- 写 Chapter Override。
- 调用 writer。
- 替用户确认 canon。

## Status Decision Rules

- `needs_plot`：章节无 Scene，或关键 Scene 缺 summary。
- `needs_world_anchor`：存在需要世界上下文的 Scene，但缺完整时间范围或缺 subjects/location。
- `needs_world_context`：存在 unresolved subjects，或 World Context 查询失败。
- `ready`：Scene 结构可用；已连接 World Engine 的 Scene context 查询成功；允许 info 级 warning。

如果多个状态同时命中，按阻塞优先级返回：

```text
needs_plot > needs_world_anchor > needs_world_context > ready
```

## Agent Tool Contract

新增工具：

```text
get_chapter_writer_brief
```

参数：

```ts
{
    projectPath: string;
    chapterPath: string;
}
```

返回：

- `content[0].text`：JSON 格式，便于 Agent 直接看。
- `details`：`ChapterWriterBriefDto`。

第一期建议只给 `director` profile 暴露该工具。`leader.default` 暂不直接加 Plot tools；leader 需要时 invoke director，director 通过该 brief 返回 `writer_handoff`。

## OpenAPI Contract

`server/openapi/route-map.ts` 需要新增同一个 catch-all route entry：

- `file: "projects/plot/[...segments].ts"`
- `method: "get"`
- `tags: ["Plot Scenes"]` 或新增 `["Plot Briefs"]`
- `summary: "Get a chapter writer brief assembled from Plot scenes and World Engine context"`
- `queryParams`: projectPath + chapterPath
- `responseBody: ChapterWriterBriefDtoSchema`

注意：当前 route-map 已有同一 file/method 的 world-context entry。生成器若不能区分同一 catch-all 的多语义 entry，需要先确认它是否允许重复 file/method。若不允许，应扩展 route meta 的 path pattern 描述，而不是强行只放一个 schema。

## Tests Needed

- `server/plot/services/chapter-writer-brief.service.test.ts`
  - 章节无 Scene。
  - Scene 缺 summary。
  - Scene 缺时间。
  - Scene 有 unresolved subjects。
  - Scene context 查询成功。
  - 单个 Scene context 查询失败不吞掉整章，返回 per-scene warning。
- `server/agent/tools/plot-tools.test.ts`
  - `get_chapter_writer_brief` 调 facade 并返回 details。
- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director tool keys 包含 `get_chapter_writer_brief`。
  - director prompt 明确 brief 是 writer handoff 素材，不是 World Engine 裁决。
- OpenAPI / route-map 相关测试：
  - schema 能生成。
  - catch-all route 不覆盖已有 `world-context` entry。

## Design Decision

`get_chapter_writer_brief` 应作为 P2，只读聚合层落地。它的价值不在于新增状态，而在于把 Agent 需要重复执行的“章节 Scene → World Anchor → World Context → writer handoff”路径固化成一个可测试合同。

