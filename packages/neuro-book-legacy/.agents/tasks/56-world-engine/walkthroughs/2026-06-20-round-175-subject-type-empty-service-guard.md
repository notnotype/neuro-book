# Round 175：补齐 service 层空 type 查询校验

## 背景

本轮继续按后端/API 方向做契约收口。

Round 168 已把运行时 subject type 入参规则写成：`createSubject(type)`、`queryState(type)`、`listWorldSubjects(type)` 都在 service 层拒绝空 type 或包含空白的 type。继续审查时发现，`queryState()` 和 `listWorldSubjects()` 使用 truthy 判断 `query.type`，因此 facade 直调传 `type: ""` 时没有进入 `assertSubjectType()`。

实际后果：

- `queryState({type:""})` 返回“必须提供 subjectIds 或 type”，不是稳定的 `subject type 不能为空`。
- `listWorldSubjects({type:""})` 会把空字符串当未传，返回全量 subject 列表。

HTTP / Agent 入口已有 query/body/schema 保护，但 service/facade 是稳定契约的一部分，本轮补齐底层行为。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `queryState()` 中的 type 校验从 truthy 判断改为 `query.type !== undefined`。
  - `listWorldSubjects()` 中的 type 校验同样改为 `query.type !== undefined`。

- `server/world-engine/world-engine.facade.test.ts`
  - 补 `facade.queryState(projectPath, {type: ""})` 返回 `subject type 不能为空`。
  - 补 `facade.listWorldSubjects(projectPath, {type: ""})` 返回 `subject type 不能为空`。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 121 tests passed

- `bun run typecheck`
  - passed

## 文档同步

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-175 当前状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 追加 round-175 后端/API 最新补充。

## 与计划出入

- 本轮只修 service/facade 层契约，没有改前端，也没有做浏览器验证。
- HTTP / Agent 公开入口行为没有变化；本轮修的是 facade/service 直调与文档承诺不一致的问题。

## 后续

- 可以继续按同样方式审查 facade 直调是否还有“公开入口已保护、底层 service 未完全兑现文档契约”的边界。
