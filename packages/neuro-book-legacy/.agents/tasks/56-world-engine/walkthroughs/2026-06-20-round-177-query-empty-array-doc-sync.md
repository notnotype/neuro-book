# Round 177：同步 queryState 空数组文档契约

## 背景

上一轮已经把 `queryState()` 的空数组校验下沉到 service 层：

- `subjectIds: []` 返回 `subjectIds 不能为空`。
- `attrs: []` 返回 `attrs 不能为空`。

继续核查稳定文档时发现，`agent-tools.md` 与 `sqlite-and-api.md` 仍只强调 `subjectIds` / `attrs` 必须唯一，没有显式写出“如果传入，数组必须非空”。这容易让后续实现者误以为空数组可作为“空投影”或“空 subject scope”。

## 本轮目标

- 同步 Agent 工具文档里的 `get_world_state` 入参契约。
- 同步 SQLite/API 文档里的 `queryState` facade 契约。
- 不改前端，不改后端行为。

## 实现

- `docs/tasks/56-world-engine/agent-tools.md`
  - 明确 `subjectIds` 如果传入，必须是非空数组且每项唯一。
  - 明确 `attrs` 如果传入，必须是非空数组且每项唯一。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 在 `WorldEngineFacade.queryState()` 注释中补充：
    - `subjectIds` 传入时至少 1 项。
    - `attrs` 传入时至少 1 项且唯一。

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-177 状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 追加 round-177 后端/API 文档同步记录。

## 验证

- 本轮只改文档，未运行测试。
- 已用只读检索确认当前代码侧 HTTP / Agent schema 与 service 契约均已要求 `subjectIds` / `attrs` 传入时非空。

## 与计划出入

- 本轮没有改前端，也没有做浏览器验证。
- 本轮没有继续修改 `listSlices.limit` 的 HTTP / facade 上限；README 之前明确 HTTP `GET /slices` 保持显式查询语义，是否进一步加统一上限属于资源策略决策，未在本轮擅自变更。

## 后续

- 可以继续审查其它 optional array / optional scalar 入参，重点看 HTTP / Agent schema、facade/service 直调和稳定文档三者是否一致。
