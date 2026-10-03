# Round 176：补齐 queryState 空数组校验

## 背景

本轮继续按后端/API 方向收口 facade/service 契约。

HTTP `POST /state/query` 和 Agent `get_world_state` 的 schema 都要求：

- `subjectIds` 如果出现，至少 1 项。
- `attrs` 如果出现，至少 1 项。

但 facade/service 直调时，`queryState({subjectIds: []})` 会被当作“没有 subjectIds”；`queryState({subjectIds:["erina"], attrs: []})` 会被当作“没有 attrs”，最终返回完整 subject 状态。后者尤其容易把调用方以为空投影的请求放大成完整状态返回。

## 本轮目标

- `queryState()` service 入口拒绝空 `subjectIds` 数组。
- `queryState()` service 入口拒绝空 `attrs` 数组。
- 补 facade 回归测试。
- 同步任务文档与仓库状态。

## 实现

- `server/world-engine/world-engine.service.ts`
  - 新增 `assertNonEmptyArray(values, label)`。
  - `queryState()` 在校验 attr path / subject id / 重复项前先检查 `subjectIds` 与 `attrs` 是否为空数组。

- `server/world-engine/world-engine.facade.test.ts`
  - `queryState({subjectIds: [], attrs:["hp"]})` 现在返回 `subjectIds 不能为空`。
  - `queryState({subjectIds:["erina"], attrs: []})` 现在返回 `attrs 不能为空`。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 121 tests passed

- `bun run typecheck`
  - passed

## 文档同步

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-176 当前状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 追加 round-176 后端/API 最新补充。

## 与计划出入

- 本轮没有改前端，也没有做浏览器验证。
- HTTP / Agent 入口行为没有变化；本轮修的是 facade/service 直调与公开 schema 契约不一致的问题。

## 后续

- 可继续审查其它 optional array / optional scalar 入参，避免底层因为 JavaScript truthy/falsy 规则把“显式传了空值”当成“未传”。
