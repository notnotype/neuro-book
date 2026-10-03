# Round 167: slice kind 标签形状校验

## 背景

本轮继续只推进后端与 API 设计，不做前端。

上一轮已经把 schema attr 名与运行时 attr path 段名收紧。继续巡检 slice metadata 时发现，`WorldSlice.kind` 是 timeline / UI / 日志过滤会依赖的分类标签，但当前显式传入 `""` 或 `" event "` 时会绕过默认 `event`，并落库成不可稳定过滤的标签。

`kind` 本身仍应允许项目扩展，例如 `backstory`、`battle`、`dream`；本轮只收紧形状，不把 kind 改成固定枚举。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `assertSliceKind(kind)`。
  - `writeSlice()` 与 `editSlice()` 在 service 层统一校验：
    - 省略 `kind`：允许，由 repository 继续默认 `event`。
    - 空白 `kind`：返回 400，`kind 不能为空`。
    - 带首尾空白：返回 400，`kind 不能包含前后空白：...`。
  - 校验下沉到 service，确保 Facade 直调、HTTP API 和 Agent 工具共用同一条规则。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增 `writeSlice` 空 `kind` 回归。
  - 新增 `editSlice` 带首尾空白 `kind` 回归。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP `POST /slices` 遇到带首尾空白 `kind` 返回 400 的契约测试。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `write_world_slice` 遇到带首尾空白 `kind` 拒绝的 Agent 工具回归。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 111 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十七轮状态。
  - 在关键决策处补充 slice kind 标签规则。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 在切面 kind 集合与 `SliceInput` 处同步形状约束。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 在 `write_world_slice` 参数说明与行为说明中同步 `kind` 约束。
- `PROJECT-STATUS.md`
  - 增加 round-167 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构；`kind` 仍允许项目自定义，只拒绝空白漂移。
