# Round 123 - Create Subject API Contract

## Context

上一轮补齐了前端对 `POST /subjects` 返回 `{subjectId, issues}` 的消费。本轮继续审查测试证据，发现：

- API 第一条 happy path 已断言单个 subject 创建返回 `{subjectId, issues: []}`。
- 但 Preview 一键示例世界背后的四个 subject 创建只调用 API，没有断言返回 DTO；前端现在会聚合这些返回值，因此 API 示例链路也应该把这个契约钉住。

## Changes

- `server/api/projects/world-engine/[...segments].test.ts`
  - 在“跑通 preview 一键示例世界背后的真实 API 链路”中，把 `world`、`capital`、`erina`、`old-sword` 的创建结果保存下来。
  - 断言四个创建结果分别为 `{subjectId, issues: []}`。
- `app/utils/world-engine-workbench-preview-state.ts`
  - 验证绕道：测试暴露 mock reducer 依赖 `collectionRemove` 字面分支作为契约证据，但实现里用默认尾分支处理 remove。行为没有错，但可读性弱；本轮改为显式 `collectionRemove` 分支。

## Verification

- `bunx vitest run server/api/projects/world-engine/[...segments].test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，4 files / 24 tests。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，7 files / 71 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

授权后需要重点确认：

- Preview 一键示例世界时，subject 创建和 slice 写入返回 issues 会合并展示。
- 主 IDE Workbench 一键示例世界时，顶部 action issues 与 State Query issues 不互相覆盖。
- Workbench mock preview 的 collection remove 编辑预览仍保持可用。

## Notes

这轮主线是补 API 契约测试；`collectionRemove` 显式分支是验证中暴露的小绕道，已在本 walkthrough 记录。没有改变正式后端行为或 HTTP DTO。
