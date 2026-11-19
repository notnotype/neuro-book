# w00050 t11 计划：表情大图预览与贴纸显示

## Context

开发者 2026-11-19 提出两件事：

- 点表情能看大图。
- 有的表情包缩成行内小图看不清，可以设成按贴纸显示，文字里的表情也显示成大图。

决定见 [Task README](README.md) 的决定 1 到 6。

现状（从代码读到的）：

- 表情在三处画，都用 nb-markdown 的 `buildSticker`（`nb-markdown/src/language/syntax/sticker/view.ts`）：展示器（Agent 回复，`display/renderer.ts` 的块后处理）、Markdown 编辑器（节点视图）、提示词编辑器与 `PromptTextView`（`prompt/prompt-editor-extensions.ts`）。点了都没有反应：编辑器里的表情节点 `selectable: false`，单击把光标放在点击处。
- 大小只有两档：行内小图（`--nb-sticker-size`，1.6em），以及单独成段的大图（`.nb-sticker-block`，`--nb-sticker-large-size`，120px）。两档都写在 `nb-markdown/src/stickers.css`，判断是 `isLargeStickerBlock`。
- 对话里已经有原图预览：`nb-agent-ui/src/vue/parts/OriginalImagePreviewDialog.vue`。附件图片和回复里的 Markdown 图片经视图动作 `image.preview` 打开它，宿主收不到这个动作。编辑器和选择器在 neuro-book 里，用不到它。

依据：

