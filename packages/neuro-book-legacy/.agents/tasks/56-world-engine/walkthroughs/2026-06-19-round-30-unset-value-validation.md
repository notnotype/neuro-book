# Round 30 - unset value 输入语义校验

## 背景

本轮继续审查 mutation 输入语义。`unset` 的设计语义是删除属性 / 键，不需要也不应该携带 `value`。文档里此前也写了 `unset` 省略 value。

审查发现：

- `WorldEngineService.validateValue()` 对 `unset` 直接 return。
- `WorldEngineRepository.encodeMutationValue()` 会把 unset 的 value 存为 `null`。
- 因此调用方如果传了 `{ op: "unset", value: null }` 或其他 value，请求会成功，但 value 会被 reduce 忽略，也不会真实落为有意义的声明式意图。

这类输入会误导后续读 timeline 的人：看起来有载荷，实际没有语义。

## 本轮计划

1. `unset` 携带任何 `value` 时直接报错。
2. 保留无 value 的 `unset` 正常行为。
3. 补测试覆盖 HTTP/Agent JSON 边界最容易出现的 `value: null`。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `validateValue()` 在 `mutation.op === "unset"` 时检查 `mutation.value !== undefined`。
  - 如果携带 value，抛出明确错误：`<attr> 使用 unset 时不能提供 value`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `unset` 携带 `value: null` 被拒绝。
- 更新文档：
  - `README.md` 记录第 30 轮。
  - `schema-design.md` 标注 `unset` 不携带 value。
  - `sqlite-and-api.md` 标注 `MutationInput.value` 对 unset 必须省略。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 39 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划是审查 mutation op/value 语义，实际修复集中在 `unset` value 的歧义输入，范围小但确定。没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 可继续审查其它 op 的 value 语义，例如是否要统一拒绝 `set` 缺 value、是否允许动态属性 `set undefined` 这类内部调用边界。
- 浏览器验证仍是总任务缺口。
