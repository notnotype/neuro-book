# Round 01 - Runtime API / Calendar / Scripts

## Scope

本轮把 task 75 从讨论文档推进到可执行实现，重点收口四件事：

- `execute_world` 沙箱 API 使用分组形态：`world.time.*`、`world.subject.*`、`world.search.*`、`world.slice.*`。
- `world.getMany` 不保留 alias；旧平铺 API 在 sandbox 中不可用。
- `editMutations` 迁移为 `world.slice.editPatches`，当前协议面统一说 `patch / patchId`。
- Calendar 默认模板改为 Gregorian 现实日历，到分钟、不带秒；`ming-ding-zhi-shi-2` 保留复兴纪元 Simple Calendar，但也迁到分钟格式。

## Runtime Changes

- `server/world-engine/codeact-sandbox.ts`
  - `WorldApi` 只暴露分组 API。
  - `subject.get` / `subject.gets` 类型标注允许返回 `null`，和缺失 subject 的运行时语义一致。
- `server/world-engine/codeact-sandbox.test.ts`
  - 新增负向测试，确认 `world.getMany`、`world.gets`、`world.get`、`world.list`、`world.parseTime`、`world.writeSlice`、`world.editMutations`、`world.getSlice` 都不作为旧 alias 暴露。
- `server/world-engine/world-embedding.ts`
  - 面向 Agent 的错误文案从 `world.searchText` 改为 `world.search.text`。

## EmbeddingText

- `server/world-engine/patch-operations.ts`
- `server/world-engine/world-engine.service.ts`

错误信息已从单纯“禁止整块 replace”改成可操作提示：

- 空容器 `replace /events []`、`replace /memory {}` 可用于初始化。
- 非空 embedding 内容仍禁止整块 replace。
- 真实文本应使用 `append /events` 或 `replace /memory/<key>` 单条写入，value 使用 `{text:"..."}`。
- `vector` 由系统维护，不要求 Agent 初始化时手写。

`server/world-engine/patch-operations.test.ts` 增加了错误文案断言，覆盖“空容器 replace”和“vector 由系统维护”。

## Calendar

- `assets/workspace/.nbook/templates/project-directory-templates/world-engine/calendar.ts`
  - 默认 Gregorian。
  - 默认 format：`{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}`。
  - 示例输入：`公元2020年4月12日 18:00`。
- `server/world-engine/calendars/gregorian.test.ts`
  - 新增默认现实日历格式到分钟的 parse / format 往返测试。
- `reference/world-engine/calendar-system.md`
- `reference/world-engine/examples/calendar-simple.ts`
  - Simple Calendar 示例不再把 `ratio: 30/90` 的月份配 4 个 `cycleNames`。
  - 保留带秒 Gregorian 作为进阶示例，但默认文案改为不带秒。

## Existing Project Workspace

- `workspace/ming-ding-zhi-shi-2/world-engine/calendar.ts`
  - 保留 `复兴纪元` Simple Calendar，不改 Gregorian。
  - format 从带秒改为到分钟。
  - 注释删除错误的“四季月份名 + ratio: 30/90”示例，提示这种需求应走 Custom Calendar。
- `workspace/ming-ding-zhi-shi-2/world-engine/schema/index.ts`
  - 保留 `events: z.array(z.string())` 和 `memory: z.record(z.string(), z.string())`，没有迁到 `EmbeddingText`。
  - 移除未使用的 `EmbeddingText` helper，避免误导后续维护者以为该项目已迁移对象数组。

理由：该 Project Workspace 已有 `WorldPatch` 数据，历史 `/events` patch 是裸字符串。未得到 SQLite 数据迁移策略确认前，不改写数据库，也不把 schema 强行迁到 `EmbeddingText`。

## Scripts

迁移以下脚本到分组 API，并同步 `ming-ding-zhi-shi-2` 的分钟级时间格式：

- `scripts/seed-world-engine-demo.ts`
- `scripts/seed-heroes-story.ts`
- `scripts/write-chapter-01-slices.ts`

