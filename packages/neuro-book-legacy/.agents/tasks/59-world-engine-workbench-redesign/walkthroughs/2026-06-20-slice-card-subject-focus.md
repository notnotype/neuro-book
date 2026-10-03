# 2026-06-20 Slice Card Subject Focus

## Scope

本轮继续优化 `/world-engine.workbench-preview` mock 页面，不接真实 API，不改后端 DTO。重点打通“从主 Slice List 直接进入单 subject 视角”的入口。

## UX Finding

上一轮已经让 Inspector 的 `Touched Subjects` 可以聚焦 subject，但用户浏览世界时主要视线在中间 Slice List。Slice Card 内部已经按 subject 分组展示 mutations，却只能查看，不能直接把某个 subject 推到 Inspector / Mutation Editor 的检查上下文里，单 subject 查看路径还需要绕到右侧。

## Changes

- `WorldEngineWorkbenchPreviewSliceCard` 从整卡 `<button>` 改为可选择的 `article`，避免后续 subject 操作按钮嵌套在 button 内。
- 每个 subject mutation group 增加 crosshair 图标按钮，可从卡片内部直接聚焦该 subject。
- 点击 subject 聚焦按钮会先选中当前 slice，再把 subject 同步到页面层 `focusedSubjectId`。
- `SliceList` 新增 `focusSubject` 事件转发，并把 `focusedSubjectId` 传给 `SliceCard`。
- 卡片内当前 focused subject group 使用绿色描边 / 浅绿底 / 左侧强调线，与左侧 subject 选中态和 Inspector subject 聚焦态保持一致。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`

## Plan Deviation

- 本轮没有自动做浏览器视觉验收，因为当前执行计划仍要求浏览器验收等用户确认后再做。
- 实现范围比原始计划多了一个主画布 subject 聚焦入口；它不改变数据合同，只补齐已经设计好的单 subject 查看路径。

## Next Notes

- 后续浏览器验收时重点检查：点击 Slice Card 内 `王都 / 旧剑` 的聚焦图标后，选中 slice、Mutation Editor 展开、Inspector State Snapshot 展开是否保持同步。
- 如果真实 Workbench 迁移时要把“聚焦 subject”和“过滤 subject”合并，需要再决定图标按钮是否同时写入 subject filter。
