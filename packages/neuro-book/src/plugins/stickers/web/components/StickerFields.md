---
标签: [state:local, state:inject]
---

# StickerFields

表情包页属性栏里选中一个格子时的内容（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 27）：大图、名字、说明、写法、常用、文件信息、删除。选中的是表情时可改（用户的包）或只读（插件的包）；是认不出的图（`item.reason === "name"`）时先要改名字；是没加进来的图（`item.reason === "unlisted"`）时只有“加进来”与“删除文件”。字段的保存按 [`field-draft`](../field-draft.ts) 的规则：回车或离开输入框保存、Esc 还原（输入法组字中的回车与 Esc 是选词与取消组字，不算）、写入交回之前草稿不闪回、成功后输入框对齐目录里的值（服务端会把清空回落成文件名、去空白）、失败回到原值并在底部状态行写原因。

## 布局

自上而下：大图（固定高度的格子，同网格的做法）、名字（读屏标签；表情包插件带来的包只读，名字写成文字）、写法一行（等宽、能复制；认不出与没加进来的没有）、说明（多行，随内容长高）、常用开关（带说明图标）、文件名与宽高大小两行小字、底部一行固定高度的状态行（保存失败的原因；认不出的写名字的规则）、“删除表情”或“删除文件”（危险色，靠左）。顶上是“返回表情包”（组件库的幽灵按钮）。图框用 [`StickerSlot`](StickerSlot.md)。

## 交互

- 名字：回车或离开输入框保存；清空表示用文件名（文件名当不了名字时服务端不收）。说明：离开输入框保存。Esc 还原。
- 常用开关：切换立即保存；保存失败时开关弹回原值，原因写在状态行里。认不出的图在改好名字之前说明与常用不可用。
- 删除按钮发出 `delete`，由页面确认；“加进来”发出 `list`；“返回表情包”发出 `back`。
- 保存期间字段保持用户输入的值；失败后回到目录里的值。

## 数据

```ts
import type {GridItem} from "../pack-view";

type StickerFieldsProps = {
    item: GridItem;
    /** 包的文件夹名，写法 `:包名/名字:` 用 */
    folder: string;
    readonly?: boolean;
    /** 保存一个改动，交回失败原因，成功交回 null */
    commit: (change: {name?: string | null; description?: string | null; common?: boolean}) => Promise<string | null>;
};

type StickerFieldsEmits = {
    (e: "delete"): void;
    (e: "list"): void;
    (e: "back"): void;
};
```

没有插槽与 `expose`，属性不透传。认不出的、没加进来的由 `item.reason` 判断，不另传。

## 隐藏通道理由

- `state:local`：字段草稿、保存失败的原因。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。

## 不支持

- 改文件名；换图片（删掉再加）。