主要替换：

- `world.writeSlice` -> `world.slice.write`
- `world.parseTime` -> `world.time.parse`
- `world.get` -> `world.subject.get`
- `world.list` -> `world.subject.list`
- `world.findRefs` -> `world.subject.findRefs`
- `world.slices` -> `world.slice.list`
- `world.getSlice` -> `world.slice.get`
- `world.editMutations` -> `world.slice.editPatches`

脚本没有执行写入，因为默认目标 `workspace/ming-ding-zhi-shi-2` 是用户现有 Project Workspace，执行 seed 会清库或追加数据。

## Typecheck Follow-up

- `assets/workspace/.nbook/agent/skills/llmlint/src/scanner.ts`
  - 全量 typecheck 首次被两处 `Object is possibly 'undefined'` 阻断。
  - 这是 `noUncheckedIndexedAccess` 下数组索引未收窄问题，和本 task 语义无关。
  - 已用局部 fallback 收窄 `lineStarts[middle]` / `lineStarts[lineIndex]`，不改变 scanner 行列计算行为。

## Profiles

- 更新 profile 断言：
  - `server/agent/profiles/world-engine-profile.test.ts`
  - `server/agent/profiles/leader-assets-profile.test.ts`
- 执行 `bun scripts/build/profile.ts compile --all --system`，重新生成 14 个 system profile artifacts，解决源码 / 依赖 hash stale。

## Verification

已通过：

- `bun test server/world-engine/patch-operations.test.ts server/world-engine/calendars/gregorian.test.ts server/world-engine/codeact-sandbox.test.ts`
- `bunx vitest run server/agent/profiles/world-engine-profile.test.ts server/agent/profiles/leader-assets-profile.test.ts`
- `bunx vitest run server/agent/tools/world-engine-tools.test.ts`
- `bun test server/world-engine/codeact.test.ts server/world-engine/world-engine.facade.test.ts server/world-engine/calendars/gregorian.test.ts server/world-engine/patch-operations.test.ts server/world-engine/codeact-sandbox.test.ts`
- `bun scripts/build/profile.ts status --all --system`
- `bun run typecheck`

宽测结果：

- `bun test server/world-engine`：当前源目录用例通过，但 Bun 同时扫到 `product/server/world-engine/zod-loader.test.ts`，该 product 复制目录缺 `nbook/world-engine/schema` 导入，导致宽命令非零退出。该失败不来自本轮修改的 `server/world-engine/**` 源测试。
- `bunx vitest run server/agent/tools`：`world-engine-tools` 与其它工具用例通过，但 `server/agent/tools/task-tools.test.ts` 在 15s 超时；这对应本 task 已暂缓的 `task_create` / `task_set_status` 稳定性问题，不作为本轮 World Engine API 收口的完成条件。

Round 03 update：上述两个宽测遗留项已收口。`task_create` / `task_set_status` 改为真实 turn 内 immediate + savePoint 双写；`product/server/world-engine/zod-loader.test.ts` 改用相对 schema helper import。当前 `bun test server/world-engine` 与 `bunx vitest run server/agent/tools` 均通过，详见 [2026-06-29-round-03-report-followups.md](2026-06-29-round-03-report-followups.md)。

静态扫描结果：

- 当前协议面没有旧平铺 World API 调用残留。
- 允许残留：
  - `reference/world-engine/api-migration-zod.md` 中的迁移对照。
  - 测试里的 `not.toContain(...)` 负向断言。

## Open Follow-ups

- `calendar/schema` 热加载风险本轮不做，只保留后续最小复现任务。
- `workspace/ming-ding-zhi-shi-2` 若未来要把 `/events` 迁到 `EmbeddingText`，必须先写受控 SQLite 迁移，把历史字符串 patch 改成 `{text:"..."}`。
- 更大的 World API 设计，例如 subject -> slice 便利查询、批量读取命名和过滤 DSL，单独讨论，不混入本轮。
