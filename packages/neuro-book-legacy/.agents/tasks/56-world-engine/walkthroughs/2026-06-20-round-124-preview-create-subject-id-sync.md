# Round 124 - Preview Create Subject Id Sync

## Context

本轮继续做浏览器验收前代码审查，聚焦独立 Preview 手动 create subject 的后续状态同步。

上一轮前端已经开始消费 `POST /subjects` 返回的 `{subjectId, issues}`。继续审查发现一个细节问题：

- 请求体会把 `subjectForm.id` trim 后发送给后端。
- 但创建成功后，Preview 仍把原始 `subjectForm.id` 写入 `queryForm.subjectIds`、`mutationBuilder.subjectId` 和默认 slice mutation。
- 如果用户输入 ` erina ` 这类带空格 id，后端返回 `erina`，但后续查询和 Builder 仍可能使用未 trim 的原始文本。

## Changes

- `app/pages/world-engine.preview.vue`
  - 手动创建 subject 成功后，使用后端返回的 `result.subjectId` 回写 `subjectForm.id`。
  - State Query、Mutation Builder 和默认 slice mutation 全部改用 `result.subjectId`。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态断言，确保 Preview create subject 后续状态使用返回的 `subjectId`。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，3 files / 18 tests。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，7 files / 71 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

授权后需要重点确认：

- 独立 Preview 手动创建 subject 时，输入带前后空格也不会污染后续 State Query / Builder。
- 创建 subject 后，默认 slice mutation 指向后端确认后的 subject id。

## Notes

这轮不改变后端行为，只让独立 Preview 对齐后端返回值，减少真实浏览器试用里的小坑。
