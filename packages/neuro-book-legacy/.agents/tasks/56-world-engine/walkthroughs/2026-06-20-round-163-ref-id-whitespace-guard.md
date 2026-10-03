# Round 163: ref 内部 id 空白形状校验

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 162 已把 subject id 的形状校验下沉到 `WorldEngineService`：创建 subject、slice mutation 的 `subjectId`、`queryState(subjectIds)` 都会拒绝空白或带首尾空白的 id。继续审查 ref 写入路径时发现，`subject://<id>` 内部 `<id>` 仍只会被拿去查库；如果传入 `subject:// erina `，错误会表现为“引用目标不存在”，而不是更准确地指出 ref id 含首尾空白。

由于 ref 字符串最终也指向 `WorldSubject.id`，它应该复用同一套 id 形状规则。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `validateRef()` 在解析 `subject://` 后，对内部 `targetId` 调用 `assertSubjectId(targetId, "${attr} 引用 id")`。
  - 空 ref id 会返回 `${attr} 引用 id 不能为空`。
  - 带首尾空白的 ref id 会返回 `${attr} 引用 id 不能包含前后空白：...`。
  - 通过形状校验后，再继续执行目标 subject 存在性和 type 匹配校验。

- `server/world-engine/world-engine.facade.test.ts`
  - 在 ref 目标类型校验附近补 `subject:// capital ` 的回归，确认 service 层错误信息稳定。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 `POST /slices` 写入带首尾空白 ref id 的 HTTP API 契约测试。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `write_world_slice` 写入带首尾空白 ref id 的 Agent 工具回归。
  - 测试中途发现 Agent 工具测试 fixture schema 只有 `character`，无法创建 `location` subject；本轮把 fixture 补为 `character.location: ref(location)` 与空 `location` type，使它更接近默认模板的最小关系模型。

## 验证

- 初次目标组测试失败：
  - 新增 Agent 回归在创建 `capital` 时失败，原因是测试 fixture schema 未声明 `location` type。
  - 处理：补齐测试 fixture schema，不修改生产行为绕过。
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 101 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十三轮状态。
  - 在 `subject://<id>` 决策处补充 ref 内部 id 也遵守 subject id 形状规则。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 ref 内部 id 校验规则。
- `docs/tasks/56-world-engine/schema-design.md`
  - 同步稳定 schema 设计中的 ref id 形状规则。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 在写 slice 工具说明中补充 ref 值必须是合法 `subject://<id>`，且内部 id 不能为空或带首尾空白。
- `PROJECT-STATUS.md`
  - 增加 round-163 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构，只收紧 ref 输入边界与错误语义。
- 测试中途的小绕道是修正 Agent 工具测试 fixture schema；已记录在本 walkthrough，没有改变生产契约。
