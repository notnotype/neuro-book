# 2026-06-20 Subject Activity Stats

## Scope

本轮继续推进 `/world-engine.workbench-preview` 的 mock UI/UX，不接真实 API，不改后端 DTO。重点优化左侧 `Subjects` 列表：让用户在进入单 subject 视角前，就能判断每个 subject 的活跃度、最近出现时间和 review 风险。

## Finding

当前左侧列表已经能搜索、按 type 过滤和多选 subject，但它只展示 subject 身份：

- name
- id
- type

从用户视角看，单 subject 查看是高频路径，但用户需要先点 subject 才知道它是否有足够多的切片、最近是否还活跃、是否带 review issue。对于世界切片工作台，subject 行应该同时是“身份列表”和“timeline 导航索引”。

## Changes

- 新增 `WorldWorkbenchPreviewSubjectStat` 类型，保持在 preview 类型边界内，不修改真实 DTO。
- route 页面新增 `subjectStats` computed，从当前 mock `slices` 推导：
  - `sliceCount`
  - `mutationCount`
  - `issueCount`
  - `latestTime`
  - `latestKind`
- `WorldEngineWorkbenchPreviewSidebar` 新增 `subjectStats` prop。
- 左侧顶部新增紧凑汇总：
  - `active` subject 数。
  - `review` subject 数。
- subject 行新增 activity 信息：
  - 最近出现时间。
  - 最近 slice kind。
  - mutation 总数。
  - issue 数，存在 issue 时使用 warning 样式。
- subject 搜索现在也会匹配 `latestTime / latestKind`，方便按时间或 kind 快速定位。
- 目标测试补充静态契约，覆盖 `WorldWorkbenchPreviewSubjectStat`、`subjectStats`、`subjectStatMap`、`activeSubjectCount`、`reviewSubjectCount`、`latestTime`、`mutationCount` 和 `issueCount`。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 刷新页面并点击 `重置 mock`，避免本地草稿影响基线。
  - 左侧显示 `active 6 subjects`。
  - 左侧显示 `review 1 subjects`。
  - `旧剑` 行显示：
    - `C03:24:30`
    - `event`
    - `7 mut`
    - `1 issue`
  - 点击 `旧剑` subject 后，顶栏显示 `Subject 过滤：旧剑`。
  - Slice List 显示 `5 / 6 slices · 21 mutations`。
  - Subject filter chip 显示 `旧剑 / item`。
  - 页面没有横向溢出。
- dev logs 仍只有 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没发现阻断当前页面挂载、subject stats 展示或 subject 过滤的新错误。

## UX Review

- 左侧 subject 列表现在更像一个世界索引：用户可以先看活跃度和 review 风险，再决定进入哪个 subject timeline。
- `旧剑` 的 `1 issue` 让 review 工作流在左侧也可见，不必先切到 `review 1` 状态过滤。
- `latestTime / latestKind` 可以帮助用户判断 subject 最近一次参与的是普通事件、backstory 还是初始化切片。

## Plan Deviation

- 本轮原本只想补 subject 行的 activity 信息，实际也补了左侧顶部 active/review 汇总，因为这能让整体世界视角更快知道当前 mock 世界的主体覆盖情况。
- 没有增加“只看 review subjects”过滤按钮，避免左侧本轮一次性塞入过多过滤模式；如果后续 review queue 变复杂，再补专门入口。

## Next Notes

- 后续可以把 subject stats 扩展为可点击的 `review subjects` 快捷过滤。
- 接真实 API 时，`subjectStats` 可以由前端从 loaded slices 聚合，也可以替换为后端 subject timeline stats endpoint。
