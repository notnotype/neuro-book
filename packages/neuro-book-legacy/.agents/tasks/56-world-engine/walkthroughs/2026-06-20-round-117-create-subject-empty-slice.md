# Round 117 - Create Subject Empty Slice

## Context

本轮继续在未获浏览器验收授权前做静态完成度审计和代码审查。审查目标是新路线下的边界约束：同一 instant 只能有一个切面、切面应承载真实状态变更、`createSubject` 的 init mutation 只是初始化特例。

发现 `createSubject` 在 subject schema 没有任何 default 属性时，仍可能创建一个没有 mutation 的 init slice。`writeSlice` / `editSlice` 都已经拒绝空 mutations，这个分支会让 timeline 出现无内容切面，破坏“切面 = 状态变更”的约束。

## Changes

- `WorldEngineService.createSubject()` 在 `defaultMutations.length === 0` 时只创建 subject 身份并返回 `{subjectId, issues: []}`，不再创建空 slice。
- 保留已有语义：有 default mutation 时，仍创建 init slice；若同 instant 已有 slice，则把 init mutations 追加到该 slice。
- `world-engine.facade.test.ts` 新增回归测试：无 default schema 下创建 subject 后，subject 存在、state 可查询、timeline 不出现空 slice。
- 同步 `README.md` 与 `PROJECT-STATUS.md`，并修正独立 Preview 当前文件体量描述为约 751 行。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`：通过，1 file / 39 tests。
- `bunx vitest run 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，6 files / 32 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

授权后仍需要真实浏览器走独立 Preview 和主 IDE Workbench：

- 新建 Project。
- 创建示例世界。
- 写入 / 编辑 / 删除 slice。
- 查询 state。
- 观察 action issues、State Query issues、Timeline issue badge 和 Selected Slice 检查器。

## Notes

本轮不改变 API DTO，不影响已有 default 初始化路径；只消除无 default subject 的空 slice 副作用。
