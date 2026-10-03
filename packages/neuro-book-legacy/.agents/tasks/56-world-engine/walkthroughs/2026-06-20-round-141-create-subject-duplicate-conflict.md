# Round 141 - Create Subject Duplicate Conflict

## Context

继续按用户最新边界推进：本轮不做前端，专注后端与 API 设计。

在审查 `createSubject` 契约时发现：`WorldSubject.id` 是数据库主键，但 service 层没有先查重。重复创建 subject 时会落到 Prisma 唯一约束错误，HTTP / Agent 调用者拿到的不是稳定业务错误。

## Plan

1. 在 service 层把重复 subject id 收敛为业务错误。
2. 用 facade 和 HTTP API 回归测试钉住状态码与文案。
3. 同步 API / Agent 文档和任务 walkthrough。

## Implementation

- `WorldEngineService.createSubject()` 现在会在写库前调用 `findSubject(input.id)`。
- 如果 id 已存在，抛出 409：
  - `subject 已存在：<id>（当前 type=<type>, name=<name>）`
- 保持 `createSubject` 非 upsert 语义：调用方需要改用现有 subject，或选择新 id。
- 补 facade 测试，避免重复 id 再冒出 Prisma 唯一约束细节。
- 补 HTTP API 测试，确认 `POST /subjects` 返回稳定 409。

## Review Notes

这次修复不改变正常创建、default init slice、同 instant init mutation 追加等既有语义。它只把原先不稳定的底层数据库错误前移成 API 契约。

本轮与大目标计划的出入：仍未做前端和浏览器验收，符合用户最新“本次不用做前端，专注后端与 API 设计”的调整。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 57 tests passed
- `bun run typecheck`
  - passed

