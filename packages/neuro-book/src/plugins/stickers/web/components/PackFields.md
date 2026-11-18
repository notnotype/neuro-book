---
标签: [state:local, state:inject]
---

# PackFields

表情包页属性栏里没选表情时的内容（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 27）：表情包自己的显示名、说明、包名与写法、表情个数。用户的包可改显示名与说明（保存规则同 [`StickerFields`](StickerFields.md)：回车或离开输入框保存、Esc 还原、失败回到原值）；包名旁有“改…”，发出 `rename` 由页面开对话框。插件的包只读，写成文字，并写一句“要改就复制到我的”。无效的表情包没有字段，只写原因。

## 布局

自上而下：显示名、说明（多行，随内容长高）、一行“包名 xxx”加“改…”、写法与个数两行小字、底部固定高度的状态行（保存失败的原因）。插件的包：名字（粗）、说明、包名、小字，没有输入框与“改…”。

## 数据

```ts
import type {StickerPackDetail} from "../../shared/contracts";

type PackFieldsProps = {
    detail: StickerPackDetail;
    readonly?: boolean;
    /** 保存一个改动，交回失败原因，成功交回 null */
    commit: (change: {title?: string | null; description?: string | null}) => Promise<string | null>;
};

type PackFieldsEmits = {
    (e: "rename"): void;
};
```

没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：字段草稿、保存失败的原因。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。
