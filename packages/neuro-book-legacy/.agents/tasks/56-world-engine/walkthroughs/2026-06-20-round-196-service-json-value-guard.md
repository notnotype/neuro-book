# Round 196: service 层严格 JSON value 边界

## 背景

上一轮收紧了 Agent 工具层的 mutation `value`，避免 `JSON.stringify()` / `JSON.parse()` 把 `NaN`、`Infinity`、`Date` 或嵌套 `undefined` 静默改写。但继续追到最终业务边界时发现，`server/world-engine/world-engine.service.ts` 的 `isJsonValue()` 仍把任意非数组 object 视为 JSON object。

这意味着非 HTTP / Agent 的 facade 直调如果传入 `Date`，会因为 `Object.values(date)` 是空数组而通过 JSON value 校验，后续 `toJsonValue()` 再把它序列化成字符串。service 是最终业务边界，这里不能依赖入口层已经清洗好输入。

## 本轮变更

- `server/world-engine/world-engine.service.ts`
  - `isObjectLike()` 改为只接受普通对象或 null prototype 对象。
  - `Date` 等非普通对象不再被视为 JSON object。

- `server/world-engine/world-engine.facade.test.ts`
  - 在“动态属性 set 也拒绝非 JSON value”测试中补充 `Date` 回归。
  - 通过测试用类型转换模拟运行时非法输入，确认 facade/service 直调也不能绕过 JSON value 边界。
  - 顺手给 `schema loader 拒绝非法 subject type 与 attrs 结构` 这个一次创建 11 个临时 Project 的重用例单独放宽到 10s，避免目标测试并行运行时偶发超过 Vitest 默认 5s。

- 文档同步：
  - `docs/tasks/56-world-engine/schema-design.md`
  - `docs/tasks/56-world-engine/sqlite-and-api.md`
  - `docs/tasks/56-world-engine/README.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts`
  - 1 file passed，69 tests passed。
- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，135 tests passed。
- `bun run typecheck`
  - passed。

## 与计划出入

- 按用户当前要求，本轮继续只做后端/API 设计边界，没有进入前端。
- 这轮是从 round-195 Agent 工具边界自然追到 service 最终边界的小绕道；已记录在本 walkthrough 中。
- 验证过程中遇到一次目标测试并行运行下的重用例 5s 超时；该用例不是断言失败，已用单用例 timeout 固定，复跑原目标测试命令通过。
