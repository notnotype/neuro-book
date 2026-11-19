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

计划“待确认”1 到 4 开发者 2026-11-19 回“确认，开始”：已发出的用户消息里的表情同样能预览；输入框里点表情不预览；贴纸显示在对话、编辑器与输入框里都生效；贴纸的高度与单独成段的大图相同（约 120 像素）。

设计审查之后开发者 2026-11-19 又定：

7. 预览里长边不到 320 像素的表情放大到 320，大图仍按原尺寸、放不下就缩小；只对表情，附件原图预览不变。
8. “按贴纸显示”的设置跟着用户走（用户记录，`locality: "shared"`），不按客户端分开。

## 当前状态

2026-11-19 计划经设计审查（Sonnet，15 条：重要 8、建议 7，[`evidences/design-review.txt`](evidences/design-review.txt)）改过一版，处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。

实施在 worktree `.worktree/w00050-t11-sticker-preview`（分支 `feat/w00050-t11-sticker-preview`），5 段都已提交（a482e40c3、1dac30ab6、571607b2c、209dcd18d、7718c048a）。Spec 改动在 master（2b5e59581、3ff67bd43）：stickers 输出 46、47 标 planned，`ui/agent-conversation-view.md` 的表情预览一句等合入时补（另一个会话正在改这份文件）。

与计划的偏差：
- 挂样式表不在 nb-markdown：浏览器入口在后端类型检查范围里、也会在没有 `document` 的 Bun 宿主里激活，nb-markdown 只出纯函数 `stickerDisplayCss`，挂载在 `stickers/web/display-style.ts`。
- 复制按钮用 `CopyButton` 新加的 `iconOnly`，没有另写；对话框卡片从 `width="auto"`（撑满整宽）改成 `fit-content`，贴着图片。
- e2e 量出来改的：编辑器里点图浏览器不移光标，改成先把光标放到表情后面再开预览；选择器的“查看大图”按下不抢焦点，预览关上后焦点回到打开前的位置（通常是搜索框），Spec 同步改了。

验证：
- 各包 typecheck；nb-ui、nb-markdown、nb-agent-ui 全部测试；neuro-book 的 stickers、markdown 插件测试与窗口合同测试；变异检查 5 处（修饰键、链接里、组字、indirectHost 的 getter、面板预览开着时的 focusout）都被测试抓到。
- e2e：sticker-preview（新）、sticker-picker、builtin-stickers、lab-agent-ui 共 56 条。第一轮 8 条失败：sticker-preview 2 条是上面两处真问题；lab-agent-ui 6 条是 Lab 场景 15 秒内没就绪（当时负载 10 以上），修正后连同这 6 条单独重跑 10 条全过。
- 没有量输入框里光标挨着 120 像素贴纸时的高度（DOM 量不到光标的画法），只量了图高 120 与输入框不超过最大高度。

## 下一步

实现审查（Sonnet）进行中，处理后合入。
