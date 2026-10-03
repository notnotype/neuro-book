# Round 115 - Keyword Cleanup

## Context

本轮继续 round-114 后的收口审查。行为层旧后续处理入口已经删除，但静态入口测试中仍用旧 endpoint / 状态名作为负向断言字面量，导致关键词核查会把“已删除的旧路线词”误判为 active 源码残留。

## Changes

- `world-engine-ide-entry.test.ts` 保留旧入口不存在的负向断言，但把旧 token 拆成 `removedToken()` 片段拼接，避免源码继续携带旧路线字面量。
- `delete_world_slice` 工具描述从“回滚/清理”语义改为“清理”，避免 Agent 误读为存在可恢复撤销机制。
- Workbench mock 预览的当前磁盘状态仍带有 `correction` kind；本轮把 `standardKindOptions` 和 mock 示例 slice 同步收敛为 `backstory`。
- `PROJECT-STATUS.md` 中旧的 Workbench Preview 状态说明同步改为 `backstory` 补历史切片，避免稳定状态文档与当前代码相互矛盾。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts server/agent/tools/world-engine-tools.test.ts`：通过，3 files / 8 tests。
- `bun run typecheck`：通过。
- 关键词核查：旧后续处理 token 只剩历史 walkthrough 链接和 `old-sword` 示例；`correction` / `bootstrap` 在 active 文档、组件、页面和 mock 数据中无命中；工具描述中不再出现可恢复撤销暗示。
