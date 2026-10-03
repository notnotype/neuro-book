# Round 165: schema subject type 名形状校验

## 背景

本轮继续只推进后端与 API 设计，不做前端。

前几轮已经把 subject id、ref 内部 id、`queryState` scope 等运行时入口收紧。继续审查 schema 边界时发现，`world-engine/schema.yaml` 的 `subjectTypes` key 会直接成为 `createSubject(type)`、`queryState(type)`、`listWorldSubjects(type)` 和 `ref(type)` 的稳定 key，但 schema loader 没有拒绝空白或含空白的 type 名。

如果 schema 写出 `""` 或 `" player character "` 这样的 key，后续 API / Agent 会在创建、查询或 ref 校验时遇到不稳定且难理解的错误。因此本轮把 subject type 名形状校验前移到 schema loader。

## 实现

- `server/world-engine/schema-loader.ts`
  - 新增 `assertSubjectTypeName(type)`。
  - `normalizeSchema()` 遍历 `subjectTypes` 时先校验 type key：
    - 空白 key 返回 400：`subject type 不能为空`。
    - 包含任意空白字符返回 400：`subject type 不能包含空白：...`。

- `server/world-engine/world-engine.facade.test.ts`
  - 扩展 schema loader 非法结构回归，覆盖空 subject type key 与带空白 subject type key。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 `GET /schema` 遇到带空白 subject type 时返回 400 的 HTTP API 契约测试。
  - 注意：schema loader 会统一把解析阶段错误包装成 `世界 schema 解析失败：...`，测试已按现有包装语义断言。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `get_world_schema` 遇到带空白 subject type 时拒绝的 Agent 工具回归。

## 验证

- 初次目标组测试失败：
  - HTTP API 新增测试期望未包含 schema loader 的统一包装前缀。
  - 处理：把期望改为 `世界 schema 解析失败：subject type 不能包含空白：...`，对齐现有错误语义。
- 第二次目标组无业务断言失败，但 Vitest worker 瞬时异常退出。
  - 处理：原命令复跑。
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 103 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百六十五轮状态。
  - 在决策处补充 schema subject type 名不能为空或包含空白。
  - 增加本 walkthrough 索引。
- `docs/tasks/56-world-engine/schema-design.md`
  - 在 schema 类型声明说明中同步 subject type 名规则。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 在存储分层中同步 subject type 名是稳定 key 的约束。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 在查询与创建 subject 工具说明中同步 type 名规则。
- `PROJECT-STATUS.md`
  - 增加 round-165 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有改变数据库结构、HTTP DTO 形状或 Agent 工具返回结构，只把 schema 配置 key 的错误前移到加载阶段。
- 测试过程中出现一次 Vitest worker 瞬时退出；原命令复跑通过，本轮不作为业务阻塞处理。
