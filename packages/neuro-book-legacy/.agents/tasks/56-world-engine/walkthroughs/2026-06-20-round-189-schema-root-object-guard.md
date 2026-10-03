# Round 189：schema 根配置必须是 object

## 背景

用户最新调整：本轮不做前端，专注后端与 API 设计。

巡检后发现 `world-engine/calendar.yaml` 已在 round-187 收紧为“显式存在时根配置必须是 object”，但 `world-engine/schema.yaml` 仍有同类缺口：如果文件根节点写成数组或标量，loader 会把它当成“没有 `subjectTypes` 字段”，静默回退为空 schema。

这会让错误配置看起来像一个合法的无 schema 项目，不利于 API / Agent 发现项目配置问题。

## 实现

- `server/world-engine/schema-loader.ts`
  - `WorldSchemaLoader` 读取 YAML 后以 `unknown` 进入归一化边界。
  - `normalizeSchema()` 保留空文件 / 缺文件使用空 schema 的行为。
  - 显式数组或标量根配置返回 400：`schema 配置必须是 object`。

- `server/world-engine/world-engine.facade.test.ts`
  - 补 facade 回归：数组根配置不再静默回退空 schema。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 补 HTTP API 回归：`GET /schema` 对非 object 根配置返回稳定 400。

## 文档同步

- `docs/tasks/56-world-engine/schema-design.md`
  - 记录显式 `schema.yaml` 根配置必须是 object；空文件 / 缺文件使用空 schema。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 在 API 契约中补充 schema 根配置规则。

- `docs/tasks/56-world-engine/README.md`
  - 增加 round-189 状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 增加 round-189 仓库级状态说明。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 128 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

原“新路线收敛计划”包含前端 Preview / Workbench 清理项；本轮按用户最新调整不做前端，只完成后端/API 设计收口与文档同步。

