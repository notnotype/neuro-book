# 2026-06-20 UX Browser Refinement

## Scope

- 继续推进 `/world-engine.workbench-preview` 的 mock UI / UX。
- 本轮不接真实 API，只用浏览器里的本地 mock 状态验证用户视角体验。
- 重点检查 1920×1080 宽屏和 1366×768 常见笔记本视口。

## Browser Findings

- 初始选中 slice 是第三张，但列表第一屏看不到该卡片，导致 Inspector / Mutation Editor 和主列表上下文脱节。
- 左侧 Schema 四列太窄，`location` / `character` 等 type 名在 1366 宽度下容易截断。
- 1366×768 下左侧 292px + 右侧 410px 让中间主区只有 664px，Mutation Editor 状态值和变更值被明显挤压。
- 选择 subject 过滤后，列表已过滤到相关 slice，但右侧 Inspector 和底部 Mutation Editor 仍可能停在被过滤掉的旧 slice。
- 在 Mutation Editor subject 视图点击“下一个”后，Inspector / Editor 会同步，但上方 slice 列表不会自动滚到选中卡片。

## Changes

- 默认选中首个 slice，让第一屏的主列表、Inspector 和 Mutation Editor 从一开始保持一致。
- 左侧 Schema 摘要改回两列紧凑卡片，避免 type 名截断。
- 左侧栏宽度改为普通桌面 280px、宽屏 292px；右侧 Inspector 改为普通桌面 360px、宽屏 410px。
- Slice card 的 subject mutation 分组在宽屏下使用双列布局，提升主列表密度。
- Slice card 的状态 pill 从固定 `clean` 改为根据 issues 显示 `clean` / `review`，避免有 issue 的 slice 仍显示 clean。
- SliceList 在过滤结果变化时，如果当前 selected slice 不在可见结果中，会自动选中第一个可见 slice。
- SliceList 监听 selected slice 变化，并将对应卡片滚入可见区域，用于 Editor 上 / 下一个相关 slice 导航。

## Verification

- `bun run typecheck`：通过。
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过。
- 浏览器 1920×1080：
  - 无全局页面溢出，document scroll size 与 viewport 一致。
  - 初始 selected slice 在主列表、Inspector、Mutation Editor 中一致。
  - Browser console error：无。
- 浏览器 1366×768：
  - 左侧 Schema 不再截断。
  - 中间主区宽度从 664px 提升到 726px。
  - Inspector 隐藏后中间主区可扩到 1086px。
- 交互验证：
  - 点击 `艾莉娜` subject 后，列表过滤为 `3 / 4 slices · 14 mutations`。
  - subject 过滤后 Inspector / Mutation Editor 自动同步到第一个可见 slice。
  - Inspector 隐藏 / 恢复后布局宽度正确变化。
  - Mutation Editor subject 视图点击“下一个”后，Inspector / Editor 同步到 `slice-moran-tip`，主列表自动滚到该卡片。

## Notes

- Nuxt DevTools 的底部悬浮按钮会覆盖页面底部一小块区域，这是开发环境覆盖层，不属于 preview 页面布局。
- 下一轮建议继续检查：raw JSON 展开后的空间管理、搜索结果为空时的恢复路径、Mutation Editor collapsed 状态在窄宽度下的视觉密度。
