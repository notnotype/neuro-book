---
标签: [state:local, state:inject]
别名: ["形象卡", "衣柜", "Look Card"]
---

# LookCard

形象分页的展示层（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 50、51）：只收属性、发事件；绑定层 `LookView` 把 `context` 折成它的属性，并经插槽放进就地改的编辑器（外貌的 `passage-editor` 插槽里的编辑卡带 `data-editing-in-place` 时，外貌原文藏起来但占位不变，编辑卡浮在原处、盖住下面的“现在穿的”，输出 51）。Lab 里直接挂它。

## 布局与交互

- 上面左边大的立绘（3:4、宽度固定），右边外貌（成段的文字）与现在穿的（一行）；下面衣柜。容器窄于 560 像素时立绘在上、缩小。
- 立绘、外貌、现在穿的的值都是按钮，点了发 `edit(id, 按钮)`（立绘的 id 是“立绘”）；立绘空着写“添加立绘”，有图时悬停显出“换一张”。读屏名是“显示名：值”。立绘（`portraitMark`，有图时）、外貌、现在穿的有“第 N 章改过”时它是按钮，发 `origins(id, 按钮)`。外貌与现在穿的的值换了淡入换上。
- 衣柜：一套一张卡（图、名字、样子两行截断，卡的高度不随文字变），现在穿的那一套描强调色边、写“穿着”；别的写“换上”，点了发 `put-on(名字, 按钮)`。卡身点了发 `outfit-edit`；“更多”菜单“改”“去掉”发 `outfit-edit`、`outfit-remove`。名字截断时悬停看全名。末尾“添加一套”发 `outfit-add`。加一套、去掉一套时别的卡滑开。
- 写不了时（`editReason` 非空）各按钮不可用、悬停写原因。

## 数据

```ts
type LookCardProps = {
    portrait: {readonly path: string; readonly alt: string} | null;
    /** 立绘的“第 N 章改过”。 */
    portraitMark?: string;
    appearance?: CardPassage | null;
    wearing?: CardFact | null;
    outfits?: readonly CardOutfit[];
    editReason?: string;
    namespace?: string;
};

type LookCardEmits = {
    (event: "edit", id: string, anchor: HTMLElement): void;
    (event: "origins", id: string, anchor: HTMLElement): void;
    (event: "put-on", outfit: string, anchor: HTMLElement): void;
    (event: "outfit-edit", id: string): void;
    (event: "outfit-remove", id: string): void;
    (event: "outfit-add"): void;
};

type LookCardSlots = {
    editor?(props: {id: string; anchor: HTMLElement | null}): unknown;
    "passage-editor"?(props: {id: string}): unknown;
};
```

## 隐藏通道理由

- `state:local`：各值按钮的元素（给插槽作浮层的锚）。
- `state:inject`：canon 的翻译端口；图的取图地址经 `CanonImage` 注入。
