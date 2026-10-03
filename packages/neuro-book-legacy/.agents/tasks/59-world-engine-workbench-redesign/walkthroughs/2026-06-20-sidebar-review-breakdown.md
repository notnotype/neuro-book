# 2026-06-20 Sidebar Review Breakdown

## Context

左侧 Sidebar 已经有 `active / open / done` stats 和 subject 行级 review 状态，但在用户连续处理 issue 后仍有两个可读性问题：

- 点了左栏 stats 快捷过滤后，列表虽然变了，但没有明确显示当前左栏本地过滤是什么。
- subject 行只显示 `open` 或 `done`，看不出 `done` 里是 `confirmed` 还是 `ignored`，回看 review 决策时信息不够完整。

本轮继续保持左栏只是“查找 / 分流”入口，不改变中间 timeline 的 subject 选择。

## Changes

- Sidebar 顶部在 `active / open / done` 任一快捷过滤启用时显示 `左栏筛选：...` chip。
- chip 提供独立关闭按钮，可直接清空左栏状态过滤；再次点击当前 stats 按钮仍可切回 `all`。
- subject 行 review badge 增加完整 title：`total / open / confirmed / ignored`。
- subject 行在有 done issue 时补充紧凑分布 badge：
  - `N done`
  - `N ok`
  - `N ignored`
- open 和 done 分布可以同时显示，适合未来一个 subject 既有待处理 issue 又有已确认 / 已忽略 issue 的情况。
- 行内 review badge 改为可换行的右对齐布局，避免长标签挤压 subject 名称和 id。
- 静态契约测试补充 `clearSubjectReviewFilter / subjectReviewFilterLabel / subjectReviewTitle / confirmedIssueCount / ignoredIssueCount / 左栏筛选`。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，4 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器 smoke：本轮未重新尝试；此前 in-app browser 访问 localhost preview 被 URL policy 拦截。本轮改动通过组件结构、样式约束和目标测试验证。

## Notes

- 这不是新的业务合同，只是 mock preview 的 UI 表达优化；真实接入时仍需要决定 issue resolution 的持久化实体。
- `ok` 是视觉压缩标签，完整语义通过 title 和 Inspector Review Queue 中的 `已确认` 保留。
