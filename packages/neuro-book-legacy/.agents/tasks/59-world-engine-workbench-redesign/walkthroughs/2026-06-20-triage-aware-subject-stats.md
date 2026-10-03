# 2026-06-20 Triage-aware Subject Stats

## Scope

本轮继续推进 `/world-engine.workbench-preview` mock UI/UX，不接真实 API，不改后端 DTO。重点把左侧 Subjects 的 review 状态升级为 triage-aware，让 subject 视角也能区分 `open / done`。

## Finding

前几轮已经让 Slice List、Slice Card 和 Inspector Review Queue 都理解 `open / done`。但左侧 Subjects 仍然只显示 raw `1 issue`：

- 用户从 subject 视角无法知道这个主体的问题是否已经处理。
- 顶部 review 汇总只表示“有 issue 的 subjects”，不能表达剩余 open 数。
- 主画布和右侧 Inspector 已经说 `done`，左侧却仍像未处理，心智不一致。

因此本轮优先让 Sidebar 跟上 triage 语义，而不是继续增加新的右侧能力。

## Changes

- 扩展 preview-only `WorldWorkbenchPreviewSubjectStat`：
  - `openIssueCount`
  - `doneIssueCount`
  - `confirmedIssueCount`
  - `ignoredIssueCount`
  - 保留 `issueCount` 作为 raw total。
- route 页面 `subjectStats` 改为根据 `issueTriageMap` 聚合 issue 状态。
- Sidebar 顶部 stats 从 `active / review` 改为：
  - `active`
  - `open`
  - `done`
- Subject 行 badge 从 raw `N issue` 改为：
  - `N open`：仍有待处理 issue。
  - `N done`：该 subject 的 issue 已全部确认或忽略。
- 目标测试补充静态契约，覆盖 `openReviewSubjectCount`、`doneReviewSubjectCount`、`openIssueCount`、`doneIssueCount`、`confirmedIssueCount` 和 `ignoredIssueCount`。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 使用当前 `http://localhost:3000/world-engine.workbench-preview` 完成 smoke：
  - reset 到干净 mock。
  - 左侧顶部显示 `open2 / done0`。
  - 左侧 subject 行显示 `1 open`，不再显示旧的 `1 issue`。
  - 点击 `东塔地下层被打开`，在 Inspector 中确认 `old-sword.durability` issue。
  - 左侧顶部变为 `open1 / done1`。
  - `艾莉娜` 行仍显示 `1 open`。
  - `旧剑` 行显示 `1 done`。
  - 页面无横向溢出。
- 浏览器 dev logs 未出现 2026-06-20 新 warn/error。

## Browser Tool Note

浏览器验证时，Playwright role/text click 对部分主画布和按钮选择器出现控制通道超时。重新读取可见 DOM 后，改用 DOM 节点点击完成同一条用户路径验证。页面状态和日志均正常。

## UX Review

- 左侧 subject 视角现在与中间 Slice List、右侧 Inspector 使用同一套 review 语言：`open / done`。
- 用户可以从 subject 列表直接判断哪个主体还需要 review，而不用先点进 slice 或 queue。
- `issueCount` 仍保留在类型里，后续真实 API 可以同时提供 raw total 与 triage breakdown。

## Plan Deviation

- 原计划只说“左侧 Subjects stats 区分 open/done”；实际同时扩展了 confirmed / ignored 计数字段，方便后续如果要在 Sidebar tooltip 或详细行中展示更细的处理来源。

## Next Notes

- 后续可以把 Sidebar 的 `open / done` subject stats 做成可点击快捷过滤，例如只看仍有 open issue 的 subjects。
- 后续可以给 subject 行增加更细的 hover/title，展示 `confirmed / ignored` 分布。
