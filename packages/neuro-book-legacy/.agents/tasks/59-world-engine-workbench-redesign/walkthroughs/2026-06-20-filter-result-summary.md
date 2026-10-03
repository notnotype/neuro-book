# 2026-06-20 Filter Result Summary

## Context

上一轮已经让 `search / kind / status / subject` 过滤上下文显式可见，但用户在过滤后仍只能看到 `N / total slices` 和 mutation 数。对于 World Engine Workbench 来说，整体世界巡检更需要回答：“当前结果里还有多少 open review、多少 clean slice、涉及多少 subject”。

本轮把 Slice List 顶部推进为更完整的工作台摘要，让用户恢复浏览器草稿或切换过滤后能马上判断当前时间线的健康分布。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 新增 `WorkbenchPreviewResultStats` 与 `filteredResultStats`。
- Slice List 搜索框下新增 5 格结果摘要：
  - `visible slices`
  - `subjects touched`
  - `open slices / issues`
  - `review done`
  - `clean slices`
- 顶部 subject mode 控件改为上下文式：
  - 无 subject 过滤时显示 `整体世界`。
  - 单 subject 过滤时显示 `单 subject：<name>`。
  - 多 subject 过滤时才显示 `任一 subject / 全部 subject` 切换。
- 目标契约测试补充结果摘要与 scope label 的关键字符串。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：
  - `GET http://localhost:3000/world-engine.workbench-preview` 返回 200。
  - Chrome DevTools Protocol 1920x1080 截图通过：三栏完整，结果摘要条可读，首屏仍能看到 2 张以上 slice 和折叠 Mutation Editor。
  - Chrome DevTools Protocol 1366x900 截图通过：结果摘要条保持一行 5 格，没有明显文本重叠；主画布仍能看到当前 slice 和下一张 slice 开头。

## Notes

- 本轮使用系统 Chrome headless 做验证。直接 `--screenshot` 在 Nuxt dev 页面上截到了白屏，但 `--dump-dom` 已证明 DOM 完整渲染；随后改用 Chrome DevTools Protocol 等待 `世界切片列表` 与 `visible slices` 出现后截图，验证路径恢复。
- 结果摘要会增加中间栏顶部高度，1366x900 下仍可接受；后续如果继续增加工具栏内容，建议把 kind/status 控件压到同一行或做成可折叠 filter drawer。
- 本轮仍保持 mock-only UI/UX，不接真实 API，不改后端 DTO。
