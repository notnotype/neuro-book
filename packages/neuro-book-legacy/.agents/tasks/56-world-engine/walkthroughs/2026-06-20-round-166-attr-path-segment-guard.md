# Round 166: schema attr 名与 attr path 段名收紧

## 背景

本轮继续只推进后端与 API 设计，不做前端。

前几轮已经把 subject id、ref 内部 id、schema subject type 名和 `queryState` scope 等边界收紧。继续审查 attr 相关入口时发现，schema attr key 与运行时 dotted attr path 共用同一套寻址语义，但 schema loader 没有拒绝包含 `.` 的 attr 名。

例如 schema 里直接声明 `"memory.师门"` 作为单个 attr key，会和运行时 `memory.师门` 表示 `memory` 对象下的 `师门` 子路径产生歧义。与此同时，运行时 attr path 段如果带首尾空白，也会形成肉眼难发现的漂移路径。因此本轮把 schema attr 名和运行时 attr path 段名都收紧为稳定路径段。

## 实现

- `server/world-engine/schema-loader.ts`
  - `normalizeAttrs()` 处理每个 attr key 时增加 `assertAttrName(name, fullName)`。
  - schema attr 名规则：
    - 空名返回 400：`attr 名不能为空：...`。
    - 包含首尾空白返回 400：`attr 名不能包含前后空白：...`。
    - 包含点号返回 400：`attr 名不能包含 .：...`。
  - 点号只保留给运行时 dotted attr path 作为路径段分隔符。

- `server/world-engine/world-engine.service.ts`
  - `assertAttrPath()` 在原有空段校验之外，继续拒绝带首尾空白的路径段。
  - 写入 mutation `attr` 与 `queryState(attrs)` 共享该规则，避免 `profile. tags ` 这类不可见漂移路径进入后端。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增 schema loader 回归：拒绝 `"memory.师门"` 和 `" hp "`。
  - 扩展写入 / 查询 attr path 回归：拒绝 `profile. tags `。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP `GET /schema` 回归：schema attr 名包含点号时返回 400。
  - 新增 HTTP `POST /state/query` 回归：`attrs` 路径段带首尾空白时返回 400。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `get_world_schema` 回归：schema attr 名包含点号时拒绝。
  - 新增 `get_world_state` 回归：`attrs` 路径段带首尾空白时拒绝。

## 验证

- 初次目标组测试失败：
  - `world.engine` profile artifact 检测到依赖变化，需要重新编译。
  - 处理：执行 `bun scripts/build/profile.ts compile world.engine --system`。
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 108 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十六轮状态。
  - 在关键决策处补充 schema attr 名 / attr path 段名规则。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/schema-design.md`
  - 同步 schema attr 名与运行时 attr path 稳定路径段规则。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 API 层 attr path 约束。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 同步 Agent 工具 `attrs` / `attr` 入参约束。
- `PROJECT-STATUS.md`
  - 增加 round-166 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构，只收紧 schema 与运行时 attr path 的稳定寻址边界。
- 测试过程中额外重新编译了 `world.engine` system profile artifact；这是 profile 依赖哈希变化带来的构建同步，不是业务语义调整。
