# 2026-06-20 Editor Inspector Aria Pressed

## Context

前几轮已经补齐 Slice List 和 Sidebar 里多个过滤 / toggle 控件的 `aria-pressed`。继续检查底部 Mutation Editor 和右侧 Inspector 时，发现这些核心工作面板仍有一些高频状态切换只靠视觉样式表达：

- Mutation Editor 顶栏的 `总视图 / subject 视图`。
- Mutation Editor subject 视图里的 touched subject 选择。
- Mutation Editor subject 导航范围：`subject 轨迹 / 过滤组合`。
- Inspector Review Queue 模式：`只看 open / 全部 issue`。
- Inspector State Snapshot 的完整世界展开状态。

这些控件直接影响用户是在“总览所有 mutations”、还是“聚焦单 subject / review queue / state snapshot”中工作；补齐语义能让编辑和检查面板与主画布过滤控件保持一致。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor`：
  - `总视图` 增加 `aria-pressed="view === 'all'"`。
  - `subject 视图` 增加 `aria-pressed="view === 'subject'"`。
  - touched subject 行增加 `aria-pressed="activeSubjectId === subjectId"`。
  - `subject 轨迹` 增加 `aria-pressed="subjectNavigationScope === 'subject'"`。
  - `过滤组合` 增加 `aria-pressed="subjectNavigationScope === 'filter'"`。
- `WorldEngineWorkbenchPreviewInspector`：
  - Review Queue `只看 open` 增加 `aria-pressed="reviewQueueMode === 'open'"`。
  - Review Queue `全部 issue` 增加 `aria-pressed="reviewQueueMode === 'all'"`。
  - State Snapshot 展开按钮增加 `aria-pressed="showFullState"`。
- 静态契约测试补充上述断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 本地页面 HTTP 检查：`http://localhost:3000/world-engine.workbench-preview` 返回 200。

## Browser Verification

- 本轮没有绕过浏览器插件限制。
- 当前 in-app Browser 插件目录仍缺少 skill 要求的 `scripts/browser-client.mjs`，因此不能按规定连接浏览器完成真实视觉验收。
- 后续浏览器插件恢复后，需要补验：
  - Mutation Editor 的视图切换 pressed state 与视觉选中态一致。
  - touched subject 选择与 active subject 同步。
  - subject 导航范围切换后 pressed state 正确。
  - Review Queue `只看 open / 全部 issue` 与 queue 内容一致。
  - State Snapshot 展开完整世界后 pressed state 为 true，收回后为 false。

## Notes

- 本轮仍是 mock-only UI / UX 优化，不接真实 API，不改后端 DTO。
- 这次改动把主画布之外的编辑 / 检查面板也纳入同一套 toggle 语义，减少同一页面里不同面板交互状态表达不一致的问题。
