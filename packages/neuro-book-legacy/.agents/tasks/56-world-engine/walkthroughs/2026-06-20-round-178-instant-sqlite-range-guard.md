# Round 178：补齐 Instant SQLite 64 位范围校验

## 背景

稳定设计文档已经写明：第一版 `WorldSlice.instant` / `WorldMutation.instant` 存 SQLite `INTEGER`，也就是 64 位有符号整数。

继续审查后端/API 边界时发现：Calendar 可以解析出任意大的 `bigint`，facade/service 直调也可以直接传超大 `bigint`。如果没有 service 层防线，超出 SQLite 64 位范围的 `Instant` 会继续流向 Prisma/SQLite，错误信息和失败位置都不稳定。

## 本轮目标

- service 层统一拒绝超出 SQLite 64 位范围的 `Instant`。
- 覆盖 facade 直调与 HTTP API 公开日历字符串入口。
- 同步稳定设计文档。
- 不改前端，不做浏览器验证。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 SQLite 64 位边界常量：
    - `-9223372036854775808`
    - `9223372036854775807`
  - 新增 `assertSqliteInstant(value, label)`。
  - 在以下入口调用范围校验：
    - `createSubject(input.at)`
    - `writeSlice(input.instant)`
    - `editSlice(input.instant)`
    - `getWorldState(at)`
    - `queryState(query.at)`
    - `listSlices(query.from/query.to)`
  - `collectAdvisories()` 在当前切面位于最大合法 instant 时直接返回空 A issue，避免为了查“下游”构造 `max + 1`。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增 service 层超范围回归，覆盖 create / write / get state / query state / list slices。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 回归：超大项目日历字符串解析后返回稳定 400，而不是交给 SQLite。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 Agent 工具回归：超大项目日历字符串解析后返回稳定 400。

- `docs/tasks/56-world-engine/agent-tools.md`
  - 补充公开时间字段解析后超出 SQLite 64 位范围会报错。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充第一版 service / HTTP / Agent 公开边界拒绝超 64 位 instant。

- `docs/tasks/56-world-engine/README.md` 与 `PROJECT-STATUS.md`
  - 追加 round-178 记录。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 124 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

- 本轮没有做前端。
- 本轮没有自动做浏览器验证。
- 原计划中“超 64 位未来再升级编码，API 不变”的表达做了小幅澄清：第一版当前存储仍是 SQLite 64 位，因此公开和 service 边界先稳定拒绝超范围值；如果未来需要超 64 位，再单独升级存储编码。
