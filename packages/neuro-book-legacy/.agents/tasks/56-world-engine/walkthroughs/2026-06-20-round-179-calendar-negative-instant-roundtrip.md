# Round 179：补齐 Calendar 零点前时间往返

## 背景

任务定论写明：

- `Instant` 是唯一时间真相源，可正可负。
- `Instant < 0` 天然表示零点前。
- 连续数轴不继承公历“无第 0 年”的历史问题。

继续审查默认 Calendar 时发现：`formatTime(-1n)` 会输出零点前的人读时间，但 `parseTime()` 原本要求 `year > 0`，导致格式化出的零点前时间不能再解析回同一个 `Instant`。这会破坏 Calendar 作为项目日历字符串边界的双向契约。

## 本轮目标

- 默认 Calendar 对负 `Instant` 支持 `format()` / `parse()` 往返。
- HTTP API 公开项目日历字符串也能表达零点前时间。
- 同步任务文档和仓库状态。
- 不改前端，不做浏览器验证。

## 实现

- `server/world-engine/calendar.ts`
  - `year` 解析从正整数改为连续整数，允许 `0` 和负 year。
  - `month` / `day` 仍要求正整数。
  - `hour` / `minute` / `second` 仍要求非负整数。

- `server/world-engine/world-engine.facade.test.ts`
  - 扩展默认 Calendar 回归：`formatTime(-1n)` 输出 `复兴纪元0年 12月30日 23:59:59`，并可 `parseTime()` 回 `-1n`。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 回归：用 `复兴纪元0年 12月30日 23:59:59` 创建 subject，会生成零点前 init slice，`GET /slices` 返回同一时间字符串。

- `docs/tasks/56-world-engine/README.md`
  - 补充 round-179 记录。
  - 明确默认 Calendar 允许 `0年` 和负 year 表达零点前时间。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 HTTP API 项目日历字符串可表达零点前时间。

- `PROJECT-STATUS.md`
  - 追加 round-179 后端/API 补充。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 125 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

- 本轮没有做前端。
- 本轮没有自动做浏览器验证。
- 本轮采用连续纪年作为第一版默认 Calendar 语义；如果未来需要“无第 0 年”的显示法，应作为 Calendar 格式化策略扩展单独设计。
