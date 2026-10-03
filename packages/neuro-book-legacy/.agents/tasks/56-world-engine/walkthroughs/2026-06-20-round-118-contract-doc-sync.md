# Round 118 - Contract Doc Sync

## Context

本轮继续在未获浏览器验收授权前推进完成度审计，重点检查 README 以外的稳定设计文档和 Agent 工具描述是否仍带旧路线心智。

审查发现几处漂移：

- `agent-tools.md` 和 `schema-design.md` 仍标注为“草案 / 讨论中”，但第一版核心、API、Agent 工具和前端入口已经落地。
- `create_world_subject` / `createSubject` 文档仍容易让人理解为“一定会生成 init slice”，但 round-117 已修正为无 default 时只注册 subject 身份、不创建空切面。
- `worked-example.md` 的 tick 回退还在描述逐条逆操作，这与当前第一版的不可恢复 `deleteSlice` 语义不一致。
- `sqlite-and-api.md` 的 `queryState` 说明没有区分 Facade 内部全量能力与 HTTP / Agent 边界的强制收窄。

## Changes

- `server/agent/tools/world-engine-tools.ts`：`create_world_subject` 描述改为“有 default 时写入 init slice”，避免 Agent 误以为无 default 也会产生空切面。
- `agent-tools.md`：状态改为第一版已落地；`world.focus` 明确为焦点记录，不会自动补 `subjectIds`；`create_world_subject` 说明无 default 不创建空切面。
- `sqlite-and-api.md`：补充第一版只提供不可恢复 `deleteSlice`；`queryState` 说明 HTTP / Agent 必须提供 `subjectIds` 或 `type`；后续可恢复撤销不列入当前计划。
- `schema-design.md`：状态改为第一版已落地；移除“逆操作”作为当前合同的表述；补充 ref 写入 error 与读时 `dangling-ref` E issue 边界。
- `worked-example.md`：subject 初始化说明对齐无 default 行为；tick 回退改为 `deleteSlice` 物理删除，并说明 subject 身份不会自动删除。
- `README.md` 与 `PROJECT-STATUS.md` 记录 round-118。

## Verification

- `bunx vitest run server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-ide-entry.test.ts`：通过，2 files / 7 tests。
- `bun run typecheck`：通过。
- 关键词核查：旧“逐条逆操作”、旧 create subject 工具描述、`revertSlice`、`world.focus` 自动补参数等误导性表述已清理；剩余“可恢复撤销”只用于说明不属于第一版 / 需另行设计。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

下一轮浏览器验收仍应覆盖：

- 独立 Preview：新建 Project、示例世界、写 / 编辑 / 删除 slice、查询 state、观察 action issues 与 State Query issues。
- 主 IDE Workbench：从当前 Project 打开工作台，重复写 / 编辑 / 删除 / 查询链路，确认 Timeline badge、Selected Slice 检查器和 issues 展示。

## Notes

本轮没有改变数据模型或 API DTO，只同步文档与 Agent 工具描述，减少后续实现时被旧路线误导的风险。
