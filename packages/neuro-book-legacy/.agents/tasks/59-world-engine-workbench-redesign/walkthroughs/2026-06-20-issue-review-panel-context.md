# 2026-06-20 Issue Review Panel Context

## Summary

- 按用户反馈继续调整 `/world-engine.workbench-preview` mock 页面：issue 审批彻底从右侧 Inspector 移出。
- 底部区域的用户可见心智从“变更编辑器”改为“审查工作台”，用于在同一处处理 issue 和编辑 mutation value。
- Review Focus 新增 `Mutation Context` 三联视图，按同 subject + attr 路径相关链路展示前一个 / 当前 / 后一个 mutation。

## Changes

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 删除 Slice Health 审查卡，包括“当前切片需要审查”“查看问题”和 open/confirmed/ignored/total 统计。
  - 删除 Inspector 的 issue props / emit / helper，右侧只保留 metadata、touched subjects、State Snapshot 和 raw JSON。
- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - UI 文案改为“审查工作台”，顶部模式改为 `问题处理 / Subject 视图 / 总变更`。
  - 聚焦 issue 时自动切到 `问题处理` 模式。
  - 新增 `MutationContextItem` / `MutationContextTriple`，在 Review Focus 中展示同属性链路的前 / 当前 / 后 mutation。
  - A issue 标注为 write / edit 一次性提醒，并说明当前 DTO 没有 source mutation；E issue 标注为 reduce / query / list 持续现算问题。
  - before / after 使用 mock snapshots 展示对应 slice 前后状态。
- `world-engine.workbench-preview.vue`
  - 向底部审查工作台传入全量 mock snapshots。
  - 清理 Inspector 不再需要的 selected slice issue props 和事件。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

## Notes

- 本轮仍为 mock-only UI / UX 调整，不改 `WorldIssueDto`，不接真实 API。
- “前一个 / 当前 / 后一个 mutation”按同 subject + attr 路径相关链路查找；A issue 的真实 source trace 仍需要后续真实 API / DTO 合同支持。
