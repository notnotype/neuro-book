---
验证入口: EditorGroup
标签: [state:local, env:portal]
---

# MarkdownStickerMenu

编辑器里打 `:` 的表情补全（[`agent/stickers.md`](../../../../../../../../docs/specs/agent/stickers.md) 输出 42，[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 62）：触发与查询来自 `@notnotype/nb-markdown/editor` 的 `activeSticker`，候选来自表情包插件的选择器服务（`search(query, 8)`，名字、拼音首字母、`包/`），面板是 nb-ui 的 `SuggestionMenu`，一行是小图、名字与表情包的显示名；光标留在正文，在光标下方。照斜杠菜单：键盘在 `scroller` 的捕获阶段先拦下，只有菜单开着时才拦；组字时不显示；Esc 收起后这一处查询不变时不再打开；失焦收起。确认（回车、Tab、点击）把 `:查询` 换成表情（`insertStickerAtTrigger`），并记进最近用过。没有匹配的表情时不显示，回车照常换行。

## 数据

```ts
import type {StickerPicker} from "nbook/plugins/stickers/shared/contracts";

type MarkdownStickerMenuProps = {
    editor: Editor | null;
    scroller: HTMLElement | null;
    readonly: boolean;
    /** 绑定的文档；换了时查询作废。 */
    binding: string | null;
    picker: StickerPicker;
};
```

`state:local`：查询、当前项、是否在组字。`env:portal`：菜单传送到 `body`。
