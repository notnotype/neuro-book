# Round 183：要求 schema ref 目标类型已声明

## 背景

本轮按用户调整，暂停前端推进，只继续后端与 API 设计收口。

Round 182 已经让 `ref(type)` 内部 type 复用 subject type 稳定 key 规则：不能为空、不能含空白、不能含括号。但继续巡检时发现两个边界仍不够紧：

- schema subject type key 本身还没有拒绝括号，文档已写“不能包含括号”。
- `ref(type)` 只校验 type 形状，不要求目标 type 已在同一 schema 声明。这样 `ref(creature)` 会先通过 schema 加载，直到写入 ref 时才暴露为目标不存在或类型不匹配。

## 变更

- `server/world-engine/schema-loader.ts`
  - schema subject type key 现在拒绝括号。
  - schema 加载完成后遍历所有 attr 的 `type` / `itemType` / nested `fields`，要求 `ref(type)` 指向同一 schema 已声明的 subject type。
  - 悬空 ref 返回稳定 400：`schema ref 指向未声明 subject type：<path> -> <type>`。
- `server/world-engine/world-engine.service.ts`
  - 运行时 `createSubject(type)` / `queryState(type)` / `listWorldSubjects(type)` 复用的 subject type key 校验也拒绝括号。
- `server/world-engine/world-engine.facade.test.ts`
  - 补 schema type 括号、运行时 type 括号、未知 ref target 回归测试。
  - 修正 schema 投影测试 fixture，显式声明 `ref(item)` 的 `item` type。
- 文档同步：
  - `docs/tasks/56-world-engine/README.md`
  - `docs/tasks/56-world-engine/schema-design.md`
  - `docs/tasks/56-world-engine/sqlite-and-api.md`
  - `docs/tasks/56-world-engine/agent-tools.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts`
  - 1 file passed，66 tests passed。
- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，126 tests passed。
- `bun run typecheck`
  - passed。

## 与计划出入

- 原新路线收敛计划里包含前端 Preview / Workbench 移除旧 re-settle 交互等工作；本轮按用户最新调整不做前端。
- 本轮不是重写后端核心，只补 schema/API 契约边界：把悬空 `ref(type)` 从“写入时才暴露”前移到 schema 加载阶段。
