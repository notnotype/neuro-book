# Round 182：补齐 ref(type) 目标类型稳定 key 校验

## 背景

前面几轮已经把 subject type 作为稳定 key 的规则下沉到 schema loader 和运行时入口：

- schema subject type 名不能为空。
- subject type 不能包含空白。
- `createSubject(type)` / `queryState(type)` / `listWorldSubjects(type)` 复用同一规则。

继续审查 `ref(<type>)` 时发现，schema loader 原本只用正则排除了空白和右括号，像 `ref(player(character)` 这种包含左括号的非法目标 type 仍可能被接受。后续写入 ref 时才会表现为“目标类型不匹配”或不可匹配类型，错误位置太晚。

## 本轮目标

- `ref(<type>)` 的 `<type>` 复用 subject type 稳定 key 规则。
- schema loader 阶段拒绝带空白或括号的 ref target type。
- 补 facade 回归测试。
- 同步稳定设计文档、任务 README 与仓库状态。
- 不改前端，不做浏览器验证。

## 实现

- `server/world-engine/schema-loader.ts`
  - `isKnownValueType()` 解析 `ref(...)` 后，对内部 type 调用 `assertSubjectTypeName()`。
  - 额外拒绝包含 `(` 或 `)` 的 ref target type。
  - 非法括号返回稳定 400：`subject type 不能包含括号：<type>`。

- `server/world-engine/world-engine.facade.test.ts`
  - 扩展 schema loader 非法结构测试：
    - `ref(player character)` 返回 `subject type 不能包含空白`。
    - `ref(player(character)` 返回 `subject type 不能包含括号`。

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-182 记录。
  - 将 subject type 稳定 key 规则补充为不能包含空白或括号。

- `docs/tasks/56-world-engine/schema-design.md`
  - 同步 `ref(type)` 目标 type 的稳定 key 规则。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 同步 subject type 名规则。

- `PROJECT-STATUS.md`
  - 追加 round-182 后端/API 补充。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 126 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

- 本轮没有做前端。
- 本轮没有自动做浏览器验证。
- 本轮没有要求 `ref(type)` 的 target type 必须已在 schema 声明；当前仍保持写入 / 查询时按已有 schema subjectTypes 校验未知类型。
