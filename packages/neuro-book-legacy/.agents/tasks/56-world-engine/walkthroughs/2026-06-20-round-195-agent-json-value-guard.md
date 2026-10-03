# Round 195: Agent mutation value 严格 JSON 边界

## 背景

用户已把当前任务范围调整为：本次不做前端，专注后端与 API 设计。继续审查后端 / Agent 公开边界时发现，`write_world_slice` / `edit_world_slice` 会先通过 `JSON.stringify()` / `JSON.parse()` 归一化 mutation `value`。

这个写法有隐患：`NaN` / `Infinity` 会被 JSON 序列化成 `null`，`Date` 会变成字符串，对象里的 `undefined` 字段会被静默丢弃。这样 service 层虽然已经有 JSON value 校验，却看不到 Agent 原始非法输入，世界状态可能被写入“被清洗过”的值。

## 本轮变更

- `server/agent/tools/world-engine-tools.ts`
  - `normalizeJsonValue()` 改为递归校验严格 JSON value。
  - `NaN`、`Infinity`、函数、symbol、`Date` 等非普通对象、对象 / 数组内部的 `undefined` 都会直接抛出 `${attr} value 必须是 JSON 值`。
  - 顶层 `mutation.value === undefined` 仍表示该 mutation 不携带 value，用于 `unset` 等场景；一旦显式传入 value，就必须是 JSON 值。

- `server/agent/tools/world-engine-tools.test.ts`
  - 补 `write_world_slice` 回归测试，覆盖：
    - `value: Number.NaN`
    - `value: { score: Number.POSITIVE_INFINITY }`
    - `value: { score: undefined }`
    - `value: new Date(...)`

- 文档同步：
  - `docs/tasks/56-world-engine/agent-tools.md`
  - `docs/tasks/56-world-engine/README.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test server/agent/tools/world-engine-tools.test.ts`
  - 27 tests passed。
- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，135 tests passed。
- `bun run typecheck`
  - passed。

## 与计划出入

- 按用户最新调整，本轮没有处理前端 Preview / Workbench，也没有做浏览器验证。
- 这不是新增业务能力，而是收紧 Agent 工具输入边界，避免非法 JSON 值在进入后端核心前被静默改写。
