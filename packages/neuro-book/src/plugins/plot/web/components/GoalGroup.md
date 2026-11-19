---
标签: [state:inject]
别名: ["一个人的目标", "Goal Group"]
---

# GoalGroup

一个人的目标与态度（[`plot/author-ui.md`](../../../../../../../docs/specs/plot/author-ui.md) 输出 13、17）：目标表的一组与人物页“目标与态度”分页共用同一种画法。受控，数据由页面给。

## 布局与交互

- 先是态度，一行一个“对某某：态度”（语义档还没归纳时写“还没归纳”）。
- 再是目标，一行一个：左边状态（进行、受挫用警告色、达成、放弃）；中间名字（按钮）、有隐秘时“瞒着别人”，下面“和这些打架：某某：目标”“因为：秘密”（都是按钮）；右边“第 N 章动过”或“出场以后没动过”，停滞时警告色写“N 章没动过”。窄时右边一列换到下一行。
- 名字点了发 `open`。

## 数据

```ts
type GoalGroupProps = {
    /** 目标（作者用的目标表的一组）；必填。 */
    goals: readonly AuthorGoal[];
    /** 态度；必填。 */
    attitudes: readonly AuthorAttitude[];
    names: Readonly<Record<string, {readonly name: string; readonly type: string}>>;
    chapters: ReadonlyMap<string, number>;
};

type GoalGroupEmits = {
    (event: "open", id: string): void;
};
```

没有插槽、没有 expose；`attrs` 落在根上。
