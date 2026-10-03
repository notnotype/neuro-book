# Round 370 - Browser Acceptance Plan Refresh

## 背景

Round 363 固化了真实作者流浏览器验收清单，但后续 round 365-369 又补齐了主体文件建议的关键入口和反馈：

- `files N` 从只读徽标变成可点击入口。
- 点击 `files N` 后会打开 Inspector 并滚到 `Subject file proposals`。
- 隐藏 Inspector 时，顶栏按钮与右侧恢复 rail 也会直达建议区。
- 主体文件建议复制失败时会显示错误提示。
- 全量 typecheck 已复查，失败仍是无关 `server/agent/tools/control-tools.test.ts`。

如果真实浏览器验收仍按 round 363 原始清单执行，就会漏测这些现在最接近作者实际路径的行为。

## 本轮目标

- 刷新 round 363 浏览器验收清单。
- 明确要验收 proposal 入口直达与复制失败反馈。
- 不执行浏览器验收，等待用户明确允许。

## 更新内容

- `2026-06-22-round-363-real-author-flow-browser-acceptance-plan.md`
  - 背景补充 round 365-369 的最新行为。
  - 多步 slice 保存后的检查项增加：
    - 隐藏 Inspector 的顶栏按钮 / 恢复 rail 点击后应滚到 `Subject file proposals`。
    - slice card `files N` 点击后应选中 slice、打开 Inspector 并滚到建议区。
  - 主体文件建议复制检查项增加：
    - 剪贴板失败时应提示 `复制失败，请手动选择文本后复制。`
  - 回看历史 slice 检查项增加：
    - 历史 slice card 的 `files N` 也应直达该历史 slice 的建议区。

## 验证

本轮只更新文档，没有运行测试或浏览器验收。

## 与计划出入

- 这不是实际验收结果，只是让后续浏览器验收计划对齐当前实现。
- 真实浏览器验收仍需用户明确允许后执行。
