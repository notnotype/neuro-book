---
标签: [state:inject, io:read]
别名: ["谁知道", "Who Knows"]
---

# PointView

秘密（知识点）条目页的“谁知道”分页（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 19）：替换 `nbook.plot.point` 这一命名空间的通用字段表，经 canon 的 `canon.component-views` 交给条目页。

## 布局与交互

- 顶上一个徽标写保密档。
- “角色”：有行的人一行一个（名字按钮、程度、怎么知道或他以为的那句、来处）；人多于一次读取的上限时写“还有 N 项”；末尾写其余的人数（保密以上“别的 N 个人都不知道”，否则“别的 N 个人没有记录”）。
- “读者”：在所选位置的程度，到怀疑以上时写整书第一次从哪一段起与那一段的开头。
- “和它有关的”：决定（结论，或“还没定”与到期章，不可点）、读者守卫、伏笔（按钮与到哪一步）、态度（“某某对某某的态度是从它来的”）、目标（按钮）；都没有时这一节不出。
- 最下面一节“字段”是这一页的通用字段（`context.FieldTable`）：保密、规则、表现、揭穿、读者问题。

## 数据

```ts
type PointViewProps = {
    context: ComponentViewContext;
    reads: CanonReads;
    client: PlotAuthorClient;
};
```

没有事件、插槽与 expose。

## 隐藏通道理由

同 `KnowingView`：`io:read` 读 `point`；`state:inject` 是界面文字。
