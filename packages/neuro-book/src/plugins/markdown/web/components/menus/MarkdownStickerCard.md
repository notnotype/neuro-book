---
验证入口: EditorGroup
标签: [state:local, state:inject, env:portal]
---

# MarkdownStickerCard

Markdown 编辑器里的表情选择器弹层（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 62，[`agent/stickers.md`](../../../../../../../../docs/specs/agent/stickers.md) 输出 39）：nb-ui 的 `AnchoredPopover` 里放表情包插件交出的面板（`StickerPicker.loadPanel()`）。菜单层（`MarkdownMenus`）决定开关与锚点，面板里选了表情发 `pick`，插入与焦点归菜单层。

## 数据

```ts
import type {PopoverAnchor} from "./selection-anchor";
import type {StickerPicker, StickerPickerItem} from "nbook/plugins/stickers/shared/contracts";

type MarkdownStickerCardProps = {
    open: boolean;
    /** 锚点：光标处（同插图卡片），下方放不下时翻到上方。 */
    anchor: PopoverAnchor | null;
    picker: StickerPicker;
};

type MarkdownStickerCardEmits = {
    (event: "pick", item: StickerPickerItem, keepOpen: boolean): void;
    /** Esc（`"escape"`）、焦点离开面板（`"blur"`）。 */
    (event: "close", reason: "escape" | "blur"): void;
};
```

`state:local`：加载到的面板组件。`state:inject`：浮层层级（`AnchoredPopover`）、诊断出口（`markdownReportKey`）。`env:portal`：弹层传送到 `body`。面板的代码第一次打开时才加载，加载失败时弹层不出现，记一条诊断（`markdown.sticker-picker.load-failed`）。
