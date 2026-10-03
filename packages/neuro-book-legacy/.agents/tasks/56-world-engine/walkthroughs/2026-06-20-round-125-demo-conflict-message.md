# Round 125 - Demo Conflict Message

## Context

本轮继续做浏览器验收前的静态审查，聚焦一键示例世界在已有 Project 中重复使用时的失败信息。

审查发现 `validatePreviewDemoSchema()` 已经会阻止“示例 id 已存在但类型不匹配”的情况，但错误文案只显示示例期望类型，例如 `erina(character)`，没有显示当前已有 subject 的实际类型。真实浏览器试用时，用户需要知道“当前是什么类型”才能快速修正或换 Project。

## Changes

- `app/utils/world-engine-preview.ts`
  - 一键示例世界 subject id 冲突文案改为同时显示期望类型与当前类型，例如 `erina(需要 character，当前 location)`。
- `app/utils/world-engine-preview.test.ts`
  - 更新对应断言，固定这个更可诊断的错误文本。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，3 files / 20 tests。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，7 files / 73 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

授权后需要重点确认：

- 在已有 `erina` 但类型不是 `character` 的 Project 里点击“一键示例世界”，错误提示能明确指出期望类型和当前类型。

## Notes

这轮不改变后端行为或 DTO，只改善一键示例世界失败时的可诊断性。它服务于最终用户视角验收：失败时应该知道该改哪个 subject，而不是只看到一个抽象冲突。
