# Round 20 - Empty Mutations Guard

## Scope

本轮继续审查 World Engine 核心写入语义。HTTP API 与 Agent 工具已经要求 `mutations` 至少有一条，但 facade / service 如果被内部代码直接调用，仍可能写出空 mutations 的普通 slice。

空切面对 timeline 来说很难解释：它占用了一个 instant，却没有任何状态变化。

## Finding

- `writeSlice()` / `editSlice()` 调用 `validateMutations(input.mutations)`。
- `validateMutations()` 原本只逐条校验 mutation；当数组为空时，循环不会执行。
- 结果是 facade 直接调用 `writeSlice({ mutations: [] })` 可以创建一个空切面。

## Actual Changes

- 更新 `server/world-engine/world-engine.service.ts`：
  - `validateMutations()` 开始时检查 `mutations.length === 0`。
  - 空数组直接抛出 `mutations 不能为空`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `writeSlice()` 拒绝空 mutations。
  - 覆盖 `editSlice()` 拒绝把已有 slice 整块替换为空 mutations。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 通过：4 个测试文件，27 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；本轮是核心 service 防线，不替代页面验收。

## Code Review Notes

- 这轮不改变 HTTP / Agent 的可见契约，因为入口层原本就已经拒绝空 mutations。
- `createSubject()` 仍可在 schema 没有 default 时创建空 init slice；这是 subject 身份注册的特例，后续如果需要消除空 init slice，应单独设计身份锚定策略。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
