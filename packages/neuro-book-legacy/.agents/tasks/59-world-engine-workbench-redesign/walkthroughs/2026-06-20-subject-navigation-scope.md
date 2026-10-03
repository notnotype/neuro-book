# 2026-06-20 Subject Navigation Scope

## Context

Mutation Editor 的 subject 视图一直支持“上一个 / 下一个相关 slice”，但此前语义是隐式的：它总是在全量 slices 里找包含当前 active subject 的切片。用户如果已经在 Slice List 里选择了多个 subject，并切换了 `任一 subject / 全部 subject`，底部跳转可能会跳出主画布当前的 subject 过滤心智。

本轮将这个未决点做成显式 UI，而不是在文档里继续悬着。

## Changes

- 新增共享类型 `WorldWorkbenchPreviewSubjectFilterMode = "any" | "all"`。
- Slice List 的 `任一 subject / 全部 subject` 从组件内部状态提升到页面顶层。
- 浏览器 mock 草稿保存 `subjectFilterMode`，旧草稿缺省时默认恢复为 `"any"`。
- Mutation Editor subject 视图新增导航范围切换：
  - `subject 轨迹`：在当前 active subject 的所有相关切片中跳转。
  - `过滤组合`：在当前 subject 过滤组合内跳转，并复用 Slice List 的 `any / all` 语义。
- Mutation Editor 显示当前相关位置 `N / total`，hover 可看到当前导航范围说明。
- 如果用户清空 subject 过滤，Editor 会自动从 `过滤组合` 回到 `subject 轨迹`，避免禁用状态仍被选中。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，4 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器 smoke：本轮未重新尝试；此前 in-app browser 访问 localhost preview 被 URL policy 拦截，未继续绕过。

## Notes

- mock 阶段的产品决策：subject 视图导航默认使用 `subject 轨迹`，因为它最符合“单 subject 查看”的主心智；`过滤组合` 是用户正在做多 subject 过滤时的限定跳转。
- 这仍不等于完整使用 Slice List 的 search / kind / status 可见结果；真实接入前如果需要“完全按当前可见列表跳转”，需要继续把 Slice List 的其它过滤状态提升到页面顶层。
