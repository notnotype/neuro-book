# 2026-06-20 Slice Card Subject Filter

## Scope

本轮继续优化 `/world-engine.workbench-preview` mock 页面，不接真实 API，不改后端 DTO。重点把中间 Slice List 的 subject mutation group 做成可直接进入单 subject timeline 的主路径。

## UX Finding

浏览器巡检显示，Slice Card 内部已经能按 subject 分组展示 mutations，并且上一轮新增了“聚焦检查”入口；但用户从主画布浏览世界时，仍需要绕到左侧 subject 列表才能切到“只看某个 subject”的 timeline。对于用户最常用的两个视角来说，这让单 subject 查看路径不够顺。

窄桌面复验时还发现：在 1180×768 视口下，Mutation Editor 展开后顶栏会把 `Mutation Editor` 和 `总视图` 挤成两行 / 竖排，说明底部辅助区的响应式密度还不够稳。

## Changes

- `WorldEngineWorkbenchPreviewSliceCard` 的 subject group 增加漏斗图标按钮：
  - 十字准星：聚焦 subject，用于 Inspector / Mutation Editor 检查。
  - 漏斗：只看 subject，用于切换中间 timeline 过滤。
- `SliceList` 增加 `filterSubject` 事件转发。
- 页面层新增 `viewSubjectTimeline(subjectId)`，将 `selectedSubjectIds` 改成单 subject，并复用 `focusSubject()` 展开 Mutation Editor。
- `MutationEditor` 顶栏做响应式压缩：
  - 标题、slice id 和视图切换保持单行。
  - mutation count / active subject 摘要只在 `xl` 以上显示。
  - `总视图` / `subject 视图` 按钮增加 `whitespace-nowrap`，避免窄中心区竖排。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- 浏览器 1366×768 复验：
  - 点击首个 Slice Card 内 `王都` 的“只看”按钮后，Slice List 从 `5 / 5` 变为 `2 / 5`。
  - 可见切片为 `slice-world-init` 和 `slice-erina-arrives`。
  - Mutation Editor 自动展开，并切到 `王都 · location` 的 subject 视图。
  - 页面 `scrollWidth` 保持 1366，无全局横向溢出。
- 浏览器 1180×768 复验：
  - 同样可以点击 `王都` 的“只看”按钮。
  - 页面 `scrollWidth` 保持 1180，无全局横向溢出。
  - Mutation Editor 顶栏恢复单行，`总视图` / `subject 视图` 按钮不再竖排。

## Plan Deviation

- 本轮原本只打算补 subject timeline 筛选入口；浏览器复验时发现 Mutation Editor 顶栏在窄桌面下明显挤压，所以顺手修了响应式顶栏。这是 UI/UX 验收发现的问题，属于同一轮工作台密度优化。

## Next Notes

- 现在主画布已经同时支持“聚焦检查”和“只看 subject timeline”。后续可以考虑在视觉上进一步弱化未触发的图标按钮，例如只在 subject group hover 时提高对比度，减少卡片默认噪声。
- 底部 Mutation Editor 展开后在 1180 宽高约 333px，仍偏高；后续可评估是否接入 `useResizablePanel` 或增加紧凑高度模式。
