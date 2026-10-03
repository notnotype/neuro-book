# 2026-06-20 Topbar Draft Summary

## Context

Slice List 已经有 `Draft Queue`，右侧 Inspector 开关也能提示 metadata draft。但当用户在整体世界视角里浏览、过滤或隐藏面板后，仍缺一个全局、稳定的草稿入口。尤其是 search / kind / subject 过滤把草稿 slice 挡掉时，用户需要从顶栏快速回到“只处理草稿”的工作台状态。

本轮补齐顶栏全局 Drafts 汇总入口，并在浏览器里验证它能恢复被过滤挡住的草稿 slice。

## Changes

- `/world-engine.workbench-preview` 顶栏新增 `Drafts` 汇总按钮：
  - 显示所有未应用草稿所在 slice 总数。
  - 分别显示 `meta N` 和 `value N`。
  - title 展示 metadata / value 草稿分布。
- 页面顶层新增草稿派生状态：
  - `valueDraftSliceCount`
  - `draftSliceIds`
  - `totalDraftSliceCount`
  - `draftSummaryTitle`
- 新增 `showAllDraftSlices()`：
  - 清空 slice search。
  - 重置 kind 过滤为 `all`。
  - 重置 subject 过滤。
  - 切换 `status=draft`。
  - 选中时间线上第一个有草稿的 slice。
  - 如果该 slice 有 metadata draft，自动打开 Inspector。
  - 如果该 slice 有 value draft，自动展开 Mutation Editor。
- 静态预览契约测试补充顶栏 Drafts 汇总入口和自动打开处理面板的关键字符串断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：
  - 打开 `http://localhost:3000/world-engine.workbench-preview` 并重置 mock。
  - 修改首个 slice title，确认顶栏显示 `Drafts 1 / meta 1`，右侧显示 Metadata Draft Diff。
  - 展开 Mutation Editor 并修改首个 value，确认顶栏显示 `Drafts 1 / meta 1 / value 1`，Draft Queue 合并显示同一个 slice。
  - 输入 `zzzz-no-match` 让主画布 slice 列表为空，点击顶栏 `Drafts` 后确认 search 被清空、进入 `status drafts`、显示 1 张草稿 slice。
  - 将 Inspector 隐藏、Mutation Editor 收起后再次点击顶栏 `Drafts`，确认 Inspector 自动打开、Mutation Editor 自动展开，草稿处理面板可达。
  - 浏览器 console `warn/error`：无。
  - 最后点击 `重置 mock`，确认 Drafts 按钮消失、search 清空、主画布恢复 6 张 slice。

## Notes

- 本轮仍是 mock-only UI / UX，不接真实 API，不改后端 DTO。
- 顶栏 `Drafts` 是全局入口；中间 `Draft Queue` 仍负责在主画布内部展示具体草稿项和按项定位。
- 这次补丁把“只看草稿”和“打开处理面板”合在一个入口里，避免用户隐藏 Inspector 后看到 meta draft 但不知道从哪里处理。
