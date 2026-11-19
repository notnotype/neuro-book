# w00050 t11 计划：表情大图预览与贴纸显示

## Context

开发者 2026-11-19 提出两件事：

- 点表情能看大图。
- 有的表情包缩成行内小图看不清，可以设成按贴纸显示，文字里的表情也显示成大图。

决定见 [Task README](README.md) 的决定 1 到 8。设计审查（Sonnet，15 条）之后按 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt) 改过一版。

现状（从代码读到的）：

- 表情在四处画，都用 nb-markdown 的 `buildSticker`（`language/syntax/sticker/view.ts`）：
  - 展示器：`display/static-views.ts:90` 的表情工厂。
  - Markdown 编辑器：`editor/sticker-views.ts`。
  - `PromptTextView`：`prompt/PromptSticker.vue`。
  - 提示词编辑器：`prompt/prompt-editor-extensions.ts:208`。
- 现在点表情都没有反应。编辑器里的表情节点 `selectable: false`，单击把光标放在点击处。
- 大小只有两档：行内小图（`--nb-sticker-size`，1.6em）和单独成段的大图（`.nb-sticker-block`，`--nb-sticker-large-size`，120px）。两档都在 `nb-markdown/src/stickers.css`，判断用 `isLargeStickerBlock`。
- 对话里已有原图预览 `nb-agent-ui/src/vue/parts/OriginalImagePreviewDialog.vue`。附件图片和回复里的 Markdown 图片经视图动作 `image.preview` 打开它，宿主收不到这个动作。编辑器和选择器在 neuro-book 里，用不到它。
- nb-agent-ui 不依赖 nb-markdown。宿主注入的展示器与 `PromptTextView` 的形状，由 nb-agent-ui 的 `ports.ts` 自己声明（`MarkdownActivation`、`PromptTextViewPortProps`）。

依据：

