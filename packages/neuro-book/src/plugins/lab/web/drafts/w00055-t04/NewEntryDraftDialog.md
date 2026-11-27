---
标签: [state:inject]
---

# NewEntryDraftDialog

w00055 t04 第 1 轮静态稿：新建条目对话框改版（开发者 2026-11-27 说不够友好，请 Gemini 当顾问看过）。

- 第一眼只有名字与种类；常用种类做成看得出能点的按钮，选中的是实底。
- “设定组”“位置与出场”各收成一段，收起时段头右边单行写出现在的值，展开有高度过渡。
- 设定组：真实的 `ComponentChecklist`；勾选动过、和种类的默认不同时出“恢复某某的默认”。
- 位置与出场：分组、是谁的马甲、上级条目、出场，四个都是能打字搜的下拉；选了本体以后上级写成“某某（跟着本体）”，不再给框。
- 底栏只有“取消”与“新建”。

数据是本地样本，点了能换状态，不建东西。

## Props

```ts
type NewEntryDraftDialogProps = {
    start: "plain" | "person";
    name?: string;
    groupsOpen?: boolean;
    placeOpen?: boolean;
    sameAs?: boolean;
    customized?: boolean;
    underSelected?: boolean;
};
```

没有事件与插槽。

## 隐藏通道理由

`state:inject`：勾选列表经注入取 canon 的文字，由台子提供。
