# 2026-06-20 Mock Issue Triage

## Scope

本轮继续推进 `/world-engine.workbench-preview` mock UI/UX，不接真实 API，不改后端 DTO。重点给 Inspector 的 review issue 增加本地 triage 状态，让用户可以在 mock 预览中体验 `待处理 / 已确认 / 已忽略` 的检查流程。

## Finding

上一轮已经完成 `Review Queue`，用户可以在多个 review issues 之间连续跳转。但 queue 仍然只有“导航”，没有“处理进度”，用户无法判断哪些 issue 已经看过、哪些还需要继续检查。

因为当前页面仍是 UI/UX mock，本轮不应把 issue 状态写回 slice DTO，也不应提前设计真实后端 issue resolution 合同。因此 triage 状态需要是 preview-only 的浏览器草稿状态，并通过稳定 issue key 关联到派生出来的 review issue。

## Changes

- 新增 preview-only issue triage 类型：
  - `WorldWorkbenchPreviewIssueStatus`
  - `WorldWorkbenchPreviewIssueTriageState`
  - `WorldWorkbenchPreviewIssueTriagePatch`
  - `WorldWorkbenchPreviewIssueTriageSummary`
- `WorldWorkbenchPreviewReviewQueueItem` 新增 `key` 和 `status`，让 Inspector 可以直接展示当前 issue 状态。
- route 页面新增 `issueTriageStates`，用稳定 key 保存 mock issue 状态。
- route 页面新增 `reviewTriageSummary`，聚合 `open / confirmed / ignored / done / total`。
- route 页面新增 `updateIssueTriage()`，处理 Inspector 上抛的状态变更，并更新顶栏 notice。
- 本地 mock 草稿版本从 `v2` 升到 `v3`，key 改为 `neuro-book:world-engine-workbench-preview:draft:v3`，避免旧草稿遮蔽新增状态结构。
- localStorage 草稿新增 `issueTriageStates`：
  - 刷新后恢复 triage 状态。
  - `重置 mock` 清空 triage 状态。
- Inspector `Review Queue` 增加进度摘要：
  - `open N`
  - `done X / total`
  - `confirmed`
  - `ignored`
- Inspector `Review Issues` 中每条 issue 增加状态 chip 和操作：
  - `确认`
  - `忽略`
  - `重新打开`
  - `定位` 仍保留，用于跳到 Mutation Editor 的 issue target。
- 目标测试补充静态契约，覆盖 `issueTriageStates`、`updateIssueTriage`、`reviewTriageSummary`、v3 草稿 key、triage 类型和 Inspector 操作文案。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 使用当前 `http://localhost:3000/world-engine.workbench-preview` 完成 smoke：
  - 页面渲染正常，初始无横向溢出。
  - 点击 `review 2` 并选择 `东塔地下层被打开`。
  - Inspector 显示 `open 2` 和 `done 0 / 2`。
  - 当前 issue 显示 `确认`、`忽略` 和 `定位`。
  - 点击 `确认` 后：
    - 进度变为 `open 1`、`done 1 / 2`。
    - issue 状态显示 `已确认`。
    - 出现 `重新打开`。
  - 刷新页面后：
    - 顶栏显示恢复浏览器草稿。
    - `open 1`、`done 1 / 2` 和 `已确认` 仍保留。
  - 点击 `忽略` 后：
    - 状态切换为 `已忽略`。
    - 进度仍为 `open 1`、`done 1 / 2`。
  - 点击 `重新打开` 后：
    - 进度恢复 `open 2`、`done 0 / 2`。
    - 状态恢复 `待处理`。
  - 点击 `重置 mock` 后：
    - Slice List 回到 `6 / 6 slices`。
    - triage 进度恢复 `open 2`、`done 0 / 2`。
    - 页面不再显示 `已确认` 或 `已忽略`。
    - 全程无横向溢出。
- 浏览器 dev logs 未出现 2026-06-20 新的 warn/error；仅能看到历史会话中的 2026-06-19 旧残留。

## UX Review

- triage 状态让 Review Queue 从“跳转工具”变成了轻量工作流：用户能看到剩余 open 数量和已处理数量。
- `确认 / 忽略 / 重新打开` 放在 Inspector 的 issue 行内，符合右侧上下文检查区的职责；Mutation Editor 仍只负责查看和编辑具体 mutation。
- 由于状态不写入 slice DTO，本轮没有提前承诺真实 issue resolution 的后端语义，后续迁移到真实 Workbench 时可以更从容地设计合同。

## Plan Deviation

- 原计划只提到“增加本地 mock issue triage 状态”；实际实现中同步升级了 localStorage draft 版本到 v3，并补齐刷新恢复 / reset 清除的浏览器验证。
- 本轮没有让 Review Queue 自动跳过已处理 issue。当前 queue 仍展示所有 issues，只通过状态和进度表达处理结果。

## Next Notes

- 后续可以考虑增加 `只看 open` 队列模式，避免 confirmed / ignored issue 在连续检查中反复出现。
- 接真实 API 前，需要先确认 issue resolution 是否属于 slice 派生状态、用户审阅状态，还是 resettle / consistency review 的独立实体。
