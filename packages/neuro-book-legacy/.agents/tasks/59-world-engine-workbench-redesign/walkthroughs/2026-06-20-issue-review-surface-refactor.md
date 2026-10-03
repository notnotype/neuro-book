# 2026-06-20 Issue Review Surface Refactor

## Context

用户指出 `/world-engine.workbench-preview` 右侧 Inspector 已经承载 metadata、health、subjects、State Snapshot 和 raw JSON，再把 `Review Issues` 与全局 `Review Queue` 放进去会让右侧过重。本轮按确认计划重排 issue 展示职责：主画布负责发现问题，底部 Mutation Editor 负责判断和处理，右侧 Inspector 只保留当前 slice 健康摘要。

本轮仍是 mock-only UI / UX 调整，不接真实 API，不改后端 DTO；preview 的 triage 状态仍是浏览器本地草稿。

## Changes

- 中间 Slice Card 增加 compact issue rows：
  - 每张卡片最多展示 3 条 issue。
  - 行内展示 `A/E`、`code`、`subject / attr` 和 triage status。
  - 点击 issue row 会选中 slice、聚焦 subject / attr，并展开底部 Mutation Editor。
  - Slice Card 不承载 `待处理 / 确认 / 忽略` 操作，避免主画布变重。
- Slice List 接入 `reviewQueueItems`：
  - 页面层继续生成全局 review queue。
  - Slice List 按 slice id 分发给对应 Slice Card。
  - `focusReviewIssue` 事件从卡片一路上抛到页面层。
- Mutation Editor 接管 issue 处理：
  - `Review Focus` 展示当前 issue 的 `A/E`、code、subject、attr、message 和 status。
  - `Review Focus` 增加 `待处理 / 确认 / 忽略` 三段控件。
  - 增加 open/all 队列模式、当前位置、triage progress 和上/下一个 issue 导航。
  - 当前 slice 有 issue 但未聚焦时，底部显示 compact issue list；点击后进入 Review Focus。
  - 相关 mutation 行继续高亮，并保留切片前 / 切片后状态对照。
- Inspector 瘦身：
  - 删除完整 `Review Issues` section。
  - 删除全局 `Review Queue` section。
  - `Slice Health` 只显示当前 slice 的 `total / open / confirmed / ignored`。
  - `Slice Health` 增加 `查看问题` 轻量按钮，直达底部 Mutation Editor 的首个 open issue。
  - Inspector 主体职责回到 metadata、当前 slice health、touched subjects、State Snapshot 和 raw JSON。
- 静态契约测试同步更新：
  - 断言 Inspector 不再包含 review 明细 / queue 逻辑。
  - 断言 Slice Card 有 compact issue row 与 focus 入口。
  - 断言 Mutation Editor 有 Review Focus、triage 三段控件、issue compact list 与上/下一个 issue 导航。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。

## Browser Verification

- 未自动运行浏览器验收，遵守项目约束。
- 建议后续确认后检查：
  - 右侧 Inspector 不再显示完整 issue list / Review Queue，State Snapshot 更容易进入第一屏。
  - 中间 Slice Card 能扫到 issue rows。
  - 点击 Slice Card issue row 后，底部 Mutation Editor 展开并定位到对应 subject / attr。
  - 在底部确认 / 忽略 issue 后，中间 badge、status 过滤和底部状态同步更新。

## Notes

- 本轮没有改变真实后端 E/A issue 合同。
- preview triage 仍只是 mock 本地审查状态；未来接真实 API 前，需要单独设计 review state 是否持久化、归属到用户审阅状态还是派生状态。
