# Round 160: createSubject 只追加到 init slice

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 159 补齐了 `createSubject` 生成 / 追加 init mutations 时的单 slice 100 条容量约束。继续审查时发现另一处语义缝隙：service 只按 instant 查已有 slice，未检查 slice kind。也就是说，如果某个时间点已经有 `event` 或 `backstory` 切面，随后在同一时间创建带 schema default 的 subject，会把 init mutations 自动追加进这个普通事件切面。

这和当前主契约不一致：

- 同 instant 只能有一个 slice。
- `writeSlice` 不自动合并同 instant，修改已有时间点应走 `editSlice`。
- `createSubject` 的自动追加是初始化特例，应只落到初始化切面。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `createSubject()` 在发现同 instant 已有 slice 后先检查 `slice.kind`。
  - 只有 `kind === "init"` 时才允许追加 schema default mutations。
  - 非 init slice 返回 409，并复用包含 `existingSliceId/time/title` 的冲突提示，要求调用方使用 `editSlice` 显式合并或选择其他初始化时间。

- `server/world-engine/world-engine.facade.test.ts`
  - 调整 round-159 容量测试：用 99 条 schema default 先生成真正的 init slice，再创建带 2 条 default 的 subject，确认追加后超过 100 会被拒绝。
  - 新增回归：同 instant 已有 `kind=event` 切面时，`createSubject` 拒绝自动追加 init mutations。
  - 同时断言被拒绝后 subject 身份回滚，不会留下半创建状态。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 回归：`POST /subjects` 在目标时间已有非 init slice 时返回 409。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts"`
  - 2 files / 76 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 92 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十轮状态与 walkthrough 索引。
  - 明确 `createSubject` 的初始化自动追加只允许落到 `kind=init` slice。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 API / SQLite 设计说明中的 init slice 追加约束。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 同步 `create_world_subject` 在非 init slice 冲突时返回 409 的工具契约。
- `docs/tasks/56-world-engine/schema-design.md`
  - 同步 schema default 进切面的稳定设计说明。
- `docs/tasks/56-world-engine/worked-example.md`
  - 同步示例流程里的 subject 初始化规则。
- `PROJECT-STATUS.md`
  - 增加 round-160 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 本轮不改变 DTO 形状，只把已有初始化特例收窄到 `kind=init`，避免普通事件切面被隐式改写。
