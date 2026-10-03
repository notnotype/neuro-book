# Round 168: subject type 入参形状校验

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 165 已经让 schema loader 拒绝空白或包含空白的 `subjectTypes` key。但继续巡检运行时入口时发现，`createSubject(type)`、`queryState(type)` 和 `listWorldSubjects(type)` 没有先统一校验 type 入参形状。

在 schema 已声明类型时，`" player character "` 会被报成“schema 未声明”；在空 schema 项目里，甚至可能把不稳定 type 写进 subject 身份。由于 type 是创建、查询和 ref 校验共用的稳定 key，本轮把运行时入参也收紧到同一规则。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `assertSubjectTypeKey(type)`。
  - `assertSubjectType(type)` 先校验 type 形状，再检查 schema 是否声明：
    - 空 type 返回 400：`subject type 不能为空`。
    - 包含任意空白返回 400：`subject type 不能包含空白：...`。
  - 影响入口：
    - `createSubject(type)`。
    - `queryState(type)`。
    - `listWorldSubjects(type)`。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增 Facade 直调回归，覆盖创建 subject 的空 / 空白 type，以及按 type 查询和列 subject 的空白 type。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP `POST /subjects` 与 `POST /state/query` 的空白 type 契约测试。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `create_world_subject` 与 `get_world_state` 的空白 type 回归。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 114 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十八轮状态。
  - 将关键决策从“schema subject type 名”扩展为“subject type 稳定 key”，明确运行时入参也复用同一规则。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 subject type 名作为稳定 key 的运行时入参约束。
- `docs/tasks/56-world-engine/schema-design.md`
  - 同步 schema type 名与运行时 type 入参共用稳定 key 规则。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 同步 `get_world_state(type)` 与 `create_world_subject(type)` 的空白约束。
- `PROJECT-STATUS.md`
  - 增加 round-168 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构，只把运行时 type 入参对齐到 schema type key 的稳定形状规则。