- [`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 输出 10、11、27、39、44、45。
- [`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md) 输出 5。
- [`ui/prompt-editor.md`](../../../../../docs/specs/ui/prompt-editor.md) 输出 14。
- [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“消息”与宿主端口两节。

## 技术选型

无（对话框、复制、开关都用 nb-ui 现有组件）。

## 关键设计

### nb-ui：`ImagePreviewDialog`（从 nb-agent-ui 搬来）

- 搬到 `nb-ui/src/components/feedback/ImagePreviewDialog.vue`，带同名 `.md`。原有行为保留：
  - 贴着图片的卡片，加载中与失败重试；
  - 下载原图；
  - 按可用空间等比缩小。
- 新增属性：
  - `minSize?: number`：长边不到它的图放大到它，仍受可用空间限制。缺省 0，即不放大，原图预览不变。表情传 320（决定 7）。放大时浏览器做平滑插值，不设 `image-rendering`。
  - `copyText?: string` 与 `copyLabel?: string`：给了 `copyText` 时，头部在“下载原图”前面放一个复制图标按钮（nb-ui `IconButton`，`title` 与 `aria-label` 用 `copyLabel`）。复制后图标换成对勾约 1.5 秒。失败时发 nb-ui 通知“复制失败”，按钮不变宽。卡片最窄 240 像素仍放得下标题和三个图标。
- 文案：原来走 `useAgentText`，它背后就是 nb-ui 的文字端口，所以改用 nb-ui 目录。
  - `imagePreview.close`、`downloadOriginal`、`loading`、`loadFailed`、`retry` 搬进 nb-ui 目录，键名改为 `imagePreviewDialog.*`。
  - `imagePreview.image` 留在 nb-agent-ui，`tokenAction` 还在用。
  - `locales.test.ts` 里逐条核对这六条的部分按新位置拆开。
- nb-agent-ui 的 `AgentConversationView` 改用它。删掉旧组件、旧的 `.md` 和 `lab.ts` 里的导出。
- Lab：nb-ui 加场景 `ImagePreviewDialog`，四种状态：普通图、128 像素小图放大、加载失败、带复制的长英文标题。按 390 宽截图。

### nb-markdown：表情带上包与预览信息

- `ResolvedSticker` 加两个**可选**字段：`pack`（表情包 id）、`packTitle`（显示名）。
  - 名字用写法里已经规范化的 `ref.name`，不另加字段。
  - 缺 `pack` 时不能按贴纸显示；缺 `packTitle` 时预览标题只写名字。
  - 包是已发布的公开包，所以字段可选，已有宿主的实现不用改；变更说明里记一笔。
- 新类型 `StickerPreview = {raw, url, name, packTitle?, width, height}`，从包入口导出。
- `buildSticker(document, raw, resolve, options?)`：原来第 4 位的 `report` 并进 `options = {report?, onActivate?}`。四处调用一起改。
  - 查到图时：在根元素写 `data-sticker-pack`。图读失败、回到原文时去掉它。
  - 给了 `onActivate` 时：根元素加类 `is-previewable`（`cursor: zoom-in`），在 `<img>` 上监听 `click`。
    - 以下情况不触发：不是左键、按着 Shift/Ctrl/⌘/Alt、`event.detail > 1`（双击的第二下）、表情在 `a[href]` 里（只走链接）。
    - 占位与原文状态没有 `<img>`，不触发。
  - 再给 `focusable: true` 时：根元素加 `role="button"`、`tabindex="0"`、`aria-label`（宿主给的“查看大图：名字”），回车与空格触发。展示器与 `PromptTextView` 传；编辑器不传，那里的节点不可聚焦，只用鼠标。
- 展示器：
  - `DisplayActivation`（`display/static-views.ts:22`；Spec 里叫 `MarkdownDisplayActivation`）加 `{kind: "sticker"; sticker: StickerPreview}`。
  - 表情工厂把 `host.activate` 接给 `onActivate`。
  - 根上的 `onClick` 在点到 `.nb-sticker.is-previewable img` 时不再找链接，防止同时发出 `link`。
- Markdown 编辑器：`MarkdownViewHost` 加可选的 `previewSticker?: (sticker: StickerPreview) => void`，点击时才读（同 `openLink`）。
  - `sticker-views.ts` 把它接给 `onActivate`。
  - 正在用输入法组字时（`view.composing`）不触发。
  - 不拦 `mousedown`，单击照旧把光标放在点击处。
- `PromptTextView`：加事件 `sticker-activate`。`PromptEditor`（输入框）不接，输入框里点表情不预览（待确认 2）。
- 贴纸的样子：nb-markdown 导出 `mountStickerDisplayStyle(document, packIds): () => void`。
  - 它在 `head` 里维护一个 `<style data-nb-sticker-display>`，再调用就替换内容，交回的函数移除这个元素。
  - 规则只有这一份，选择器带够特异性：
    - `.nb-sticker.has-image[data-sticker-pack="…"]`：去掉负外边距，`vertical-align: bottom`，`max-width: 100%`。
    - 同一选择器后接 ` .nb-sticker__image`：`height: var(--nb-sticker-large-size, 120px)`，`max-width: 100%`，`object-fit: contain`。
  - 包 id 只收 `[a-z0-9._-]`，不合格的丢掉。
  - 宿主与 Lab 都调这个函数，nb-markdown 自己的样式表不加新类。

### neuro-book `nbook.stickers`：显示偏好、样式与选择器

- `web/resolver.ts` 的 `findSticker` 交回 `pack`、`packTitle`。
- 显示偏好：新记录 `stickers.display`，`scope: "user"`、`locality: "shared"`（决定 8：跟着用户走），形状 `{stickerPacks: string[]}`，至多 256 项。
  - 写法照 `web/recent.ts`：读不了时当作空的；保存暂停时只改显示，不提示。
  - 每次写入时，先按当前目录剪掉已经不在的包 id。目录还没取到时不剪。
  - 改包名、删除后重建，id 都会变，偏好随之丢失。这条写进 Spec 的“不承诺”。
- `picker` 入口（已经有可选的 `storageKey`）再提供服务 `stickerDisplayKey: {packs(): readonly string[]; set(id, on): void}`。激活时调 `mountStickerDisplayStyle`，随偏好更新；入口的 `signal` 结束时移除样式。
  - 没有 storage 时偏好只在这次运行里记，同 `memoryRecent`。
  - 不放进 `browser` 入口：那个入口只依赖 `diagnostics`，Markdown 激活时要等它。
  - 偏好读到之前先按小图画，读到后才换成贴纸。这一点写进 Spec。
- 表情包页：`page` 入口加可选依赖 `stickerDisplayKey`，交给 `PackFields`。
  - `PackFields` 在写法与个数下面加一行 nb-ui `Switch`“按贴纸显示”，下面一句小字“文字里的表情也显示成大图”。
  - 所有来源的包都有这一行，只读的包也有。没有这个服务时不显示这一行。
  - 无效的包不走 `PackFields`，没有这一行。
- 选择器 `StickerPickerPanel`：
  - 底部现有的 footer 整块是 `aria-hidden`。在它之外单独放一个图标按钮（`i-lucide-maximize-2`，`aria-label` 写“查看大图：名字”），加 `@mousedown.prevent`，同标签页按钮。
  - 对话框放在面板里，由面板持有 `previewOpen`。打开期间 `onFocusout` 直接返回，否则 reka 的焦点陷阱会让面板发出 `close("blur")`，宿主随即卸载面板。
  - 关掉预览后，焦点由 Dialog 还给按钮。
  - 触屏没有悬停，点格子就是插入，所以触屏上没有预览入口。写进 Spec。

### 其余接线

- `nbook.markdown` 的 `MarkdownControl.vue`：
  - `previewSticker` 三处同改：接口、`viewHost`、`indirectHost` 的 getter（同 `openLink`）。
  - 它自己持有一个 `ImagePreviewDialog`。关掉后焦点回到正文。
- nb-agent-ui：
  - `ports.ts`：`MarkdownActivation` 加 `{kind: "sticker"; sticker: {raw, url, name, packTitle?, width, height}}`（按结构重写一份，不导入 nb-markdown）。`PromptTextViewPortProps` 加 `onStickerActivate`。同步改它们的公开导出、`AgentMarkdown.dom.test.ts` 的 `ACTIVATIONS` 与 Lab 的 `labAgentRenderers`。
  - `view-action.ts`：`PreviewImageRequest` 加 `{url, name, copyText, minSize}`。
  - `AgentMarkdown.vue` 与 `AgentUserContent.vue`：把表情换成 `image.preview`。标题用 nb-agent-ui 目录里的 `stickerPreview.title`（“{name} · {pack}”，没有包名时只写名字）。
  - `AgentConversationView.vue`：把 `copyText`、`minSize` 交给对话框。

### 新增与搬动的文案

| 目录 | 键 | zh-CN | en-US |
|---|---|---|---|
| nb-ui | `imagePreviewDialog.close` 等五条 | 原文搬来 | 原文搬来 |
| nb-ui | `imagePreviewDialog.copied` | 已复制 | Copied |
| nb-ui | `imagePreviewDialog.copyFailed` | 复制失败 | Copy failed |
| nb-agent-ui | `stickerPreview.title` | {name} · {pack} | {name} · {pack} |
| nb-agent-ui | `stickerPreview.copy`、`stickerPreview.open` | 复制写法；查看大图：{name} | Copy code; View larger: {name} |
| nbook.markdown | `stickerPreview.title`、`copy`、`open` | 同上 | 同上 |
| nbook.stickers | `picker.preview`、`preview.title`、`preview.copy` | 查看大图：{name}；同上 | View larger: {name} |
| nbook.stickers | `packs.display.label`、`packs.display.hint` | 按贴纸显示；文字里的表情也显示成大图 | Show as stickers; Large even within text |

## Spec 与文档改动

`agent/stickers.md`：

- 新增输出 46“大图预览”（planned）：
  - 打开的地方：对话里 Agent 的回复、过程说明与思考、用户消息；Markdown 编辑器；选择器底部的按钮。
  - 手势：只认左键单击，不带修饰键，双击不再触发；表情在链接里时只走链接；输入法组字时不触发。展示器与用户消息里的表情可用键盘聚焦，回车或空格打开。能点的表情指针是放大镜。
  - 对话框：标题写“名字 · 包显示名”，有复制写法、下载原图。长边不到 320 像素的放大到 320，大的按原尺寸，放不下就缩小。
  - 占位与原文点了没反应。编辑器里单击时光标照旧落在点击处。
  - 选择器打开预览时面板不关。关掉预览后焦点回到原来的地方。
- 新增输出 47“按贴纸显示”（planned）：
  - 开关在属性栏，所有来源的包都能设，跟着用户（存在用户记录里）。
  - 打开后，这个包的表情在文字里也显示成大图：高度同输出 11 的大图，这一行跟着变高，底边对齐。对话、编辑器与输入框都生效。
  - 切换立刻生效，已经显示出来的也跟着变。按写法认到的那个包算（输出 7）。
  - 窗口刚打开、偏好还没读到时先按小图显示。
- 输出 27：没选表情时的属性栏加上“按贴纸显示”。
- 输出 39：底部有“查看大图”按钮。
- “不承诺”加四条：
  - 输入框里点表情不预览。
  - 预览不能缩放。
  - 触屏上选择器没有预览入口。
  - 改包名、删除后重建的包不保留贴纸显示的设置。
- “已经显示出来的表情不随目录变化重画”那一条后面加一句：贴纸显示的切换不受这条限制。

其余文档：

- `ui/markdown-display.md`：`MarkdownDisplayActivation` 加 `sticker`。输出 5 加“点击表情的图（不在链接里）发出 `{kind: "sticker"}`”。
- `ui/prompt-editor.md`：输出 14 加 `PromptTextView` 的 `sticker-activate`。
- `ui/agent-conversation-view.md`：两处“点击图片打开原图预览”加上表情；宿主端口一节加 `sticker` 与 `onStickerActivate`。
- nb-ui 的 `README.md` 组件清单加 `ImagePreviewDialog`。nb-markdown 变更说明加 `ResolvedSticker` 与 `buildSticker` 参数的变化。

## 切片

1. **nb-ui 预览对话框**：搬组件，加 `minSize`、`copyText`，文案搬目录，nb-agent-ui 改用，Lab 场景。
   - 验证：nb-ui 的 dialog 与 locales 测试；nb-agent-ui 的 `AgentConversationView` 预览测试；typecheck。
   - 单独提交。
2. **nb-markdown**：`ResolvedSticker`、`buildSticker` 的选项与点击、展示器的 activation 与链接判断、编辑器的 `previewSticker`、`PromptTextView` 事件、`mountStickerDisplayStyle`。
   - 验证：`sticker.dom.test.ts`、`display/MarkdownDisplay.dom.test.ts`、prompt 的 dom 测试、typecheck。
   - 单独提交。
3. **预览接线**：nb-agent-ui 的 `ports.ts` 与视图；neuro-book 的 resolver、`MarkdownControl`、选择器按钮。
   - 验证：`resolver.test.ts`、`MarkdownControl.dom.test.ts`、`sticker-picker.dom.test.ts`、nb-agent-ui 视图测试。
4. **贴纸显示**：记录与服务、样式挂载、`PackFields` 开关、Lab 场景（属性栏带开关；英文窄屏一张；`MarkdownDisplay` 夹贴纸的段落，场景自己调 `mountStickerDisplayStyle`）。
   - 验证：`sticker-page.dom.test.ts`、`markdown-wiring.dom.test.ts`。
5. **e2e 与 Spec 证据**：新文件 `e2e/sticker-preview.e2e.ts`，场景见下文。改 Spec，补证据。

## 验收映射

dom 测试只断言形状：类名、属性、事件与载荷。焦点与对话框的判据放在真实浏览器里测（审查第 8 条）。

- 输出 46：
  - `sticker.dom.test.ts`：
    - 点图交出预览；点占位不交；
    - 修饰键、双击第二下、链接里不交；
    - `focusable` 时回车与空格交出。
  - `MarkdownDisplay.dom.test.ts`：点表情只发 `sticker`；链接里的表情只发 `link`。
  - `MarkdownControl.dom.test.ts`：标签重挂之后点表情，仍调到当前挂载的 `previewSticker`。
  - nb-agent-ui 视图测试：回复与用户消息里点表情打开对话框，带标题与复制按钮，宿主收不到预览动作。
  - e2e `sticker-preview.e2e.ts`：
    - 对话里点 Agent 回复中的表情：对话框标题、复制写法后剪贴板里是写法、128 像素的图显示成 320。
    - 编辑器里单击表情打开对话框；关掉后接着打字，字落在点击处。
    - 选择器点底部按钮：对话框打开时面板仍在；关掉后焦点在按钮上；再按 Esc 才关面板。面板“没有被收起”这条是否定断言，先删掉 `previewOpen` 的判断做一次变异，确认会失败。
- 输出 47：
  - `mountStickerDisplayStyle` 的单元测试：生成的选择器，丢掉不合格的 id，重复调用只留一个元素，移除。
  - `sticker-page.dom.test.ts`：开关调到服务，内置包也有开关。
  - e2e：
    - 同一条回复里夹在文字中的表情：打开开关后不重载，图高从约 1.6 倍字高变成 120 像素；关掉后变回去；别的包不受影响。
    - 输入框里插入该包的表情：图高 120 像素，输入框不超过最大高度、内部可以滚动；光标矩形的高度不超过一行字高的 2 倍。光标量出来变高时，回到开发者那里重议待确认 3。
- markdown-display 输出 5、prompt-editor 输出 14：同上面的 dom 测试。

## 验证

- 每片跑上面列的单元与 dom 测试，typecheck。
- Lab 截图：`ImagePreviewDialog`、`StickerPacksPage`（属性栏带开关）、`MarkdownDisplay` 夹贴纸的段落，桌面与 390 宽各一张，亮色。
- e2e 合入前跑一次：
  - `sticker-preview.e2e.ts`（新）；
  - `sticker-picker.e2e.ts`：底部多了按钮；
  - `builtin-stickers.e2e.ts`：对话里的表情能点了；
  - 原图预览所在的对话 e2e：组件搬家了，实施时用 `grep -l "下载原图\|Download original" e2e/` 定文件。
  - 共约 4 个文件。实施中只重跑改动覆盖到的文件。
- 未验证边界：
  - 桌面版：同一份网页，从结构推断无差别。
  - 动图在预览里照常播放，不另测。
  - Safari 与 Firefox 上点按钮不聚焦时的焦点路径：e2e 只跑 Chromium。

## 待确认（开发者 2026-11-19 已确认）

1. 已发出的用户消息里的表情也能预览。
2. 输入框里点表情不预览。
3. 贴纸显示在对话、Markdown 编辑器与输入框里都生效。
4. 贴纸高度与单独成段的大图相同（约 120 像素）。

## 不做与风险

- 不做：
  - 预览里的缩放与左右切换；
  - 按贴纸显示的全局开关；
  - 清单里由包作者声明缺省按贴纸显示；
  - 触屏上的选择器预览。
- 风险：
  - 输入框里的光标挨着 120 像素的行内块时可能变高。由 e2e 那一条量。
  - 搬对话框后 nb-agent-ui 的文案可能缺键。由 nb-ui 的 `locales.test.ts` 与 `default-text.test.ts` 兜底。
