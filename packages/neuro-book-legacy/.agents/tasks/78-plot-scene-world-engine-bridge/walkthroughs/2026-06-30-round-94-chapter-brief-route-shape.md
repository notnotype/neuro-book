# Round 94: Chapter Brief Route Shape

## Scope

本轮复查 Project Plot catch-all HTTP route，确认 `get_chapter_writer_brief` 对应 HTTP API 的最小一致形状。

## Evidence

- `server/api/projects/plot/[...segments].ts` 统一使用 query `projectPath`，由 `requireProjectPathQuery(event)` 校验。
- 当前章节 Plot 读取是 `GET /api/projects/plot/chapter?projectPath=...&chapterPath=...`，不是 `/chapters/:id` path segment。
- `requireChapterPathQuery(event)` 只做 query 非空校验，业务路径归一化和存在性校验下沉到 `PlotScopeGuard.assertChapterPath(projectPath, chapterPath)`。
- `SceneService.getChapterPlotDetailDto()` 已复用 `assertChapterPath()`，返回 normalized `chapterPath`。
- `PlotScopeGuard.assertChapterPath()` 支持三种输入：
  - `manuscript/.../chapter/`
  - `<project-slug>/manuscript/.../chapter/`
  - `workspace/<project-slug>/manuscript/.../chapter/`
  并要求最终路径位于 `manuscript/`、以 `/` 结尾、真实存在且是 chapter content-node。

## Route Recommendation

brief v1 的 HTTP route 应沿用现有 Project Plot API 风格：

```text
GET /api/projects/plot/chapter-writer-brief?projectPath=workspace/<project>&chapterPath=manuscript/<volume>/<chapter>/
```

理由：

- 与现有 `GET /api/projects/plot/chapter` 同层，都是 chapterPath query 驱动的只读聚合。
- 避免把 `chapterPath` 放进 path segment 后再处理 `/` 转义问题。
- HTTP handler 只负责 query 非空；service 继续使用 `PlotScopeGuard.assertChapterPath()` 做业务归一化和 404/400 语义。
- OpenAPI explicit path 可以表达为 `/api/projects/plot/chapter-writer-brief`，query params 包含 `projectPath/chapterPath`；不需要 path params。

## Collision Check

当前 catch-all route 顶层 dispatch 已占用：

- `story`
- `tree`
- `workbench`
- `chapter`
- `phases`
- `threads`
- `scenes`

新增 `chapter-writer-brief` 不与现有 segment 冲突。它应放在 `chapter` 附近，且早于 `phases/threads/scenes` 分支无实际影响，因为 segment 不相同。

## Test Implication

Slice 3/4 相关测试应覆盖：

- 缺 `projectPath` 返回现有 `projectPath query 不能为空`。
- 缺 `chapterPath` 返回 `chapterPath query 不能为空` 或 brief 专属等价信息。
- 非 manuscript 路径、卷目录、缺失章节继续走 `PlotScopeGuard.assertChapterPath()` 的既有错误语义。
- valid chapterPath 返回 normalized `chapterPath`，不要把 `workspace/<project>/...` 原样带入 brief DTO。

## Conclusion

brief route 不需要发明新的 path 语义。最小系统性做法是沿用 `projectPath + chapterPath query` 的现有 Project Plot API contract，把深校验留给 `PlotScopeGuard`。
