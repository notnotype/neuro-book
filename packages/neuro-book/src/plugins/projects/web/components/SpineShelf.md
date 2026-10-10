---
标签: []
别名: ["书脊书架", "Spine Shelf"]
---

# SpineShelf

书架页下半的书脊视图（提案 [书架页](../../../../../../../docs/proposals/bookshelf.md)）：一排排 `BookSpine` 立在搁板上，末尾是“新建作品”“加入已有目录”两根虚线书脊。书脊组成一个列表框，当前选中的那部作品的扉页由父组件显示在书架下方。

## 布局

- 书脊靠下对齐、间距 6px，放不下时换到下一层；每层底部一条搁板线（`--divider` 加粗到 2px）。
- 两根虚线书脊与真书脊同高，宽 44px，虚线描边取 `--divider`，文字 `--text-muted`。它们是按钮，在列表框之外；书多时可能换到下一层。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    /** 已排好序。 */
    items: ShelfItem[];
    /** 当前选中的作品；null 时列表框聚焦后选中第一部。 */
    activeId: string | null;
};
type Emits = {
    "update:activeId": [id: string];
    open: [id: string];
    remove: [id: string];
    create: [];
    "add-existing": [];
};
```

## 交互

- 列表框（`role="listbox"`）可聚焦，`aria-activedescendant` 指向选中的书脊。
- 左右方向键在书脊之间移动，Home、End 到两端；Enter 发 `open`；Delete 发 `remove`（确认由父组件做）。
- 点书脊：聚焦列表框并选中它；双击发 `open`。
- 列表为空时只显示两根虚线书脊。
