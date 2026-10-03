# Round 159: createSubject init mutation 容量约束

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 156 已把单 slice `mutations` 上限 100 从 Agent 工具下沉到 service / HTTP：`writeSlice`、`editSlice`、`POST /slices` 和 `POST /slices/:id/edit` 都会拒绝超过 100 条 mutation 的切面。

继续审查后发现还有一条绕行路径：`createSubject` 会根据 schema default 生成 init mutations。如果同 instant 已有 init slice，它还会把新 subject 的 default mutations 追加进去。此前这两条路径没有检查单 slice 容量，导致调用方可以通过大量 default 字段或连续创建 subject 绕过 round-156 的限制。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 把 mutation 数量检查收敛为 `assertMutationCapacity(count)`。
  - `validateMutations()` 继续负责普通 slice 输入的 1..100 校验。
  - `createSubject()` 新建 init slice 前检查 `defaultMutations.length`。
  - `createSubject()` 追加到同 instant 已有 slice 前，通过 `repository.maxSeq(slice.id) + 1` 得到现有 mutation 数，再校验 `现有数量 + defaultMutations.length <= 100`。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归：schema default 生成 101 条 init mutations 时，`createSubject` 返回 `mutations 不能超过 100 条`。
  - 新增回归：同 instant 已有 99 条 mutation，再创建带 2 条 default 的 subject 时拒绝追加，避免已有 slice 超过 100。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 回归：`POST /subjects` 创建 default 超过 100 条 mutation 的 subject 时返回 400。
  - 对超大 slice body 的预期 400 测试临时静音 `consola.warn`，避免大请求体 warn 干扰测试输出。

## 验证

- 已通过：`bunx vitest run "server/api/projects/world-engine/[...segments].test.ts"`
  - 1 file / 16 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 90 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十九轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 明确 `createSubject` 的 init mutations 生成 / 追加也受单 slice 100 条上限约束。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 明确 `create_world_subject` 的 schema default 初始化同样受单切面容量约束。
- `PROJECT-STATUS.md`
  - 增加 round-159 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 本轮是 round-156 的补洞，不改变 API DTO 形状，只补齐 service 层容量一致性与 HTTP 回归测试。
