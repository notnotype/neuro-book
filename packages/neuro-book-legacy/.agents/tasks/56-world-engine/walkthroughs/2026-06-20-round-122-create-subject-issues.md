# Round 122 - Create Subject Issues

## Context

本轮继续做浏览器验收前的代码审查，聚焦写入口返回值是否都进入了用户可见反馈。审查发现：

- 后端 `createSubject` / HTTP `POST /subjects` 已返回 `{subjectId, issues}`。
- Agent 工具也会把该结果原样返回。
- 前端只有 slice 写入 / 编辑 / 删除和 state query 会展示 issues；手动创建 subject 和一键示例世界创建 subject 时只当作成功 / 失败处理，没有消费 `issues`。

虽然正常 default 初始化很少产生 issue，但第一版设计里 `issues` 是一致性反馈通道；create subject 的默认切面同样可能触发反馈，前端应该统一展示。

## Changes

- `app/components/novel-ide/world-engine/world-engine-workbench.types.ts`
  - 新增 `CreateSubjectResultDto = {subjectId, issues}`。
- `app/components/novel-ide/world-engine/WorldEngineSubjectCreator.vue`
  - 创建 subject 时读取 `CreateSubjectResultDto`。
  - `created` 事件改为传 `{subject, issues}`。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - Subject Creator 创建后把 issues 放入顶部 `lastActionIssues`。
  - 一键示例世界聚合 subject 创建 issues 与 slice 写入 issues，再统一展示。
- `app/pages/world-engine.preview.vue`
  - 手动创建 subject 后把返回 issues 放进“本次操作 issues”。
  - 一键示例世界聚合 subject 创建 issues 与 slice 写入 issues，再统一展示。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态断言，防止 create subject issues 展示路径回退。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，3 files / 18 tests。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，7 files / 71 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

授权后需要重点确认：

- 独立 Preview 手动创建 subject 后，如果返回 issues，应进入“本次操作 issues”。
- 独立 Preview / 主 IDE Workbench 一键示例世界时，subject 创建 issues 和 slice 写入 issues 会合并展示。
- 主 IDE Workbench Subject Creator 的 `created` payload 类型与父组件展示一致。

## Notes

这轮没有改变后端行为，只让前端完整消费后端已经提供的 create subject issues。它把“所有写入口都展示 action issues”的产品规则补齐了一块。
