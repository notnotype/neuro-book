# Round 336: Subject File Proposal Surface

## Context

上一轮把 World Engine slice 与 `simulation/subjects` 六文件的桥接路线收敛为 P0：先展示“主体文件更新建议”，不自动写文件。

本轮实现这个最小闭环，让作者在主 Workbench / mock Workbench Inspector 里选中 slice 时，能看到这条 slice 对主体六文件可能产生的后续维护建议。

## Changes

- 新增 `WorldWorkbenchSubjectFileProposal` 类型。
- 新增 `buildWorldWorkbenchSubjectFileProposals()`：
  - 输入 selected slice、当前 focused subject、subject 名称表和 `simulation/subjects` discovery summary。
  - 为 simulation-backed subject 生成：
    - `events.jsonl` 经历草稿。
    - `memory.jsonl` facts 草稿（仅在 `memory.*` / relationship 相关 mutation 时出现）。
    - `state.md` 审查原因（`location / inventory / hp / faction / relationship / status` 等当前状态相关 attr）。
  - 当 slice mutation 只落到 `world.events`，但当前 focused subject 是真实主体时，会保留 focused subject 语境生成建议，覆盖 `ming-ding-zhi-shi-2` 角色没有 `events` attr 的常见路径。
- `WorldEngineWorkbenchPreviewInspector.vue` 增加 `Subject file proposals` 区域：
  - 明确文案：`仅生成建议，不会自动写入 simulation/subjects`。
  - 展示 subject path、events draft、memory facts、state.md review。
  - 不调用 Agent 工具，不写 `events.jsonl / memory.jsonl / state.md`。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过。
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts` 通过。
- `bun run typecheck` 未通过，但失败来自无关 Agent 文件：
  - `app/components/novel-ide/agent/useAgentSession.ts(349,143)`：`AgentRuntimeStreamEventDto` union 上直接访问 `toolCallId`。
  - `app/components/novel-ide/agent/useAgentSession.ts(350,42)`：`toLowCodeFormSession` 未定义。

## Actual Result

- P0 suggestion surface 已落地。
- 本轮没有做 P1 显式 commit，也没有自动写 subject 六文件。
- 没有执行浏览器验证。

