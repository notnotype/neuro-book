# 2026-06-20 Open-only Review Queue

## Scope

本轮继续推进 `/world-engine.workbench-preview` mock UI/UX，不接真实 API，不改后端 DTO。重点把 Inspector 的 Review Queue 从“所有 issue 顺序导航”推进到“默认只看 open issue 的连续处理队列”，并保留全部 issue 回看模式。

## Finding

上一轮已经让 Slice List / Slice Card 支持 triage-aware `open / done / clean`，主画布可以正确区分待处理和已处理 review 切片。但 Inspector 的 Review Queue 仍然把 confirmed / ignored issue 混在导航里。

从用户视角看，连续 review 时最常见的问题不是“所有 issue 的完整顺序”，而是“下一个还没处理的问题在哪里”。如果 queue 继续穿过已处理 issue，用户会觉得处理完成后还在原地打转。

## Changes

- Inspector 新增本地 `reviewQueueMode`：
  - `open`：默认模式，只导航 `status === "open"` 的 issue。
  - `all`：回看模式，展示全部 issue。
- 新增 `visibleReviewQueueItems`，根据当前 queue mode 过滤可见队列。
- `reviewQueuePosition` 改为基于可见队列计算，open-only 模式下显示 open queue 的当前位置。
- `previousReviewQueueItem` / `nextReviewQueueItem` 改为基于可见队列导航。
- 当前 issue 已处理但仍停留在当前 slice 时，Inspector 显示提示：
  - `当前 issue 已处理；继续下一个 open issue，或切到全部 issue 回看。`
- open queue 为空时显示 `open queue clear`。
- Review Queue 增加分段按钮：
  - `只看 open`
  - `全部 issue`
- 按钮文案会随模式切换：
  - open 模式：`上一个 open` / `下一个 open`
  - all 模式：`上一个 issue` / `下一个 issue`
- 目标测试补充静态契约，覆盖 `reviewQueueMode`、`visibleReviewQueueItems`、`activeVisibleQueueIndex`、`currentIssueOutsideVisibleQueue`、`只看 open`、`全部 issue`、`open queue clear` 和 `下一个 open`。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 使用当前 `http://localhost:3000/world-engine.workbench-preview` 完成 smoke：
  - reset 到干净 mock。
  - 点击 Slice List 的 `open 2` 并选择 `东塔地下层被打开`。
  - Inspector Review Queue 默认显示：
    - `只看 open`
    - `全部 issue`
    - `1 / 2`
    - `下一个 open`
    - 不显示 `下一个 issue`。
  - 在 open 列表过滤路径下点击 `确认`：
    - 中间列表自动退出已处理切片并选中剩余 open 切片。
    - Queue 显示剩余 open issue。
  - reset 后不启用中间 open 过滤，直接选择 `东塔地下层被打开` 并点击 `确认`：
    - Inspector 显示当前 issue 已处理提示。
    - open queue 显示剩余 open 数量。
    - `下一个 open` 可用。
    - 点击后跳到 `旧剑旧伤浮现 / masked / memory.旧剑状况`，位置显示 `1 / 1`。
  - 点击 `全部 issue` 后：
    - Queue 回到全量位置，如 `1 / 2` 或 `2 / 2`。
    - 按钮文案切回 `上一个 issue` / `下一个 issue`。
    - 已确认 issue 仍可回看。
  - 全程无横向溢出。
- 浏览器 dev logs 未出现 2026-06-20 新 warn/error。

## Browser Tool Note

验证 `全部 issue` 模式时，Playwright role click 对 `全部 issue` 按钮连续两次出现控制通道超时；重新读取可见 DOM 后确认按钮存在且唯一，改用 DOM 节点点击完成验证。页面本身没有新 warn/error，最终状态验证通过。

## UX Review

- 默认 open-only 符合连续 review 的主要任务：处理完一个问题后，用户的下一步就是剩余 open issue。
- `全部 issue` 保留了审计和回看能力，不会隐藏 confirmed / ignored 的上下文。
- 当当前 issue 已处理但还停留在当前 slice 时，提示语给了明确下一步，避免用户误以为按钮或队列坏了。

## Plan Deviation

- 本轮原本只需要补 queue mode；浏览器验证时发现中间 Slice List 的 open 过滤会自动选中剩余 open 切片，这让 Inspector 的“当前已处理”提示不一定出现。为覆盖 Inspector 自身逻辑，额外做了“不启用中间 open 过滤”的第二条浏览器路径。

## Next Notes

- 后续可以让左侧 Subjects 的 review stats 也区分 open/done。
- 后续可以考虑把 open-only queue mode 持久化到浏览器草稿，但当前它只是 Inspector 内的轻量视图偏好，暂不影响核心 mock 数据。
