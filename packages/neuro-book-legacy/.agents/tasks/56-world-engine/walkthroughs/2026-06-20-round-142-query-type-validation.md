# Round 142 - Query Type Validation

## Context

继续按用户最新边界推进：本轮不做前端，专注后端与 API 设计。

审查查询入口时发现：`queryState({type})` / `listWorldSubjects({type})` 在 type 拼错或 schema 未声明时会静默返回空数组。对 HTTP API 和 Agent 工具来说，这容易被误读为“确实没有相关 subject”，而不是“调用参数错了”。

## Plan

1. 在 service 层统一校验按 type 查询的 subject type。
2. 覆盖 facade、HTTP API 和 Agent 工具入口。
3. 同步稳定 API / Agent 文档与任务记录。

## Implementation

- `WorldEngineService.queryState()` 在 `query.type` 非空时复用 `assertSubjectType()`。
- `WorldEngineService.listWorldSubjects()` 在 `query.type` 非空时复用 `assertSubjectType()`。
- 保持 schema 为空时的开发期宽松行为；当 schema 已声明 subject types，未知 type 返回 400：
  - `schema 未声明 subject type：<type>`
- 补 facade 测试：
  - `queryState({type:"creature"})` 拒绝未知 type；
  - `listWorldSubjects({type:"creature"})` 拒绝未知 type。
- 补 HTTP API 测试：
  - `POST /state/query` 按未知 type 查询返回 400；
  - `GET /subjects?type=creature` 返回 400。
- 补 Agent 工具测试：
  - `get_world_state` 按未知 type 查询时透出同一个业务错误。

## Review Notes

这次修复让按 type 查询与 `createSubject` 的 schema type 约束一致。它改变的是错误语义：拼错 type 不再被当成空结果。

本轮与大目标计划的出入：仍未做前端和浏览器验收，符合用户最新“本次不用做前端，专注后端与 API 设计”的调整。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 60 tests passed
- `bun run typecheck`
  - passed

