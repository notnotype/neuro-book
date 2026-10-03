# Round 162: subject id 空白形状校验下沉

## 背景

本轮继续按用户最新调整，只推进后端与 API 设计，不做前端。

前面几轮已经把 `createSubject` 的初始化切面语义、单 slice 容量、同 instant 非 init 冲突都收紧到 service / HTTP / Agent 工具层。继续审查输入边界时发现，subject id 会直接进入 `subject://<id>` 引用 URI，也会作为 mutation `subjectId` 和 `queryState(subjectIds)` 的主键参数使用；如果允许空白或带首尾空白的 id，后续会出现“看起来同名、实际不同 id”的隐性漂移。

因此本轮把 subject id 的最小形状校验下沉到 `WorldEngineService`，让 facade、HTTP API 和 Agent 工具共享同一条规则。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `assertSubjectId(subjectId, label)`：
    - 空白字符串返回 400：`${label} 不能为空`。
    - 首尾空白返回 400：`${label} 不能包含前后空白：${subjectId}`。
  - `createSubject()` 在写库前校验 `input.id`。
  - `validateMutations()` 校验每条 mutation 的 `subjectId`。
  - `queryState()` 校验显式传入的 `subjectIds`。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增 `createSubject` 拒绝空白或带首尾空白 subject id 的回归。
  - 新增 `writeSlice` 拒绝带首尾空白 mutation `subjectId` 的回归。
  - 扩展 `queryState` 缺失 subjectIds 回归，覆盖带首尾空白的 `subjectIds`。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 `POST /subjects` 拒绝带首尾空白 id 的 HTTP API 契约测试。
  - 新增 `POST /slices` 拒绝带首尾空白 mutation `subjectId` 的 HTTP API 契约测试。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `create_world_subject` 拒绝带首尾空白 subject id 的 Agent 工具回归。
  - 新增 `write_world_slice` 拒绝带首尾空白 mutation `subjectId` 的 Agent 工具回归。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 99 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十二轮状态。
  - 在 `subject://<id>` 决策处补充 subject id 不能为空或带首尾空白。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 在 subject 引用格式与 facade 注释中同步 id 形状约束。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 在 `create_world_subject` 参数和说明中同步 id 形状约束。
- `PROJECT-STATUS.md`
  - 增加 round-162 后端/API 补充，并记录目标测试与 typecheck 通过。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构，只收紧 subject id 输入边界。
- 本轮复跑后 `bun run typecheck` 已通过；没有留下新的已知 typecheck 阻塞。
