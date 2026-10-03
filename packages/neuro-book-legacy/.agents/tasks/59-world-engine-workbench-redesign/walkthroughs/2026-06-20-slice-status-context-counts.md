# 2026-06-20 Slice Status Context Counts

## Context

Slice List 顶部状态统计卡已经改成快捷过滤入口，并且计数语义是“保留 search / kind / subject 条件，但忽略当前 status”。这让用户在单 subject、某个 kind 或搜索结果里切换 `open / done / clean / draft` 时，能看到稳定的同上下文分布。

继续检查时发现，下方 `status` 分段控件仍有自己的旧计数来源：`open / done / draft` 偏全局，`clean` 没有数字。这会让同一屏里两个 status 入口显示不同数字，尤其在 subject 过滤后容易让用户误以为数据不一致。

## Changes

- 移除 Slice List 内部旧的全局计数：
  - `openReviewSliceCount`
  - `doneReviewSliceCount`
  - `draftSliceCount`
- 下方 `status` 分段控件复用 `statusShortcutStats`：
  - `open` 显示当前上下文里的 open slice 数。
  - `done` 显示当前上下文里的 done slice 数。
  - `clean` 新增当前上下文里的 clean slice 数。
  - `draft` 显示当前上下文里的 draft slice 数。
- 上方状态快捷卡和下方 status 分段控件现在共享同一份状态分布语义。
- 静态契约测试补充 `statusShortcutStats.openSlices / doneSlices / cleanSlices / draftSlices` 断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 本地页面 HTTP 检查：`http://localhost:3000/world-engine.workbench-preview` 返回 200。

## Browser Verification

- 本轮尝试按 in-app Browser skill 连接浏览器，但当前插件目录缺少说明要求的 `scripts/browser-client.mjs`。
- 因为 skill 明确要求缺少该入口时停止并报告，未继续使用其它浏览器控制方式绕过。
- 因此本轮没有完成真实浏览器视觉验收；后续浏览器插件恢复后，需要补验：
  - 在整体世界视角下，顶部状态卡和 status 分段控件数字一致。
  - 在单 subject 过滤下，两个入口仍使用同一组上下文数字。
  - 在 `kind` / `search` 过滤后，status 数字不回退到全局统计。

## Notes

- 本轮仍是 mock-only UI / UX 优化，不接真实 API，不改后端 DTO。
- 这次改动是状态信息一致性优化，目标是减少主画布工具栏里的“同名入口、不同数字”认知噪音。
