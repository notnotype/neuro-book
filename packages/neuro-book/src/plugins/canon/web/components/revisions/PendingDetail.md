---
标签: [state:inject]
别名: ["待处理详情", "Pending Details"]
---

# PendingDetail

待处理视图里选中那一条的详情（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 23）。受控：内容由宿主按种类折好（`pending.ts` 的 `PendingDetailModel`），点了什么发出什么。

## 布局与交互

从上到下，没有的部分不画：

- 一句是什么（标题，中等字重）与它的位置（次级色）。
- 原句：引号里的作品原文；在章节正文里时右边“打开这一章”，发 `open-chapter`。
- 几行“名目：内容”（两列的表：正文写的数、算出来的数、原因、根因、作者当时的决定……）。
- “可能是这几笔”：嫌疑的每一笔一行，写文字与位置，估计的那笔带警告色的“估计”；行尾“改这一笔”（初值一行是“打开条目”），发 `open`。
- 相关对象的链接（“打开这条情节”、条目名、“看那次改动的回执”……），发 `open`。链接的文字可能是整句情节：按钮放不下时截断、悬停看全文。

宽度跟着父容器；标题、原句与名目换行（长串也断开），链接截断，没有横向滚动。

## 数据

```ts
type PendingDetailProps = {
    /** 必填、受控。 */
    detail: PendingDetailModel;
};
type PendingDetailEmits = {
    (event: "open", target: PendingTarget): void;
    (event: "open-chapter", chapter: string): void;
};
```

没有插槽、没有 expose；attrs 落在根上。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
