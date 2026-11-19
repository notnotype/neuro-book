---
schema: nbook.task/v2
taskId: t11-sticker-preview-and-display
status: active
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

主 Agent 照推荐定、开发者可改的（计划里“待确认”一节）：已发出的用户消息里的表情同样能预览；输入框里点表情不预览；贴纸显示在对话、编辑器与输入框里都生效；贴纸的高度与单独成段的大图相同（约 120 像素）。

## 当前状态

2026-11-19 计划写好，等开发者确认。

## 下一步

开发者确认计划后做设计审查（前端，派 Sonnet），再按切片实施。
