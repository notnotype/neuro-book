# Round 339 - Open Subject File Proposal Path

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 上一轮已经有主体文件建议和复制入口，本轮聚焦作者复制建议之后的下一步：打开对应 `simulation/subjects` 目标文件手动处理。

## Goal

- 让 Workbench Inspector 的主体文件建议不只展示路径，还能请求外层 IDE 打开 `events.jsonl`、`memory.jsonl`、`state.md`。
- 保持 P0 边界：只打开文件，不自动写入六文件，不调用 Agent 工具，不扩展 `world.engine` profile。

## Implementation Walkthrough

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 新增 `openWorkspacePath` emit。
  - 新增 `openSubjectFileProposalPath()`，在非 busy 且路径非空时把目标路径交给外层。
  - 在 `events.jsonl draft`、`memory facts`、`state.md review` 的路径旁增加打开按钮。
- `WorldEngineWorkbenchDialog.vue`
  - 真实 Workbench Inspector 接入 `@open-workspace-path="openWorkspacePathFromWorkbench"`。
  - 将原先只面向 schema/calendar 的提示文案从“配置文件”改成“工作区文件”，因为现在也会打开主体文件。
- `world-engine.workbench-preview.vue`
  - mock 沙盘接入 `openMockWorkspacePath()`，点击后只显示 notice，不假装打开真实文件树。
- 静态契约测试同步锁定 Inspector emit、打开按钮和 mock 接线。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- `bun run typecheck` 通过。

## Result

- 作者现在可以在主体文件建议面直接打开目标 `events.jsonl / memory.jsonl / state.md` 路径，再手动处理建议内容。
- P0 仍然不自动写 `simulation/subjects`，没有引入自动 commit / 回滚语义。
