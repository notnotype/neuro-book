# Round 343 - State Review Section Hints

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 主体文件建议已经能打开 `state.md`，但旧 `state.md review` 只显示技术 mutation 摘要，例如 `player.location set`。

## Finding

- 真实 `ming-ding-zhi-shi-2/simulation/subjects/player/state.md` 使用作者可读区块：
  - `当前位置`
  - `资源`
  - `持有物品`
  - `身体与姿态`
  - `关系压力`
  - `短期目标`
- 旧 review reason 没告诉作者该检查哪个区块，打开文件后还要自己把 attr root 翻译成章节。

## Implementation Walkthrough

- `world-engine-workbench-real.ts`
  - 扩展 state review 相关 attr root：资源、装备、身体姿态、短期目标等常见可见状态字段。
  - 新增 `stateReviewSection()`，把 attr root 映射到 `state.md` 常见区块。
  - `stateReviewReasons` 从 `player.location set` 改为 `检查 state.md「当前位置」：player.location set = ...`。

## Boundaries

- 仍不自动 patch `state.md`。
- 仍不假设所有 Project 的 `state.md` 都完全使用同一模板；这是对当前主体六文件常见区块的审查提示。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- 本轮未重复执行 `bun run typecheck`；当前全量 typecheck 已知被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞。

## Result

- 作者打开 `state.md` 后，不再只看到技术 attr，而是能直接知道优先检查哪个文档区块。
