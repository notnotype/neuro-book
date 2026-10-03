# Round 156: 单 slice mutations 上限下沉到 service / HTTP

## 背景

本轮继续只推进后端与 API 设计，不做前端。

审查 Agent / HTTP 与 service 输入契约一致性时发现：Agent 工具 `write_world_slice` / `edit_world_slice` 已经通过 TypeBox schema 把单个 slice 的 `mutations` 限制为最多 100 条，但 HTTP `POST /slices` 和 facade/service 层没有同样上限。非 Agent 入口可以提交超大切面，绕开工具层资源边界。

第一版已经采用“同一 instant 只能一个切面，修改走 `editSlice`”的模型，但单个切面仍不应无限大；超过 100 条 mutation 应由调用方拆成多个语义切面或重新组织输入。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `MAX_SLICE_MUTATIONS = 100`。
  - `validateMutations()` 在空数组校验后检查长度，超过 100 返回 400：`mutations 不能超过 100 条`。
  - 该校验覆盖 facade、HTTP、Agent 工具所有写入 / 编辑入口。

- `server/api/projects/world-engine/[...segments].ts`
  - `SliceBodySchema.mutations` 增加 `.max(100, "mutations 不能超过 100 条")`，HTTP body 边界提前拒绝超大请求。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：`writeSlice` 和 `editSlice` 在 service 层拒绝 101 条 mutations。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 契约测试：`POST /slices` body 传 101 条 mutations 返回 400。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 55 tests passed
- 已通过：`bunx vitest run "server/api/projects/world-engine/[...segments].test.ts"`
  - 1 file / 14 tests passed
  - 备注：第一次并行跑 facade + HTTP 时，HTTP 断言已通过但 Vitest worker 退出阶段出现一次测试池错误；单独重跑 HTTP 后通过。
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 83 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十六轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 `SliceInput.mutations` 为 `1..100`。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 补充 `write_world_slice` / `edit_world_slice` 的 mutations 数量上限。
- `PROJECT-STATUS.md`
  - 增加 round-156 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 本轮没有新增 endpoint 或 DTO，只把既有 Agent 工具上限下沉为统一 service / HTTP 契约。
