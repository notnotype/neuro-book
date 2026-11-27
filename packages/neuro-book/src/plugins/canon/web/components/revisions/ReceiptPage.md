---
标签: [state:inject]
别名: ["回执页", "Receipt Page"]
---

# ReceiptPage

回执页的骨架（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 20、27、28、32）。受控：内容由宿主折好（`receipt.ts` 的 `ReceiptModel`，宿主是 `ReceiptPageHost`），点了什么发出什么。回执页不改别的东西。

## 布局与交互

- 最上面是世界横幅（`WorldBanners`）。
- 页头：标题；一行“谁 · 什么时候 · 种类”；它是一次还原时一行“还原的是：”加被还原的那几次的标题（链接，发 `receipt`）。右边是“还原这次修订”（发 `revert`；窄屏时换到标题下面、靠左）：`revertBlocked` 不为空时不可用、下面写原因；有后面的修订依赖它时可用，下面写“后面有 N 次改动依赖它”。
- “改了什么”按新建、修改、删除、章序分节，节名是小标题。每项是名字（条目、剧情变更是链接，发 `open`；别的对象只写种类）；修改的项下面一张两列的表：字段的显示名，改前（删除线、次级色）→ 改后。
- “带来的变化”：一句一行。
- 内容列封顶 760 像素；窄于 480 像素时左右留白变小、表格的值换行，没有横向滚动。
- 状态 `loading` 只有“读取中…”（`aria-busy`）；`failed` 只有“没有读出来”（`role="alert"`）；`missing` 只有“找不到这次改动”。

## 数据

```ts
type ReceiptPageStatus = "loading" | "failed" | "missing" | "normal";

type ReceiptPageProps = {
    status: ReceiptPageStatus;
    model?: ReceiptModel | null;
    reverted?: readonly {readonly id: string; readonly title: string | null}[];
    /** “还原这次修订”不可用的原因；默认空。 */
    revertBlocked?: string;
    /** 依赖它的后续修订的条数；默认 0。 */
    dependents?: number;
    disconnected?: boolean;
    readOnly?: string;
};
type ReceiptPageEmits = {
    (event: "open", ref: {readonly kind: "entry" | "change"; readonly id: string}): void;
    (event: "receipt", id: string): void;
    (event: "revert"): void;
    (event: "retry"): void;
};
```

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
