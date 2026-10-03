# 2026-06-21 Subject System Summary UI

## Summary

- 继续优化 `ming-ding-zhi-shi-2` 的真实主体系统适配。
- 上一轮已把 World Engine 当前 state 收口为“拓扑 + 来源 + 计数”，但真实 Workbench 左栏和 Inspector 仍需要用户展开 JSON 才能理解主体系统接入状态。
- 本轮在真实三栏 Workbench 中新增主体系统摘要展示：左栏能扫到哪些 subject 已接入 `simulation/subjects`，右侧 Inspector 能看到六文件拓扑、actor import、leader-only、direct state 和 RAG 来源。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - 新增 `worldWorkbenchSubjectSystemAttrs`，列出真实页面窄查询所需的主体系统字段。
  - 新增 `buildWorldWorkbenchSubjectSystemSummaries()`，从 `SubjectStateDto.attrs` 提取路径、来源、计数和版本；只解释已有 state attrs，不读取任何主体源文件。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 加载 schema / subjects / slices 后，额外调用 `/api/projects/world-engine/state/query`：
    - `body: { type: "character", attrs, listLimit }`
    - 只取 `sourcePath / legacyKind / controlledBy / profile / canonicalSource / subjectFiles / actorImportPath / leaderOnlyPath / directStatePath / ragIndexSources / eventCount / memoryCount / subjectSystemVersion`。
  - 把 `subjectSystemSummaries` 下发给左栏与 Inspector。
- `WorldEngineWorkbenchPreviewSidebar.vue`
  - subject 行新增“主体系统”接入 badge。
  - 显示 `eventCount` / `memoryCount`，搜索也能命中 source path / actor import / leader-only / direct state / RAG 来源。
- `WorldEngineWorkbenchPreviewInspector.vue`
  - 新增 `Subject System` 摘要区，位于 Touched Subjects 和 State Snapshot 之间。
  - 展示当前切片触及主体的：
    - actor import
    - leader only
    - direct state
    - RAG sources
    - events / memory counts
  - 标记 `path only`，强调这里只显示路径拓扑和摘要，不显示源文件全文。
- `world-engine-workbench-preview.types.ts`
  - 新增 preview-only 的 `WorldWorkbenchPreviewSubjectSystemSummary` 与 path 类型。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`
- 浏览器验收：
  - 打开 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`，进入 Header `WORLD`。
  - 左侧 Subjects 显示 6 个 character 的“主体系统” badge，以及 events / memory 计数。
  - 右侧 Inspector 在 State Snapshot 前显示 `SUBJECT SYSTEM` 摘要区。
  - 摘要区显示 `actor import / leader only / direct state / RAG` 路径和 `path only` 标记。
  - 页面不显示 `当前 schema 缺少示例所需类型`。
  - 截图保存在 `.agent/workspace/world-engine-subject-system-summary-ui.png`。

## Notes

- 本轮不改后端 DTO / API，不新增通用 `simulation/subjects -> World Engine` 迁移入口。
- 摘要来源仍是 World Engine 当前 state；Project Workspace 文件继续是 `simulation/subjects` 的事实源。
- 这让真实 Workbench 更像当前 Project 的主体系统检查台，而不是只显示通用 World Engine subject 列表。
