# 2026-06-20 Slice Kind Context Counts

## Context

上一轮已经让 `status` 快捷卡和下方 status 分段控件共享同一份上下文计数。继续从用户视角检查 Slice List 工具栏时发现，旁边的 `kind` 分段控件仍只有纯文本按钮。

当用户已经进入单 subject、搜索结果或某个 status 巡检视角后，`kind` 按钮无法告诉用户当前上下文里还剩多少 `init / event / backstory` 切片；同时它也缺少 `aria-pressed`，和 status 控件的选中语义不一致。

## Changes

- 新增 `kindShortcutSlices`：
  - 保留当前 search。
  - 保留当前 subject 过滤和 `any / all` mode。
  - 保留当前 status 过滤。
  - 忽略当前 kind 过滤，固定使用 `sliceKindFilter: "all"`。
- 新增 `kindShortcutCountMap`：
  - 基于 `kindShortcutSlices` 聚合每个 kind 的切片数量。
- `kind` 分段控件补充数量：
  - `全部 N`
  - `init N`
  - `event N`
  - `backstory N`
- `kind` 分段控件补充 `aria-pressed`：
  - `全部` 按钮绑定 `props.sliceKindFilter === 'all'`。
  - 每个 kind 按钮绑定 `props.sliceKindFilter === kind`。
- 静态契约测试补充 `kindShortcutSlices / kindShortcutCountMap / sliceKindFilter: "all"` 和 kind `aria-pressed` 断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 本地页面 HTTP 检查：`http://localhost:3000/world-engine.workbench-preview` 返回 200。

## Browser Verification

- 本轮未再次绕过浏览器插件限制。
- 上轮已确认当前 in-app Browser 插件目录缺少 skill 要求的 `scripts/browser-client.mjs`，因此不能按规定连接浏览器完成真实视觉验收。
- 后续浏览器插件恢复后，需要补验：
  - 在整体世界视角下，kind 按钮显示各 kind 数量。
  - 在 `status=open` 后，kind 数字保留 open 上下文，不回退到全局数量。
  - 在单 subject 或 search 过滤后，kind 数字随当前上下文变化。
  - kind 按钮的 visual selected state 与 `aria-pressed` 一致。

## Notes

- 本轮仍是 mock-only UI / UX 优化，不接真实 API，不改后端 DTO。
- 这次改动让 kind/status 两组过滤控件都采用“当前上下文分布”的统一心智，减少工具栏内不同过滤组的行为差异。
