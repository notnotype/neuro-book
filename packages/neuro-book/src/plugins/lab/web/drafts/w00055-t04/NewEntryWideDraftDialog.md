---
标签: [state:inject]
---

# NewEntryWideDraftDialog

w00055 t04 第 2 轮静态稿：新建条目对话框的横版。开发者看第 1 轮（`NewEntryDraftDialog`）时选了“名字、种类加两段可展开”，附言“可以做宽一点，横屏”。

- 宽 820，两栏：左栏是条目本身（名字、种类与常用种类的按钮，下面“位置与出场”一段，收起时段头写出现在的值）；右栏是设定组的勾选列表，一直展开、在栏里滚。选种类时右边的勾选跟着换，因果并排看得见，所以设定组不再收起。
- 勾选动过、和种类的默认不同时，“恢复某某的默认”出现在设定组标题那一行的右端，不推动列表。
- 位置与出场里四项同第 1 轮：分组、是谁的马甲、上级条目、出场，都能打字搜；选了本体，上级写成“某某（跟着本体）”。
- 窄到 640 以下时两栏上下排。

数据是本地样本，点了能换状态，不建东西。

## Props

```ts
type NewEntryWideDraftDialogProps = {
    start: "plain" | "person";
    name?: string;
    placeOpen?: boolean;
    sameAs?: boolean;
    customized?: boolean;
    underSelected?: boolean;
};
```

没有事件与插槽。

## 隐藏通道理由

`state:inject`：勾选列表经注入取 canon 的文字，由台子提供。
