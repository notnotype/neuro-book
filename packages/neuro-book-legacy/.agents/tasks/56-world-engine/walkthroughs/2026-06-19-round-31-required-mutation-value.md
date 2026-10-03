# Round 31 - 非 unset mutation 必须显式提供 value

## 背景

Round 30 已经收紧了 `unset`：不能携带 `value`。本轮继续审查相反方向的输入歧义。

发现的问题：

- `WorldEngineService.validateValue()` 对没有 schema type 的动态属性会直接返回。
- `applyMutation()` 对 `set` 使用 `toJsonValue(mutation.value ?? null)`。
- 因此 `{ subjectId, attr: "dynamicNote", op: "set" }` 会被默默当成 `set dynamicNote = null`。
- Preview 的 `parseMutationJson()` 也会接受缺少 value 的非 unset mutation。

这会把“漏写字段”误解释成“作者明确要设置 null”。为了让声明式意图更清楚，非 `unset` mutation 必须显式携带 `value`；如果确实要设为 null，就写 `value: null`。

## 本轮计划

1. 后端 service 层拒绝非 `unset` mutation 缺少 value。
2. Preview JSON parser 提前拒绝非 `unset` mutation 缺少 value。
3. Preview JSON parser 提前拒绝 `unset` 携带 value，与 Round 30 的后端规则一致。
4. 保留显式 `value: null` 的能力。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `validateValue()` 在 `unset` 分支之后检查 `mutation.value === undefined`。
  - 非 unset 且缺少 value 时抛出：`<attr> 使用 <op> 时必须提供 value`。
- 更新 `app/utils/world-engine-preview.ts`：
  - `parseMutation()` 中：
    - `unset` 携带 value 时返回错误。
    - 非 `unset` 缺少 value 时返回错误。
- 更新测试：
  - `server/world-engine/world-engine.facade.test.ts` 覆盖动态属性 `set` 缺 value 被拒绝，显式 `value: null` 可正常写入并 reduce 为 null。
  - `app/utils/world-engine-preview.test.ts` 覆盖 `set` 缺 value 与 `unset` 携带 value 的前端解析错误。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 40 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划是收紧 `set` 缺 value 的隐式 null 问题。实际实现推广为“所有非 `unset` mutation 必须显式携带 value”，因为 `add/listAppend/collection*` 同样需要载荷，这个规则更统一、更容易给 Agent 和用户解释。

仍未自动浏览器验证。项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 浏览器验证时需要确认 JSON textarea 对缺 value 的错误展示在当前入口内可见。
- 继续审查 mutation 语义时，可关注 collectionRemove 删除不存在元素是否应报告 no-op；这可能涉及产品决策，暂未处理。
