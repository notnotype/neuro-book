# Round 350 - Proposal Source Label

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- P0 主体文件建议面已经能生成、复制和打开 `events.jsonl / memory.jsonl / state.md` 的人工落地材料。

## Finding

- `ming-ding-zhi-shi-2` 的常见路径是：当前聚焦角色没有 `events` attr，Slice Composer 会把事件回退写到 `world.events`。
- 主体文件建议会保留当前 focused subject 语境，为该角色生成六文件建议。
- 但 UI 此前没有说明该建议是“直接触及该 subject”还是“当前角色语境下的 world 事件建议”，作者可能误以为 slice 已经写到了角色 subject。

## Implementation Walkthrough

- `world-engine-workbench-preview.types.ts`
  - `WorldWorkbenchSubjectFileProposal` 增加 `sourceKind` 与 `sourceLabel`。
- `world-engine-workbench-real.ts`
  - 直接包含该 subject mutation 的 proposal 标记为 `direct-mutation / 直接触及该主体`。
  - 由 focused subject + `world` mutation 生成的 proposal 标记为 `focused-world-context / 当前主体语境下的 world 事件建议`。
  - 复制整份 proposal 时加入 `source: ...`。
- `WorldEngineWorkbenchPreviewInspector.vue`
  - 在每条 subject proposal 标题行显示来源标签。
  - 标签按来源使用不同色调，并限制宽度避免挤爆标题 / 路径。
- `world-engine-ide-entry.test.ts`
  - 补 direct proposal 的来源断言。
  - 补 world-only slice + focused subject 的来源断言，覆盖角色事件回退到 `world.events` 的关键路径。
- `world-engine-workbench-preview.test.ts`
  - 补类型、Inspector 和 formatter 的静态契约断言。

## Verification / Test

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，2 个测试文件、9 个用例。
- `bun run typecheck`
  - 结果：失败，仍阻塞在无关 `server/agent/tools/control-tools.test.ts` 类型漂移：`UserInputFormSpec | Promise<...>` 访问 `.form`，以及 `ImageContent | TextContent` 访问 `.text`。

## Result

- 主 Workbench / mock Workbench 的主体文件建议现在会明确告诉作者：
  - 这条建议来自直接触及该主体的 mutation。
  - 或者它只是当前聚焦主体语境下，对 `world.events` 的手动六文件跟进建议。
- P0 边界不变：不自动写 `simulation/subjects`，不调用 Agent 工具，不把 `world.engine` profile 扩展成主体文件 owner。