- [`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 输出 10、11、27、39、44、45。
- [`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md) 输出 5。
- [`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md) 输出 14。
- [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 中“消息”一节对原图预览的规定。

## 技术选型

无（没有通用问题；对话框、复制按钮、开关都用 nb-ui 现有组件）。

## 关键设计

### nb-ui：`ImagePreviewDialog`（从 nb-agent-ui 搬过来）

- 把 `OriginalImagePreviewDialog` 搬成 `nb-ui/src/components/feedback/ImagePreviewDialog.vue` 与同名 `.md`。
  - 行为原样保留：贴着图片的卡片、原尺寸不放大、加载与失败重试、下载原图。
  - 新增插槽 `actions`：放在头部“下载原图”的前面，表情用它放“复制写法”（nb-ui 的 `CopyButton`）。
  - 文案从 `useAgentText` 改成 nb-ui 的翻译端口（`nb-ui/src/locales`），键沿用原文字。
- nb-agent-ui 的 `AgentConversationView` 改用它，删掉旧组件、它的 `.md` 与 `lab.ts` 里的导出。
- 理由：编辑器、选择器、对话三处要一模一样的预览。只在一个包里时，另两处得各写一份。
- Lab：nb-ui 加场景 `ImagePreviewDialog`（普通图、加载失败、带 actions 的长英文标题），按 390 宽截图。

### nb-markdown：表情带上包与预览信息

- `ResolvedSticker`（`stickers.ts`）加三个只读字段：
  - `pack`：表情包 id。
  - `name`：表情名。
  - `packTitle`：包的显示名。
- 新类型 `StickerPreview = {raw, url, name, packTitle, width, height}` 从包入口导出。
- `buildSticker(document, raw, resolve, report, onActivate?)`：
  - 查到图后，在根元素上写 `data-sticker-pack=<id>`。贴纸显示靠它，见下一节。
  - 给了 `onActivate` 时，在 `<img>` 上监听 `click`，交出 `StickerPreview`。占位与原文状态点了不触发。
  - 三处调用方都经这个参数接入，不各自找元素。
- 展示器：`MarkdownDisplayActivation` 加 `{kind: "sticker"; sticker: StickerPreview}`，块后处理把 `host.activate` 接给 `onActivate`。
- Markdown 编辑器：`MarkdownViewHost` 加可选的 `previewSticker?: (sticker: StickerPreview) => void`，点击时才读（同 `openLink`）。
  - 节点视图把它接给 `onActivate`。不拦 `mousedown`，单击照旧把光标放在点击处，同时打开预览。
- `PromptTextView`：加事件 `sticker-activate`。`PromptEditor`（输入框）不接，输入框里点表情不预览（待确认 2）。
- 贴纸的样子：`stickers.css` 加一条规则，类名 `.nb-sticker.has-image.is-sticker-display`。高度用大图的 `--nb-sticker-large-size`，不收负外边距，底边对齐，宽不超过块宽。
  - 再导出 `stickerDisplayStyle(packIds: readonly string[]): string`，交回一段 CSS：按 `[data-sticker-pack="…"]` 选中这些包的表情，套用上面那组声明。
  - 尺寸规则因此只写在 nb-markdown 一处，宿主只决定哪些包要这样显示。
  - 包 id 的字符集是 `[a-z0-9._-]`（输出 18 的 id 规则），放进带引号的属性选择器不用转义。这一点在函数里核对，不合格的 id 丢掉。

### neuro-book `nbook.stickers`：显示偏好、样式与选择器

- `web/resolver.ts` 的 `findSticker` 交回 `pack`、`name`、`packTitle`。
- 显示偏好：新记录 `stickers.display`，`scope: "user"`、`locality: "shared"`，形状 `{stickerPacks: string[]}`，至多 256 项。
  - 写法照 `web/recent.ts`：`defineRecord` 加 `defineStore`，读不了时当作空的，保存失败时通知。
  - 存在用户记录里，不写进清单，所以内置和插件的包也能设。
- 浏览器入口激活时，在 `document.head` 挂一个 `<style data-nbook-sticker-display>`，内容是 `stickerDisplayStyle(偏好里的包)`，随偏好变化更新，插件停用时移除。
  - 已经画出来的表情不用重画，切换立刻生效。这绕开了“已显示的表情不随目录重画”这条已知限制。
- 表情包页 `PackFields`：在写法与个数下面加一行 nb-ui `Switch`“按贴纸显示”，旁边一句小字“文字里的表情也显示成大图”。
  - 所有来源、只读的包都有这一行，因为它是偏好，不是包的内容。
  - 无效的包不走 `PackFields`，没有这一行。
- 选择器 `StickerPickerPanel`：底部一行的小图改成按钮（`aria-label` 写“查看大图”），点了在面板之上打开 `ImagePreviewDialog`。
  - 面板不关；关掉预览后焦点回到这个按钮。
  - 要核对面板的“焦点离开就收起”不会被对话框的焦点陷阱触发。
- 复制写法：复制的是 `raw`，也就是显示出来的那个写法原文。

### neuro-book 其余接线

- `nbook.markdown` 的 `MarkdownControl.vue`：给 `MarkdownViewHost` 传 `previewSticker`，自己持有一个 `ImagePreviewDialog`。关掉后焦点回到正文。
- 对话（`nb-agent-ui`）：
  - `view-action.ts`：`PreviewImageRequest` 加一种 `{url, name, copyText}`。
  - `AgentMarkdown.vue`：把 `kind: "sticker"` 换成 `image.preview`，标题是“名字 · 包显示名”。
  - `AgentUserContent.vue`：接 `PromptTextView` 的 `sticker-activate`，同样换成 `image.preview`。
  - `AgentConversationView.vue`：遇到带 `copyText` 的预览请求时，在 `actions` 里放复制按钮。

## Spec 与文档改动

`agent/stickers.md`：

- 新增输出 46“大图预览”（planned）：
  - 在哪些地方能打开：对话里 Agent 的回复、过程说明与思考、用户消息；Markdown 编辑器；选择器底部那一行。
  - 对话框的样子：标题、复制写法、下载、原尺寸不放大。
  - 占位与原文点了没反应。编辑器里单击时光标照旧落在点击处。关掉预览后焦点回到原来的地方。
- 新增输出 47“按贴纸显示”（planned）：
  - 开关在属性栏，所有来源的包都能设，存在用户记录里。
  - 打开后，这个包的表情在文字里也显示成大图：高度同输出 11 的大图，这一行跟着变高，底边对齐。对话、编辑器与输入框都生效。
  - 切换立刻生效，已经显示出来的也跟着变。按写法认到的那个包算（输出 7）。
- 输出 27：没选表情时的属性栏加上“按贴纸显示”。
- 输出 39：底部一行的图能打开预览。
- “不承诺”加两条：
  - 输入框里点表情不预览。
  - 预览不能缩放。
- 输出 26 那句“已经显示出来的表情不随目录变化重画”保持不变，但写明贴纸显示的切换不受它限制。

其余文档：

- `ui/markdown-display.md`：`MarkdownDisplayActivation` 加 `sticker`，输出 5 加“点击表情的图发出 `{kind: "sticker"}`”。
- `ui/prompt-editor.md`：输出 14 加 `PromptTextView` 的 `sticker-activate`。
- `ui/agent-conversation-view.md`：两处“点击图片打开原图预览”加上表情。
- nb-ui 的 `README.md` 组件清单加 `ImagePreviewDialog`。

## 切片

1. **nb-ui 预览对话框**：搬组件、加 `actions`、文案换端口、nb-agent-ui 改用、Lab 场景。
   - 验证：`bun run --cwd packages/nb-ui test`（相关 dom 测试），nb-agent-ui 中 `AgentConversationView` 的预览测试，typecheck。
   - 单独提交。
2. **nb-markdown**：`ResolvedSticker` 加字段、`buildSticker` 加属性与点击、展示器 activation、编辑器 `previewSticker`、`PromptTextView` 事件、`stickerDisplayStyle` 与 CSS。
   - 验证：`sticker.dom.test.ts`、`display/MarkdownDisplay.dom.test.ts`、prompt 相关 dom 测试，typecheck。
   - 单独提交。
3. **neuro-book 预览接线**：resolver 加字段、对话的视图动作、`MarkdownControl`、选择器底部按钮。
   - 验证：`resolver.test.ts`、`MarkdownControl.dom.test.ts`、`sticker-picker.dom.test.ts`、nb-agent-ui 视图测试。
4. **neuro-book 贴纸显示**：记录、样式挂载、`PackFields` 开关、Lab 场景（`StickerPacksPage` 的属性栏带开关，英文窄屏一张）。
   - 验证：`sticker-page.dom.test.ts`、`markdown-wiring.dom.test.ts`。
5. **e2e 与 Spec 证据**：新文件 `e2e/sticker-preview.e2e.ts`，场景见下文。改 Spec，补证据。

## 验收映射

- 输出 46：
  - nb-markdown `sticker.dom.test.ts`：点图交出预览、点占位不交、写了 `data-sticker-pack`。
  - `MarkdownDisplay.dom.test.ts`：点表情发出 `sticker`。
  - `MarkdownControl.dom.test.ts`：编辑器里单击打开对话框、光标在点击处、关掉后焦点回到正文。
  - `sticker-picker.dom.test.ts`：点底部的图打开预览、面板不关、焦点回到按钮。
  - nb-agent-ui 的视图测试：回复与用户消息里点表情打开预览、标题、复制按钮，宿主收不到预览动作。
  - e2e：对话里点表情看到预览。
- 输出 47：
  - `stickerDisplayStyle` 的单元测试：选择器、丢掉不合格的 id。
  - `sticker-page.dom.test.ts`：开关写记录、内置包也能设。
  - e2e：同一条回复里夹在文字中的表情，打开开关后不重载，图高从约 1.6 倍字高变成 120 像素；关掉后变回去；别的包不受影响。
- markdown-display 输出 5、prompt-editor 输出 14：同上面的 dom 测试。

## 验证

- 每片跑上面列的单元与 dom 测试，typecheck。
- Lab：截 `ImagePreviewDialog`、`StickerPacksPage`（属性栏带开关）、`MarkdownDisplay` 夹着贴纸的段落，桌面与 390 宽各一张，亮色。
- e2e 合入前跑一次：
  - 新文件 `sticker-preview.e2e.ts`。
  - `sticker-picker.e2e.ts`：底部一行的按钮可能影响已有定位。
  - `builtin-stickers.e2e.ts`：对话里的表情多了点击。
  - 原图预览所在的那条 agent 对话 e2e：组件搬家了，实施时按 `grep -l "下载原图\|image-preview" e2e/` 定文件。
  - 共约 4 个文件。实施中只重跑改动覆盖到的文件。
- 未验证边界：桌面版（同一份网页，从结构推断无差别）；动图在预览里照常播放，不另测。

## 待确认

主 Agent 照推荐定的，开发者可以改：

1. 已发出的用户消息里的表情也能预览（与回复一致；“Agent 发的”之外多出的一处）。
2. 输入框里点表情不预览：输入框是在打字，单击用来放光标。
3. 贴纸显示在对话、Markdown 编辑器与输入框里都生效：三处共用一套样子，编辑时看到的就是发出去的样子。代价是输入框里每个贴纸约 120 像素高，输入框会被撑高。
4. 贴纸高度与单独成段的大图相同（约 120 像素），不另设一档中间尺寸。

## 不做与风险

- 不做：预览里缩放与左右切换；按贴纸显示的全局开关；清单里由包作者声明缺省按贴纸显示。
- 风险：
  - 选择器面板在对话框打开时被“焦点离开”收起。由 `sticker-picker.dom.test.ts` 的那条用例兜底，用真实的 nb-ui `Dialog`。
  - 搬对话框改变了 nb-agent-ui 的文案来源，可能出现缺键。由 nb-ui 的 `locales.test.ts` 与 `default-text.test.ts` 兜底。
