---
schema: nbook.task/v2
taskId: t11-sticker-preview-and-display
status: done
updated: 2026-11-19
---

# 表情大图预览与贴纸显示

## 目标与范围

对话、Markdown 编辑器与表情选择器里点表情看大图；表情包可设成按贴纸显示，文字里的表情也显示成大图。

合同：[`docs/specs/agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 新增输出 46、47（planned），连带 [`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md) 的 `activate`、[`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md) 的 `PromptTextView` 事件、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的原图预览。计划见 [`plan.md`](plan.md)。

## 决定

开发者 2026-11-19 在会话里定：

1. 预览的地方：对话里 Agent 发的表情、Markdown 编辑器、表情选择器面板（“聊天标签选择组件”指选择器面板，不是输入框）。
2. 编辑器里单击表情直接预览。
3. 预览复用对话里现有的原图预览对话框，标题写表情名与包的显示名，头部另加“复制写法”。
4. 选择器里单击仍是插入；预览从底部一行“指着的表情”的图打开（开发者回“可以，先这么做”，认可这条推荐）。
5. 贴纸显示：原地放大，文字里的表情也显示成大图、这一行跟着变高。
6. 贴纸显示按表情包设，不是全局开关。

计划“待确认”1 到 4 开发者 2026-11-19 回“确认，开始”：已发出的用户消息里的表情同样能预览；输入框里点表情不预览；贴纸显示在对话、编辑器与输入框里都生效；贴纸的高度与单独成段的大图相同（约 120 像素）。

设计审查之后开发者 2026-11-19 又定：

7. 预览里长边不到 320 像素的表情放大到 320，大图仍按原尺寸、放不下就缩小；只对表情，附件原图预览不变。
8. “按贴纸显示”的设置跟着用户走（用户记录，`locality: "shared"`），不按客户端分开。

## 当前状态

2026-11-19 完成，已合入 master（747845c93、cd5ce99f7、10711a79c、bffee5b0b、32d386dc3、aa84177c1）；worktree 与分支已删。

- 计划经设计审查（Sonnet，15 条：重要 8、建议 7，[`evidences/design-review.txt`](evidences/design-review.txt)，处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)）。
- 实现审查（Sonnet，11 条：重要 2、建议 9，[`evidences/impl-review.txt`](evidences/impl-review.txt)，处理见 [`evidences/impl-review-disposition.txt`](evidences/impl-review-disposition.txt)）：修了 6 条，接受取舍 4 条，第 7 条（双击第二下可能落在遮罩上关掉预览）没复现、要改得改 nb-ui Dialog，记为风险。
- 与计划的偏差：挂样式表不在 nb-markdown（浏览器入口在后端类型检查范围、也在没有 `document` 的 Bun 宿主里激活），nb-markdown 只出 `stickerDisplayCss`，挂载在 `stickers/web/display-style.ts`，按 owner 各一份；复制按钮用 `CopyButton` 的 `iconOnly`；对话框卡片改成 `fit-content`；e2e 量出来后改为编辑器单击先把光标放到表情后面、选择器预览关上后焦点回到打开前的位置。
- 验证：四个包的 typecheck 与相关单元、dom 测试（变基到最新 master 后重跑）；变异检查 7 处都被抓到；e2e sticker-preview、sticker-picker、builtin-stickers、lab-agent-ui 共 56 条，第一轮 8 条失败（2 条真问题已修，6 条是负载下 Lab 冷启动超时，单独重跑通过），审查修正后 sticker-preview 再跑 4 条全过。变基之后没有再跑 e2e（变基带进来的是别的 Task 的 nb-agent-ui 测试与文档）。
- Spec 晋升：逐句对照测试，换模型复核（Sonnet，[`evidences/spec-check-verify.txt`](evidences/spec-check-verify.txt)）：没有兜底的 7 条里 3 条是“不承诺”的已知限制，其余挪成（planned）或从实现合同删掉；留（planned）的是选择器没指着时对着第一个、放大镜指针、记录是 user/shared 跟着用户、展示器里按贴纸显示、底边对齐与缩到块宽、别的窗口跟着变与记录未读到时先小图、“副作用”里记录的形状与剪枝接线。
- 未验证：输入框里光标挨着 120 像素贴纸时的高度（DOM 量不到）；桌面版（同一份网页，从结构推断无差别）。
