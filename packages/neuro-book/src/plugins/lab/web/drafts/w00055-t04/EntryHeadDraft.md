---
标签: [state:inject]
---

# EntryHeadDraft

w00055 t04 第 1 轮静态稿：条目页的页头。开发者 2026-11-27 说空白的条目很空旷，页头中间和右边空着。这里把三种排法画在同一副骨架里：上面一条编辑区的面包屑（真实页面里分组与上级已经写在那里），下面是真实的分页条（宽时是竖排导航）与分页内容（人物分页是真实的 `CharacterCard`）。

- `current`：照现在的条目页。
- `columns`：左栏是条目是谁（可选的立绘头像、名字、简介、别名）；右栏定宽 240，写种类与出场，“在看”在右栏下端、贴着内容（t42 定的位置）；编辑区窄到放不下两栏时右栏折到下面成一行。
- `compact`：一栏，种类与出场写成名字后面的小字，别名并进简介那一行。

另带文字分页没有主文字时的两种空态（`textEmpty`）。只摆样子，点名字、简介、别名不改东西。

## Props

```ts
type EntryHeadDraftProps = {
    layout: "current" | "columns" | "compact";
    entry: "plain" | "person" | "filled";
    /** 填好的人物用立绘做头像。默认 false。 */
    avatar?: boolean;
    /** 宽编辑区：竖排分页。默认 false。 */
    rail?: boolean;
    /** 文字分页的空态。默认 `button`。 */
    textEmpty?: "button" | "line";
    /** 一开始选中的分页。默认第一个。 */
    tab?: string;
};
```

没有事件与插槽。

## 隐藏通道理由

`state:inject`：里面的真实组件（分页导航、“在看”、人物卡）经注入取 canon 的文字与样本图，由台子提供。
