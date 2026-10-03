# Round 18 - Query State Missing Subjects

## Scope

本轮回到 Round 17 原计划中的 `queryState / listLimit / reduce` 查询语义审查。重点检查 Agent 和 UI 都会依赖的 `subjectIds` 查询边界。

## Finding

`queryState({ subjectIds })` 原本通过 repository 的 `listSubjects({ ids })` 查询 subject。Prisma `in` 查询只返回存在的记录，因此如果调用方传了不存在的 subject id，服务层会静默少返回一项。

这对 Agent 和 UI 都有风险：

- Agent 传错 id 时，可能把空数组理解为“这个 subject 没有状态”。
- UI 查询多个 subject 时，可能只显示部分 subject，用户不容易发现有 id 拼错。
- API / Agent 工具层已经要求查询必须收窄，但没有保证收窄目标真实存在。

## Actual Changes

- 更新 `server/world-engine/world-engine.service.ts`：
  - `queryState()` 在读取 subjects 后调用 `assertRequestedSubjectsFound()`。
  - 如果传入的 `subjectIds` 有任一项不存在，或与同时传入的 `type` 过滤不匹配，直接抛出 404。
  - 错误文案：`subject 不存在或不匹配查询条件：<ids>`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `subjectIds: ["erina", "ghost"]` 拒绝。
  - 覆盖 `subjectIds: ["erina"], type: "world"` 拒绝。
- 更新 `server/api/projects/world-engine/[...segments].test.ts`：
  - 覆盖 HTTP `state/query` 对缺失 subjectIds 返回 404。
- 更新 `server/agent/tools/world-engine-tools.test.ts`：
  - 覆盖 Agent `get_world_state` 查询缺失 subject id 时返回明确错误。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 通过：4 个测试文件，25 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；这轮是后端查询语义修复，不替代页面验收。

## Code Review Notes

- 这是一个行为收紧：显式传 `subjectIds` 时，缺失 id 不再静默忽略。
- 按 `type` 查询仍允许返回空数组，因为“当前没有该类型 subject”是合理查询结果。
- 如果同时传 `subjectIds` 和 `type`，返回集合必须同时满足两者；不满足的 id 会被视为“不存在或不匹配查询条件”。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
