# Round 174：禁止公开时间入参静默 trim

## 背景

本轮继续按用户调整后的范围推进：不做前端，专注后端与 API 设计。

Round 171 已经让 HTTP query 参数不再静默裁剪空白；Round 173 又禁止 HTTP / Agent 公开时间入参使用 `instant:<number>` 调试格式。继续审查后发现，底层 `WorldCalendar.parse()` 会先 `trim()`，因此 HTTP body 与 Agent 工具的时间字段仍可能接受带首尾空白的时间字符串。

这会让公开边界产生两套规则：query 严格，body / Agent 宽松。本轮把公开时间字段统一为不静默 trim。

## 本轮目标

- HTTP body 时间字段带首尾空白时返回稳定 400。
- Agent 工具时间字段带首尾空白时返回稳定错误。
- 保留底层 `WorldCalendar.parse()` 的 `trim()` 行为，供 facade 直调测试和调试使用。
- 补 HTTP API 与 Agent 工具回归测试。
- 同步稳定设计文档与仓库状态文档。

## 实现

- `server/api/projects/world-engine/[...segments].ts`
  - `parsePublicTime()` 增加首尾空白检查。
  - 覆盖 `POST /subjects.time`、`POST /slices.time`、`POST /slices/:id/edit.time`、`POST /state/query.at`。
  - `GET /state?at=` 与 `GET /slices?from=&to=` 继续走同一个 helper；query 入口原本已在 helper 前检查空白，本轮行为不变。

- `server/agent/tools/world-engine-tools.ts`
  - `parseAgentTime()` 增加首尾空白检查。
  - 覆盖 `create_world_subject.time`、`write_world_slice.time`、`edit_world_slice.time`、`get_world_state.at`、`list_world_slices.from/to`。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP body 时间字段不静默 trim 的契约测试。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 Agent 工具时间字段不静默 trim 的契约测试。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 121 tests passed

- `bun run typecheck`
  - passed

## 文档同步

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-174 当前状态与 walkthrough 链接。

- `docs/tasks/56-world-engine/agent-tools.md`
  - 明确 Agent 工具时间字段带首尾空白会报错。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 明确 HTTP 公开时间字段 `time` / `at` / `from` / `to` 不接受首尾空白。

- `PROJECT-STATUS.md`
  - 追加 round-174 后端/API 最新补充。

## 与计划出入

- 本轮没有修改前端，也没有进行浏览器验证，符合用户本轮“专注后端与 API 设计”的调整。
- 原本上一轮记录里把 body 空白作为后续可选项；本轮已完成该收口。

## 后续

- 公开边界的字符串形状已经基本收紧到：id/type/attr/kind/sliceId/time 都不接受隐式空白。下一步可继续审查 API response / error payload 是否需要统一错误码，而不是只依赖 message。
