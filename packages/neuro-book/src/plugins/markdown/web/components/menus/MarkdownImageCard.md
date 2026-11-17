---
标签: [state:local, env:timer, env:portal]
别名: ["插图卡片", "Image Card"]
---

# MarkdownImageCard

插图卡片（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 54、58）：贴在光标下方，顶上一行输入（nb-ui `Input` 的 `bare`）加右边的“上传”按钮，下面是图片列表。选中一张图时只发 `insert`，写进正文（相对当前文件的地址、说明）由宿主（`MarkdownMenus`）做。

## 内容

- **空输入**：列出存放目录里的图片，名字倒序、至多 12 张（`media.recent`）；**输入文字**：停手 150 毫秒后按名字在整部作品里找图片、至多 12 张（`media.find`）；**输入的是 `http://` 或 `https://` 开头的网址**：列表只有一行“插入网址的图片”（回车插入这个网址）。
- 每一行是缩略图（32px，懒加载、异步解码，加载失败画占位图标）、名字（过长截中间，扩展名留着）与所在目录（过长截开头，作品根显示 `/`）。整行的 `title` 是资源地址。
- 状态：读取中显示“正在读取”（已有行时不显示，列表不闪）、没有结果显示“没有匹配的图片”、读不了显示原因、查到的比显示的多时末尾一行“还有更多，请输入更多字”。宿主没有提供插图能力（`media` 为 null）时列表区只有“粘贴图片网址即可插入”，“上传”置灰；提供了但没有绑定作品时列表为空、“上传”置灰。

## 交互

- 打开时焦点进输入框；开着时 `session` 变了（宿主又打开一次）重来：清空输入、重新列出。
- 上下键移动高亮（循环），鼠标移到行上也换高亮；回车（只在输入框里）或点一行发 `insert`；没有行（读取中、没有结果）时回车什么也不做。Esc 发 `cancel`。输入法组字时的方向键、回车与 Esc 归输入法，卡片不处理。
- “上传”：点了打开系统的选文件框（只列 PNG、JPEG、GIF、WebP），选了就按宿主的规则存进存放目录（保留原名，`media.localName`，重名加序号）再发 `insert`（实际写下的地址）；传的过程中“上传”置灰（图标转圈），Esc 取消这次上传（`AbortSignal`）；失败给通知（`menus.notify`，同粘贴失败的文字），卡片留着。
- 焦点离开卡片就收起（`dismiss`），**除外**：系统的选文件框开着（点“上传”之后到选完或取消之前，`choosing`）、上传在途、窗口失焦（`document.hasFocus()` 为假）。选文件框关闭（选完或取消，`change`、`cancel`）后焦点回到输入框。
- 请求都带序号与 `AbortSignal`：输入又变了、卡片关了（含再打开）时，没回来的结果丢弃；卸载时放弃在途的读取与上传。卡片关着时回来的上传结果不插入，图已经在作品里的给通知。
- 卡片开着时光标处的竖线（或选区的高亮）由宿主画（`holdCaret`、`holdSelection`）。

## 数据

```ts
type MarkdownImageCardProps = {
    open: boolean;
    /** 宿主每打开一次就加一：变了就重来。 */
    session: number;
    anchor: PopoverAnchor | null;
    menus: EditorMenus;
    /** 插图能力（`markdown/web/media.ts`）；null 是宿主没有提供。 */
    media: MarkdownMedia | null;
    /** 正在编辑的文件的地址：存放目录按它算（`same`、`sibling`）。 */
    current: string | null;
};

type MarkdownImageCardEmits = {
    /** 选定了一张图：作品里的图给 `address`，网址的图给 `url`；`name` 是文件名（说明取它去掉扩展名）。 */
    (event: "insert", image: {address: string | null; url: string | null; name: string}): void;
    (event: "cancel"): void;
    (event: "dismiss"): void;
};
```

没有插槽与 expose。可访问性：输入框是 `combobox`，列表是 `listbox`，行是 `option`（`aria-selected`），`aria-activedescendant` 指向高亮的行。

`state:local`：输入、列表与状态、高亮的行、上传在途、选文件框开着、加载失败的缩略图。`env:timer`：输入的停手延迟（150ms）。`env:portal`：浮层传送到 `body`（`AnchoredPopover`）。

## 不支持

拖放；SVG、AVIF、BMP 的上传（列表里能看到、能插入）；多选文件；压缩、改名、缩放；图片说明与对齐的界面。
