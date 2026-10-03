# Round 173：禁止公开时间入参使用 raw instant

## 背景

用户调整本轮范围：暂不推进前端，专注后端与 API 设计。

上一轮之后发现一个后端/API 契约缝隙：`WorldCalendar.parse()` 和 facade `parseTime()` 底层支持 `instant:<number>`，方便测试和调试；但公开 HTTP / Agent 契约已经写定使用项目日历字符串，不应让调用方绕过日历格式直接传 raw instant。

## 本轮目标

- HTTP API 的公开时间入参拒绝 `instant:<number>`。
- Agent 工具的公开时间入参拒绝 `instant:<number>`。
- 保留 `WorldCalendar.parse()` / facade `parseTime()` 的底层调试兼容。
- 补 API 与 Agent 工具回归测试。
- 同步稳定设计文档与仓库状态文档。

## 实现

- `server/api/projects/world-engine/[...segments].ts`
  - 增加 `parsePublicTime()`。
  - `POST /subjects` 的 `time`、`POST /slices` / `POST /slices/:id/edit` 的 `time`、`POST /state/query` 的 `at`、`GET /state?at=`、`GET /slices?from=&to=` 都会在 HTTP 边界拒绝 `instant:<number>`。
  - query 参数既有规则不变：空字符串按未传；带首尾空白仍先报空白错误；重复 query 数组仍报 `${key} 只能传一个值`。

- `server/agent/tools/world-engine-tools.ts`
  - 增加 `parseAgentTime()`。
  - `create_world_subject.time`、`write_world_slice.time`、`edit_world_slice.time`、`get_world_state.at`、`list_world_slices.from/to` 都会拒绝 `instant:<number>`。
  - 工具输出继续只暴露格式化 `time`，不暴露 raw `instant`。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 覆盖 HTTP 公开时间入参拒绝 raw instant。

- `server/agent/tools/world-engine-tools.test.ts`
  - 覆盖 Agent 工具公开时间入参拒绝 raw instant。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 119 tests passed

- `bun run typecheck`
  - passed

## 文档同步

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-173 当前状态与 walkthrough 链接。
  - 明确 HTTP / Agent 边界拒绝 `instant:<number>`。

- `docs/tasks/56-world-engine/agent-tools.md`
  - 明确 Agent 工具时间字段只接受项目日历字符串，raw instant 只保留给底层测试/调试。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 明确 HTTP 时间字段传 `instant:<number>` 返回 400。

- `PROJECT-STATUS.md`
  - 追加 round-173 后端/API 最新补充。

## 与计划出入

- 原大计划包含前端清理与浏览器验收；用户本轮明确调整为不做前端，所以本轮没有修改任何前端组件，也没有做浏览器验证。
- 原计划里的“底层 facade/calendar 保留 raw instant 调试兼容”已按计划保留，没有改动底层 calendar 解析行为。

## 后续

- 若后续继续收紧公开边界，可以考虑把 HTTP body 时间字段的首尾空白也改为稳定 400；本轮为了避免改变既有 body parse 兼容，只禁止 raw instant。
