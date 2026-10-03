# Round 185：schema enum 候选唯一性

## 背景

本轮继续按用户调整，暂停前端推进，只做后端与 API 设计收口。

Round 184 已经把 schema default 的纯形状 / 类型错误前移到 schema loader。继续巡检 `enum` 路径时发现：schema loader 允许 `enum` 候选是任意 JSON 值，并且运行时 enum 校验使用 stable JSON 比较；但 loader 没有拒绝重复候选。

这会导致两个问题：

- `getWorldSchema` 可能给 Agent / UI 投影两个语义相同的候选值。
- 对 object enum 来说，`{phase: active, flag: urgent}` 与 `{flag: urgent, phase: active}` 运行时会被视为同一个值，但 schema 投影里会显示成两个候选。

## 变更

- `server/world-engine/schema-loader.ts`
  - `readEnum()` 读取 enum array 后调用 `assertUniqueEnumValues()`。
  - 重复判断使用 `stableJson()`，与运行时 enum 校验的 canonical 比较规则一致。
  - 重复时返回稳定 400：`属性 enum 不能包含重复值：<attr>[i] / <attr>[j]`。
- `server/world-engine/world-engine.facade.test.ts`
  - 新增标量重复 enum 回归：`enum: [active, active]`。
  - 新增 object canonical 重复 enum 回归：两个 key 顺序不同但 stable JSON 相同的 object 候选。
- 文档同步：
  - `docs/tasks/56-world-engine/README.md`
  - `docs/tasks/56-world-engine/schema-design.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts`
  - 1 file passed，67 tests passed。
- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，127 tests passed。
- `bun run typecheck`
  - passed。

## 与计划出入

- 原大路线仍包含前端 Preview / Workbench 收口；本轮按用户最新调整不做前端。
- 本轮不是新增功能面，而是让 schema enum 配置更早失败，避免坏候选通过 `getWorldSchema` 泄露给 Agent / UI。
