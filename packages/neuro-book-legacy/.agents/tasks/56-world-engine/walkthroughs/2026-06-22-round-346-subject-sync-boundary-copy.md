# Round 346 - Subject Sync Boundary Copy

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 当前 Workbench 已能发现 `simulation/subjects` 待接入主体，并提供“同步主体系统”入口。

## Finding

- “同步主体系统”实际只注册 World Engine subject 身份。
- 它不会复制或改写 `simulation/subjects` 六文件正文。
- 旧面板只说“还没有 World Engine subject 身份”，没有明确同步边界，作者可能误以为同步会把六文件内容写进 World Engine，或反过来改写六文件。

## Implementation Walkthrough

- `WorldEngineWorkbenchDialog.vue`
  - 待接入-only 空状态描述补充：同步不会复制或改写 `simulation/subjects` 六文件正文。
  - Project 无 slice 且存在待接入主体的空状态描述补充：同步只注册身份，不复制或改写六文件正文。
  - 左栏 `主体系统待接入` 面板补充同样边界提示。

## Boundaries

- 不改变同步行为。
- 不自动导入六文件正文。
- 不自动写 `events.jsonl / memory.jsonl / state.md`。

## Verification / Test

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过。
- 本轮未重复执行 `bun run typecheck`；当前全量 typecheck 已知被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞。

## Result

- 作者在点击“同步主体系统”前能明确知道：这一步只是把主体注册成 World Engine subject 身份，主体六文件仍由作者 / 后续显式流程维护。
