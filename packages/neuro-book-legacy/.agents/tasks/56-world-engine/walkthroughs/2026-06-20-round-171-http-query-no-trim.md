# Round 171: HTTP query 参数不静默 trim

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 162-169 已经把 subject id、ref id、subject type、attr path、slice kind、sliceId 等稳定 key / 路径 / 标签规则下沉到 service 层，并修正了 HTTP path 对 `sliceId` 的静默 trim。继续审查 HTTP 边界时发现，query 参数仍通过 `readOptionalStringQuery()` 做了统一 `trim()`：

- `GET /subjects?type=%20character%20` 会被裁成 `character`，绕过运行时 subject type 入参不能包含空白的稳定 key 规则。
- `GET /slices?limit=%201%20`、`withMutations=%20true%20` 会被宽松接受，和“严格 query integer / boolean”契约不一致。
- `GET /state?at=%20...%20` / `GET /slices?from=&to=` 也会静默裁剪时间 query。

本轮把 HTTP query 参数收紧为：空字符串仍视为未传；非空 query 原样进入校验，不做静默裁剪。

## 实现

- `server/api/projects/world-engine/[...segments].ts`
  - `readOptionalStringQuery()` 不再 `trim()`；只把 `""` 视为未传。
  - `readPositiveIntQuery()` 和 `readBooleanQuery()` 因此会拒绝带首尾空白的数字 / 布尔 query。
  - `readOptionalTimeQuery()` 在 parse 前显式拒绝带首尾空白的时间 query，返回 400：`${key} 不能包含前后空白：...`。
  - `GET /subjects?type=` 会把原始 type 交给 service 层，复用 `subject type 不能包含空白：...`。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 `HTTP query 参数不静默裁剪空白` 回归测试，覆盖：
    - `GET /subjects?type= character ` 返回 400。
    - `GET /slices?limit= 1 ` 返回 400。
    - `GET /slices?withMutations= true ` 返回 400。
    - `GET /state?at= 复兴纪元1年 1月1日 00:00:00 ` 返回 400。

## 验证

- 已通过：`bun run test server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 116 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百七十一轮状态。
  - 在 Decisions 中增加 HTTP query 参数不静默裁剪的契约。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 schema/calendar 配置文件当前契约。
  - 增加 HTTP query 参数边界说明。
- `PROJECT-STATUS.md`
  - 增加 round-171 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 或 Agent 工具 schema；只收紧 HTTP query 参数解析边界，避免 URL 入口和 service 层稳定规则不一致。
