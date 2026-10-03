# 2026-06-20 Issue Human Explanation

## Summary

- 继续优化 `/world-engine.workbench-preview` mock 页面里的 issue 审批体验。
- `问题处理` 不再让用户先读 code 和底层三联数据，而是由 preview helper 根据 issue code、mutation op、subject、attr 和上下文链路生成“人话诊断”。
- `Mutation Context` 三联卡保留前一个 / 当前 / 后一个相关 mutation，但移除 before / after 字段，改成使用者视角的动作、依赖关系、相关性和确认点。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增 `buildIssueExplanation(context, triple)`，把 `base-shifted`、`masked`、`broken-relative`、`dangling-ref` 分别映射为 A1 / A2 / E1 / E2 的可读说明。
  - Review Focus 顶部改为诊断标题、发生了什么、为什么要看和建议处理，原始 `code / subject / attr / status` 只作为辅助信息保留。
  - 新增 mutation context 说明 helper，根据 `set`、`unset`、`add`、`listAppend`、`collectionAdd`、`collectionRemove` 生成动作和确认文案。
  - 三联卡删除 before / after 展示，改为 `动作`、`依赖/覆盖关系`、`为什么相关`、`需要确认` 四块。
- `world-engine.workbench-preview.vue`
  - 删除底部审查工作台不再需要的 `snapshots` 绑定；三联卡不再依赖 snapshot before / after。
- `world-engine-workbench-preview.test.ts`
  - 补充静态契约断言：四类 issue 都有中文诊断模板，六类 op 都有说明分支，Mutation Context 不再展示 before / after。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

## Notes

- 本轮仍为 mock-only UI / UX 调整，不改 `WorldIssueDto`，不接真实 API。
- 计划与实际结果一致：只移除 `Mutation Context` 三联卡里的 before / after；Subject 视图和总变更里的切片前 / 切片后对照没有被移除。
- 当前 DTO 仍没有 source mutation 字段，所以 A issue 文案使用“可能改变基准 / 可能被覆盖”的说法，不伪造精确源头。
