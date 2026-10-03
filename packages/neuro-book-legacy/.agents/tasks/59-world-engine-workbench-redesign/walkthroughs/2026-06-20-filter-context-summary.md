# 2026-06-20 Filter Context Summary

## Context

Slice List 的 `search / kind / status / subject` 过滤已经提升到页面顶层并写入浏览器 mock 草稿。恢复草稿后，用户可能看到当前时间线结果变少，但需要从多个控件里拼出“到底叠了哪些条件”。

本轮目标是让当前浏览视角在顶栏和 Slice List 工具栏中显式可见，并让常见过滤条件可以从同一个位置快速清除或切换。

## Changes

- `/world-engine.workbench-preview` 顶栏的 `worldViewLabel` 改为由 `worldViewFilterParts` 派生。
- 顶栏当前视角现在会合并展示：
  - selected subjects 与 `any / all` 模式。
  - 当前 kind 过滤。
  - 当前 status 过滤。
  - 当前 search 关键词。
- `WorldEngineWorkbenchPreviewSliceList` 新增 `activeFilterChips`。
- Slice List 工具栏新增 `当前筛选` 行：
  - `search` chip 点击清空搜索。
  - `kind` chip 点击恢复全部 kind。
  - `status` chip 点击恢复全部状态。
  - `subject mode` chip 在多 subject 过滤下点击切换 `匹配任一 / 匹配全部`。
- 搜索词 chip 和顶栏摘要都限制显示长度，避免窄桌面下把工具栏挤出。
- 目标契约测试补充新增的视角摘要和 active filter chip 关键字符串。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器 smoke：本轮未自动执行；此前 in-app browser 访问 localhost preview 被 URL policy 拦截，仍不绕过策略。

## Notes

- 本轮没有新增真实 API 或后端 DTO 变更，仍保持 mock-only UI/UX 预览。
- 这轮选择把筛选上下文放在主画布工具栏，而不是只放顶栏。顶栏适合提示“当前视角”，工具栏更适合直接修改过滤状态。
