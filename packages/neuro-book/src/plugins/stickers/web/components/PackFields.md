---
标签: [state:local, state:inject]
---

# PackFields

表情包页属性栏里没选表情时的内容（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 27）：表情包自己的显示名、说明、包名与写法、表情个数。用户的包可改显示名与说明（保存规则同 [`StickerFields`](StickerFields.md)：回车或离开输入框保存、Esc 还原、失败回到原值）；包名旁有“改…”，发出 `rename` 由页面开对话框。插件与内置的包只读，写成文字，并写一句“要改就复制到我的”。写法用概要里服务端算好的包段（`summary.writing`，被我的同名包盖住的包写 id）。无效的表情包不走这个组件：页面右边自己写原因与该怎么办。

## 布局

自上而下：显示名、说明（多行，随内容长高）、一行“包名 xxx”加“改…”、写法与个数两行小字、“按贴纸显示”一行（名字带问号说明在左、开关在右，同 StickerFields 的“常用”；只读的包也有，它是偏好、不是包的内容；`stickerDisplay` 为 null 时不画）、底部固定高度的状态行（保存失败的原因）。插件的包：名字（粗）、说明、包名、小字，没有输入框与“改…”。

## 数据

```ts
import type {StickerPackDetail} from "../../shared/contracts";

type PackFieldsProps = {
    detail: StickerPackDetail;
    readonly?: boolean;
    /** 保存一个改动，交回失败原因，成功交回 null */
    commit: (change: {title?: string | null; description?: string | null}) => Promise<string | null>;
    /** 这个包按不按贴纸显示（agent/stickers.md 输出 47）；null（缺省）时不画这个开关。 */
    stickerDisplay?: boolean | null;
};

type PackFieldsEmits = {
    (e: "rename"): void;
    /** 点了开关：受控，由页面写进偏好。 */
    (e: "update:stickerDisplay", on: boolean): void;
};
```

没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：字段草稿、保存失败的原因。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。
