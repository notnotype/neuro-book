---
标签: [state:local, state:inject]
别名: ["提示词显示", "已发送内容", "Prompt Text View"]
---

# PromptTextView

把一段按 [`PromptEditor`](PromptEditor.md) “文字写法”写的文字原样显示出来，样子与编辑器里一致：引用、技能、选区、命令是小块，图片与文件进上方的附件条、正文留 `#N`，粘贴块默认折叠。用在已发送的消息里。它不是编辑器：没有光标、不能输入，也不挂编辑内核，一屏几十条消息各放一个也不重。

小块、粘贴块与附件条和编辑器共用同一套零件（[`InlineChip`](../chip/InlineChip.md)、[`PromptPasteFrame`](PromptPasteFrame.md)、[`PromptAttachmentStrip`](PromptAttachmentStrip.md)），读入用编辑器同一个解析函数，同一段文字在两处显示成同样的小块与编号。

## 布局

自上而下：附件条、正文。

- **附件条**：正文里有图片或文件小块时出现，每个小块一张卡片，按出现顺序排列，只读（没有“移除”“重试”）。图片卡片的缩略图来自 `resolveThumbnail`，取不到时显示占位图标；文件卡片显示图标与文件名。
- **正文**：一行文字一行，空行保留；长词可断开。字号与颜色继承外层。小块是行内块。
- **表情**（[`agent/stickers.md`](../../../../docs/specs/agent/stickers.md) 输出 44、45）：宿主的 `stickerKnown` 认得出的写法画成行内小图（[`PromptSticker`](PromptSticker.md)，元素与 Markdown 的表情相同），紧挨文字的一侧留间隙；一段（空行分开的连续几行）里只有表情与空白、表情 1 到 3 个时，这一段带 `nb-sticker-block`，表情是大图。认不出的是文字；目录晚到时随宿主的状态重算。
- **粘贴块**：独占一段，超过 3 行时收起，只露出前 3 行，点击展开；展开与否是自己的临时状态，换了 `text` 后全部收起。
- 宽度跟随外层，没有自己的最小宽度；`390×844` 下附件条横向滚动。

## 交互

- 小块与卡片都是可聚焦的按钮。点击或用回车、空格触发小块或附件条里的卡片，发出 `token-activate`，携带的内容与 `PromptEditor` 的同名事件相同，由宿主决定打开引用、预览图片或文件。
- 悬停卡片时同号的小块高亮，反过来也一样；悬停位置标记时同号的粘贴块高亮。
- 可以用鼠标选中正文文字复制，得到的是显示出来的文字；小块不可选中。

## 数据

```ts
import type {PromptEditorToken} from "./prompt-editor.types";

interface PromptTextViewProps {
    /** 必填：按“文字写法”写的文字。 */
    text: string;
    /** 界面语言：只在上面没有注入翻译端口时起作用，决定按钮与说明的文字；缺省 zh-CN。 */
    locale?: MarkdownLocale;
    /** 正文开头显示为命令小块的命令名，不含 `/`；默认没有，开头的 `/名称` 按普通文字显示。 */
    commands?: readonly string[];
    /** 就绪图片的缩略图地址；返回 null 时显示占位图标；默认总是 null。 */
    resolveThumbnail?: (target: string) => string | null;
}

interface PromptTextViewEmits {
    (e: "token-activate", token: PromptEditorToken): void;
}
```

没有 slot 与 expose。未声明的 attribute 落到根元素上。

界面文字读宿主注入的翻译端口（nb-ui 的 `TEXT_PORT_KEY`，宿主要登记本包的目录 `@notnotype/nb-markdown/locales`），语言以端口为准；上面没有注入时按 `locale`（缺省 zh-CN）建缺省端口，提供给子组件与嵌套的 nb-ui 控件（[README](../../README.md#界面文字)）。

## 不支持

- 编辑、粘贴、拖入：要编辑时换成 `PromptEditor`。
- 选中复制得到原文：选中的小块不会写出它的写法。要完整原文用宿主提供的“复制”。
- 文件大小与大段粘贴文件的前两行：文字里只有文件名与目标，卡片不显示这两项。
