# Round 161: Agent create_world_subject init kind 契约同步

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 160 已在 service / HTTP 层收紧 `createSubject`：schema default 自动追加只允许落到同 instant 的 `kind=init` slice；如果目标时间已有非 init slice，返回 409，要求调用方显式 `editSlice` 或换初始化时间。

继续审查 Agent 工具层时发现，`create_world_subject` 的工具描述还停留在“default 写入 init slice / 无 default 只注册身份”，没有明确“已有非 init slice 时不要自动追加”。由于 Agent 主要依赖工具描述形成行动计划，这里需要同步并补工具层回归测试。

## 实现

- `server/agent/tools/world-engine-tools.ts`
  - 更新 `create_world_subject` description：
    - schema defaults 写入 `kind=init` slice。
    - 如果目标时间已有 non-init slice，需要显式编辑已有 slice 或选择其他时间。
    - 无 defaults 时只注册 subject identity。

- `server/agent/tools/world-engine-tools.test.ts`
  - 更新工具注册测试，断言描述包含 `kind=init slice` 与“只注册身份”的语义。
  - 新增回归：先创建 subject 得到 init slice，再把该 slice 整块编辑为 `kind=event`，随后通过 `create_world_subject` 在同一时间创建另一个有 default 的 subject，确认工具调用返回“目标时间已有非 init 切面”。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.mjs`
- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.types.d.ts`
  - 由于工具描述属于 profile 依赖面，本轮重新编译 `world.engine` system profile artifact。

## 验证

- 已通过：`bunx vitest run server/agent/tools/world-engine-tools.test.ts`
  - 1 file / 15 tests passed
- 初次完整目标组失败原因：
  - `world.engine` profile artifact 依赖变化，需要重新编译。
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 93 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十一轮状态与 walkthrough 索引。
- `PROJECT-STATUS.md`
  - 增加 round-161 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 本轮没有改变服务端 DTO 或数据库结构，只同步 Agent 工具契约、补工具层回归，并重编译 profile artifact。
