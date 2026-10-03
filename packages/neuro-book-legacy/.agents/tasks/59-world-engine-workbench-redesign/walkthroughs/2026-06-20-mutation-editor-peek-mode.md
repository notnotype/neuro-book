# 2026-06-20 Mutation Editor Peek Mode

## Scope

本轮继续推进 `/world-engine.workbench-preview` mock 页面，不接真实 API，不改后端 DTO。重点处理 1366x768 桌面视口下底部 Mutation Editor 挤压主 Slice List 的问题。

## UX Finding

浏览器巡检显示，默认展开的 Mutation Editor 高约 266px，使中间 Slice List 可滚区域只有约 339px。由于第一屏最重要的是浏览世界切片，这个空间分配仍然偏向编辑器。

## Changes

- Mutation Editor 默认改为折叠态，但保留一行信息条。
- 折叠信息条增加 active subject 摘要，例如 `雨城 · world`，让用户即使不展开也知道当前 subject 上下文。
- 点击 Inspector 的 `Touched Subjects` 仍会自动展开 Mutation Editor，并同步到对应 subject。
- 切换 slice 时会对 focused subject 做回落：优先保留仍被当前 slice 触及的 focused subject，否则回落到过滤 subject 或当前 slice 首个触及主体。
- 重置 mock 时恢复默认折叠，便于回到以浏览切片为主的初始状态。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- 浏览器 1366x768 复验：
  - 默认状态 Mutation Editor 高约 41px。
  - Slice List 可滚区域从约 339px 提升到约 564px。
  - 默认底部信息条显示当前 slice、mutation / subject 数和 active subject。
  - 点击 Inspector `Touched Subjects` 的 `王都` 后，Mutation Editor 自动展开到编辑状态，并切到 `王都 capital`。
  - 页面 `scrollWidth` 保持 1366，无全局横向溢出。

## Next Notes

- 现在首屏更偏浏览切片；下一轮可继续检查 Slice Card 内 subject group 是否需要提供“聚焦 subject”入口。
- 如果后续需要更强编辑体验，可以考虑加入显式“锁定展开”或可调整高度，但当前 mock 阶段先保持简单。
