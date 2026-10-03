# 2026-06-20 Review Focus Strip

## Scope

本轮继续推进 `/world-engine.workbench-preview` 的 mock UI/UX，不接真实 API，不改后端 DTO。重点优化 review issue 定位后的上下文保持：用户从 Inspector 点击 issue 后，Mutation Editor 不只高亮行，还要清楚说明当前正在处理哪个 issue target。

## Finding

上一轮已完成 `Inspector issue -> Mutation Editor attr 行高亮`，但用户点击 issue 后，底部只在 mutation 行里看到 `issue target`。如果视线从 Inspector 移到底部 Editor，用户仍需要回忆：

- 这是哪个 issue code？
- 对应哪个 subject / attr？
- issue message 是什么？
- 高亮何时应该清除？

因此需要一个靠近编辑区域的 Review Focus 状态条，把 issue 上下文留在 Mutation Editor 顶部，并提供明确的“清除定位”动作。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor` 新增 `ReviewFocusContext`，由 `highlightedMutationFocus`、当前 slice issues 和 subjects 推导：
  - `code`
  - `subjectLabel`
  - `subjectId`
  - `attr`
  - `message`
- Mutation Editor 展开时，如果存在 `highlightedMutationFocus`，会在内容区顶部显示 `Review Focus` 状态条。
- 状态条展示 issue code、subject、attr 和 issue message，视觉上沿用 warning 颜色，和 `issue target` 行高亮一致。
- 状态条新增 `清除定位` 按钮：
  - 清除 `highlightedMutationFocus`。
  - 保留当前 slice 和 subject 视图，方便用户继续检查同一 subject。
- route 页面新增 `clearMutationFocus()`，只负责清空 attr 级定位。
- 目标测试补充静态契约，覆盖 `reviewFocusContext`、`Review Focus`、`clearReviewFocus`、`clearMutationFocus` 和 `清除定位`。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 刷新页面。
  - 点击 `review 1`，列表显示 `1 / 6 slices`，选中 `东塔地下层被打开`。
  - 点击 Inspector issue `base-shifted / old-sword / durability`。
  - Mutation Editor 自动展开并显示 `REVIEW FOCUS` 状态条。
  - 状态条展示：
    - `base-shifted`
    - `旧剑`
    - `old-sword`
    - `durability`
    - `旧剑耐久被提前消耗，后续相对变更需要确认。`
  - 命中的 mutation 行仍显示 `issue target`，number input 值为 `-15`，并保留 `切片前 / 切片后` 对照。
  - 点击 `清除定位` 后，`REVIEW FOCUS` 和 `issue target` 消失，当前旧剑 subject 视图仍保留。
  - 页面没有横向溢出。
- dev logs 仍只有 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没发现阻断当前页面挂载和 Review Focus 交互的新错误。

## UX Review

- 改进后，review 检查链路从“列表筛选 -> Inspector 读 issue -> Editor 找行”变成“列表筛选 -> Inspector 点 issue -> Editor 顶部保留问题上下文 -> 行内执行检查 / 编辑”。
- `清除定位` 比自动消失更稳妥：用户可以自己结束问题定位，同时不丢失正在看的 subject 视角。
- 状态条只在 Mutation Editor 展开且有 issue target 时出现，不抢默认浏览切片的首屏空间。

## Plan Deviation

- 原本本轮只计划补可见上下文，实际额外补了清除定位事件，让高亮状态有完整生命周期。
- 本轮仍不实现 issue 确认 / 忽略 / 解决动作；这些动作需要真实业务语义或更明确的 mock issue workflow。

## Next Notes

- 后续可以设计一个轻量 `Review Queue`：在 Slice List 或 Inspector 顶部显示当前 review issue 序号，并支持上 / 下一个 issue。
- 如果真实 API 接入 issue 处理动作，当前 `Review Focus` 可以成为“定位问题”的稳定入口，不和“处理问题”的状态混在一起。
