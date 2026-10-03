# 2026-06-20 Sidebar Stat Filter Shortcuts

## Context

上一轮左侧 `Subjects` 已经把 activity / review stats 改成 triage-aware，但顶部 `active / open / done` 仍只是摘要信息。继续推进时发现：用户在 review flow 里最常见的入口不是先去中间切片区改过滤，而是先想知道“哪些 subject 还需要看”。因此本轮把这些 stats 做成左栏本地快捷过滤。

## Changes

- `WorldEngineWorkbenchPreviewSidebar` 新增 `SubjectReviewFilter`：`all / active / open / done`。
- 顶部 `active / open / done` 三个 stats 从静态块改成按钮：
  - `active`：只显示参与过 slice 的 subjects。
  - `open`：只显示仍有 open issue 的 subjects。
  - `done`：只显示有 issue 且 open issue 已清空的 subjects。
- 再次点击当前 stats 按钮会回到 `all`，避免有命中结果时必须等到空状态才看见“清空过滤”。
- 快捷过滤只影响左侧 subject 列表，不修改 `selectedSubjectIds`，因此不会改变中间 timeline 的 subject 过滤状态。
- `清空过滤` 现在会同时清空 search、type 和 review filter。
- 空状态文案更新为“搜索、type 或状态过滤没有命中”。
- 静态契约测试补充 `subjectReviewFilter / matchesReviewFilter / setSubjectReviewFilter`，避免后续重构时丢掉这个局部过滤能力。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，4 个测试全部通过。
- `bun run typecheck`：未通过，但失败点在既有 `server/low-code-form/index.ts` 与 `server/low-code-form/resource-preset.ts` 类型错误，本轮 World Engine Workbench Preview 文件未出现在错误列表中。
- 浏览器 smoke：尝试使用 in-app browser 访问 `http://localhost:3000/world-engine.workbench-preview`，被当前 Browser Use URL policy 拦截，未继续绕过到其它浏览器通道。

## Notes

- 这个过滤是 deliberate local filter：它服务左栏查找和 review 分流，不表达“当前世界视角”。真正的世界视角仍由中间 Slice List 的 subject chips / kind / status 过滤表达。
- 后续如果要让 stats 同步驱动 timeline，需要另做产品决策；当前保持两层过滤语义分离，避免用户误以为点了 `open` 就改变了主画布时间线。
