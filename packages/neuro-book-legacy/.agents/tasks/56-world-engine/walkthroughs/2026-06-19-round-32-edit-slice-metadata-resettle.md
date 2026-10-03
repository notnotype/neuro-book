# Round 32 - editSlice 元数据编辑 re-settle 误报修复

## 背景

本轮原计划审查写入事务边界，确认是否存在会留下半成品数据的路径。

审查结果：

- `createSubject` / `writeSlice` / `editSlice` / `resettleTimeline` 都通过 `WorldEngineFacade.runInTransaction()` 进入 Prisma transaction。
- `editSlice` 在 `replaceSlice()` 删除旧 mutation 前已经完成输入校验和新 mutation settle。
- 没发现新的半成品写入风险。

继续审查同一写入面时发现另一个确定性问题：`editSlice` 即使只修改 title / summary / kind，且 instant 与 mutations 完全不变，只要后续还有同 subject mutation，就会返回 `needsResettle: true`。这会让 Preview/Agent 对纯元数据编辑误提示需要重结算。

## 本轮计划

1. 保留 `editSlice` 第一版整块替换语义。
2. 在返回结果时区分“状态语义变化”和“纯元数据变化”。
3. 只有 instant 或 mutations 语义变化时才报告 re-settle。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `editSlice()` 在 replace 前比较旧 slice 的 `instant` 和 mutation 序列。
  - 若 `instant` 未变且 mutation 序列语义一致，只返回：
    - `needsResettle: false`
    - `affectedSubjects: []`
    - `affectedMutations: 0`
  - 新增 `sameMutationInputs()` / `mutationValueKey()` helper，用于比较旧 DB mutation 与新输入 mutation。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：存在后续 mutation 时，只改旧 slice 标题和 summary，不再误报 re-settle。
  - 既有“修改过去 mutation 会报告 re-settle”的测试保持覆盖。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 41 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮计划从事务边界审查开始，实际确认 transaction 已覆盖主要写操作，没有发现新的半成品写入风险。随后绕道修复了同一写入面上的 `editSlice` re-settle 误报。该绕道与总目标一致，因为它改善了 Preview/Agent 编辑 slice 后的用户体验和结果解释。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 浏览器验证时重点确认：载入旧 slice，只改标题或 summary 后保存，不应出现 re-settle 提示。
- 如果未来要支持局部 patch 编辑 slice，可以复用本轮的“语义变化才触发 re-settle”原则。
