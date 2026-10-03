# Round 35 - HTTP query 正整数严格解析

## 背景

本轮先审查 `createSubject()` 与 init slice 的边界，重点看没有 default 的 subject 是否会产生空 init slice。该点在 Round 20 已记录为身份锚定策略问题：`CreateWorldSubjectResult` 当前要求返回 `sliceId`，如果要消除空 init slice，需要单独设计“subject 身份如何锚定 timeline”的合同。因此本轮没有直接改这个边界。

继续检查 HTTP API 边界时发现一个不需要新决策的小问题：`readPositiveIntQuery()` 使用 `Number.parseInt()` 解析 query 参数，`limit=12abc` 会被静默截断成 `12`。这会让调试页面或 Agent 调用时的坏输入看起来像合法请求，不利于定位问题。

## 本轮计划

1. 保持 API 形态不变。
2. 只收紧 HTTP query 正整数解析。
3. 增加 API 回归测试。

## 实现

- 更新 `server/api/projects/world-engine/[...segments].ts`：
  - `readPositiveIntQuery()` 先用 `/^\d+$/` 校验完整字符串。
  - 只有完整十进制正整数才转换为 number。
  - `limit=12abc`、`limit=1.5`、`limit=-1` 等都会返回 400。
- 更新 `server/api/projects/world-engine/[...segments].test.ts`：
  - 新增测试：`slices limit query 必须是严格正整数`。

## 验证

- `bunx vitest run server/api/projects/world-engine/[...segments].test.ts`
  - 1 个测试文件通过。
  - 5 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 44 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原本从 `createSubject()` 空 init slice 审查开始，但该问题牵涉已记录的身份锚定策略，不适合在没有新合同的情况下绕开类型和 API 结果强行修改。实际实现转向 HTTP query 严格解析，这是同一轮审查里发现的确定性小问题。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 如果要彻底消除无 default subject 的空 init slice，需要先决定 `CreateWorldSubjectResult.sliceId` 是否允许为空，或引入专门的 subject-created timeline entry。
- 浏览器验证仍待用户确认后执行。
