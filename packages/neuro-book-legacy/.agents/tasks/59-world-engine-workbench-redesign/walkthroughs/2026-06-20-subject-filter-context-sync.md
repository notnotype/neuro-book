# 2026-06-20 Subject Filter Context Sync

## Scope

本轮继续推进 `/world-engine.workbench-preview` mock 页面，不接真实 API，不改后端 DTO。目标是从用户视角检查“单 subject 查看”是否顺手，并修正浏览器巡检中发现的上下文断裂。

## Browser UX Finding

在 1366x768 桌面视口下，页面没有全局溢出，但三栏 + 底部 Mutation Editor 的信息密度较高。实际点击左侧 `旧剑` subject 过滤后，中间列表正确只显示触及旧剑的 slices，但底部 Mutation Editor 的 subject 视图仍停留在当前切片的第一个触及主体 `艾莉娜`，没有跟随外部 subject 过滤。这会破坏“对单个 subject 查看”的核心心智。

## Changes

- 页面层把 `selectedSubjectIds` 传入 Mutation Editor。
- Mutation Editor 新增 `filteredTouchedSubjectIds`，当当前 slice 触及外部过滤 subject 时，优先把 subject 视图切到该 subject。
- Slice List 顶部在 subject 过滤生效时显示过滤 chips，可逐个移除 subject，也可一键回到整体世界。
- 顶栏 `worldViewLabel` 从 subject id 改为 subject name，例如 `Subject 过滤：旧剑`。
- Slice List 过滤区文案从 `subject filter` 调整为 `Subject 过滤`，和顶栏语义保持一致。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- 浏览器 1366x768 复验：
  - 点击左侧 `旧剑` 后，Slice List 显示 `4 / 5 slices` 和 `旧剑 item` chip。
  - 顶栏显示 `Subject 过滤：旧剑`。
  - Mutation Editor subject 视图自动切到 `旧剑 old-sword`。
  - 旧剑状态与本切片变更同步展示。
  - 页面 `scrollWidth` 仍为 1366，无全局横向溢出。

## Detour

巡检时曾检查 `correction` kind / mock 切片覆盖，但当前任务状态和测试仍显式守住 `backstory` 历史补充切片。本轮没有继续强行偏移 mock 命名，避免把迭代重点从 UI/UX 路径修正转成 mock kind 语义争执。

## Next Notes

- 1366 视口下底部 Mutation Editor 仍然占据较多高度，后续可以继续评估默认折叠、半高展开或可调高度。
- 下一轮可继续检查 Inspector 与 Mutation Editor 之间的 subject 切换联动，例如从 Inspector 的 Touched Subjects chip 直接切换底部 subject 视图。
