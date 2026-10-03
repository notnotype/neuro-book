# Round 140 - Backend / API Design Focus

## Context

用户调整本轮范围：**本次不用做前端，专注后端与 API 设计**。

上一轮被打断时存在一小段前端草稿，涉及 `WorldEngineMutationEditor.vue` 的 `applyDefaultDraftForSubject()` 与对应静态测试断言。本轮先撤回这段未收尾前端变更，避免在后端/API 任务中夹带 UI 行为变化。

## Work Done

- 审查 `server/world-engine` service / facade / repository、HTTP API 入口与现有测试覆盖。
- 发现 `itemType: object` 的后端校验存在默认值缺口：
  - mutation 写入时已能拒绝非 object item；
  - 但 `createSubject()` 写入 schema default 时，`list` / `collection` 的 default item 和开放 `object` 的 default 子值会走到通用 typed 校验，而该路径没有处理 `object`。
- 修复 `WorldEngineService.validateTypedValue()`：当 value type 为 `object` 时要求值是 JSON object。
- 修正 `list` / `collection itemType=object` 的 mutation 校验语义：追加 / 加入的是单个 object item，只做顶层 object 判断，不递归要求 item 内每个字段也都是 object。
- 补充 facade 回归测试：
  - `list<object>` default 元素必须是 object；
  - `collection<object>` default 元素必须是 object；
  - 开放 `object itemType=object` default 每个 key 的子值必须是 object。
- 补充 HTTP API 回归测试：通过 `POST /subjects` 创建 subject 时，同样能把非法 `itemType: object` schema default 作为 400 暴露。
- 同步 `README.md` 与 `sqlite-and-api.md`，记录 round-140 范围调整和当前契约。

## Result

后端/API 现在对 `itemType: object` 的运行时写入与 schema default 初始化保持一致：默认值不会再把字符串或数字悄悄写进 object item 位置。

本轮与原计划的出入：按用户最新要求，不继续实现或浏览器验证前端；仅撤回前端半成品，后续工作聚焦后端/API。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 40 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 55 tests passed
- `bun run typecheck`
  - passed

