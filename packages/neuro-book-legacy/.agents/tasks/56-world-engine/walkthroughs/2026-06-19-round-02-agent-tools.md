# Round 02 - Agent Tools

## Scope

本轮目标是在后端核心 facade 之上接入 Agent 工具层，让 Agent 通过人读日历字符串操作世界引擎，而不是直接传 raw instant。

实现范围：

- 新增 World Engine Agent tools。
- 注册到内置工具集合。
- 工具层只收发 Calendar 格式化字符串。
- `get_world_state` 禁止裸全量查询，必须提供 `subjectIds` 或 `type`。
- 写入 `world.focus` session custom state 的第一版投影。
- 增加工具层测试。

## Actual Changes

- 新增 `server/agent/tools/world-engine-tools.ts`：
  - `get_world_state`
  - `list_world_slices`
  - `write_world_slice`
  - `edit_world_slice`
  - `resettle_world_timeline`
  - `create_world_subject`
  - `get_world_schema`
  - `list_world_subjects`
- 更新 `server/agent/tools/index.ts`，把 World Engine 工具加入 builtin tools。
- 更新 `server/agent/session/custom-state-keys.ts`，新增 `WORLD_FOCUS_STATE_KEY = "world.focus"`。
- 更新 `server/world-engine/index.ts`，导出单例 `worldEngineFacade` 供工具懒加载复用。
- 新增 `server/agent/tools/world-engine-tools.test.ts`。
- 更新 `agent-tools.md` 状态为第一版已实现。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/agent/tools/world-engine-tools.test.ts`
  - 通过：2 个测试文件，9 个用例。
  - 覆盖：builtin 注册、Calendar 字符串创建 subject / 写 slice / 查询状态、禁止裸全量查询、`list_world_slices` 输出格式化 time 且不暴露 raw instant、`world.focus` 写入。

## Review Notes

- mutation `value` 在工具 TypeBox schema 里使用 `Type.Unknown()`，因为它是 JSON 载荷边界；真正的类型校验在 `WorldEngineService` 按 schema/op 执行。
- `world.focus` 当前只写不读，避免过早引入隐式 subject 选择。后续如果要支持省略 `subjectIds`，需要先设计清楚跨 Project / 多 subject 焦点的消歧策略。
- `list_world_slices` 对 Agent 输出 `time`，并移除 `instant` 字段；底层 facade / service 仍保留 `bigint` instant。

## Deviations From Plan

- 未接任何 profile；工具已经注册，但需要后续把相应 tool keys 加进目标 profile 才会被模型看见。
- 未做浏览器测试，因为这轮仍是后端 Agent tool runtime，没有前端操作面。
- 未接旧 `simulator.leader` / simulation workflow，保持既定边界。

## Next Round

1. 选择一个 profile 或新建临时验证 profile，暴露 World Engine 工具。
2. 从用户视角创建一个真实 Project，写入 schema/calendar，跑 worked example 的一小段。
3. 评估 Agent 使用工具时是否容易写错时间、subject id、attr/op，并据此优化工具说明或 schema 投影。
4. 如增加 HTTP/API 或前端入口，再补浏览器验证。
