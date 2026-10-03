# 2026-06-30 Round 48 - Chapter Path And Writer Target Contract

## Scope

本轮核对 `chapterPath` 与 writer 写入目标的边界。目标是避免 `get_chapter_writer_brief` 把 Plot 章节路径、Project Workspace 路径和 writer 文件路径混成一个字段。

本轮不修改业务代码。

## Evidence

当前 Plot API / tool 的 `chapterPath` 语义：

- `shared/dto/plot.dto.ts` 把 `chapterPath` 定义为章节 content-node path；`null` 表示 Scene 未挂入具体章节。
- `server/api/projects/plot/[...segments].ts` 的 `requireChapterPathQuery()` 只做 trim 和非空检查。
- 真正归一化和存在性校验在 `PlotScopeGuard.assertChapterPath(projectPath, chapterPath)`：
  - 接受 `manuscript/...`。
  - 接受 `project-slug/manuscript/...`。
  - 接受 `workspace/project-slug/manuscript/...`。
  - 最终归一成 Project Workspace 内部的 `manuscript/.../`。
  - 必须位于 `manuscript/` 下，必须以 `/` 结尾，必须是真实存在且 entryType 为 `chapter` 的目录。
- `SceneService.getChapterPlotDetailDto()` 先调用 `assertChapterPath()`，再用归一化后的 path 查询 `findChapterScenes()`。
- `PrismaSceneRepository.findChapterScenes()` 按 `chapterPath` 精确匹配，并按 `chapterSortOrder, id` 排序。
- Agent plot tool `get_chapter_plot` 输入是 `{ projectPath, chapterPath }`，description 中例子为 `manuscript/001-opening/`。

writer 合同不同：

- writer 的实际写入目标由 `invoke_agent.input.path` 决定。
- 该 path 是文件工具使用的 workspace 相对 Markdown 文件路径，典型是 `project-slug/manuscript/.../index.md`。
- Round 22 已规定 `suggestedBriefMarkdown` 可以说明目标章节，但不能把 brief 内的章节信息变成第二写入源。

## Contract

`get_chapter_writer_brief` v1 输入应保持：

```ts
{
    projectPath: string;
    chapterPath: string;
}
```

不要新增 `writerPath` / `targetPath` / `indexPath` 输入字段。原因：

- Plot 的权威章节定位是 content-node 目录 `chapterPath`。
- writer 的权威写入定位是调用 writer 时的 `invoke_agent.input.path`。
- 两者属于不同 profile 调用层，混在 brief tool 输入中会制造第二写入真相源。

`ChapterWriterBriefDto.chapterPath` 应返回归一化后的 `manuscript/.../`，以便 director/leader 看到同一规范值。

`suggestedBriefMarkdown` 可以写：

- `目标章节：manuscript/.../`
- `正文写入目标由调用 writer 时的 input.path 指定`

但不要写：

- `请写入 manuscript/.../index.md`
- `writerPath: ...`
- 自动推导出来的文件路径字段

## Implementation Implication

Brief service 不应在 HTTP 层重写 `chapterPath` 校验。推荐路线：

1. 在 service 内调用 `PlotScopeGuard.assertChapterPath(projectPath, chapterPath)`。
2. 使用返回的 normalized chapter path 查询章节 Scene。
3. DTO 只返回 normalized `chapterPath`。
4. markdown 明确 `input.path` 才是 writer 写入目标。

如果未来 UI 想提供“复制 writer target path”之类便捷功能，应放在 UI helper 或单独转换函数，不进入 brief service 的业务合同。

## Result

`chapterPath` 是 Plot/Chapter ordering 的 Project Workspace 内部章节目录；writer `input.path` 是正文写入文件目标。`get_chapter_writer_brief` 只接受前者，生成 writer message 草案时只提醒后者由调用方提供，避免 brief tool 变成隐式写入路由器。

