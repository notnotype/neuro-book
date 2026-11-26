---
标签: [state:local]
---

# InPlaceEditDraft

w00039 t42 第 2 轮静态稿：就地改编辑控件的三种做法，经真实 `CharacterCard` 的 `editor`、`passage-editor` 插槽放在被改的那一项上。紧凑浮层（意图写成落点“改最初 | 第 3 章变了”，与取消、保存同一行，有连锁影响才出一行提示）；浮层里两项写成结果（“设定改成 18 岁 / 第 3 章里变成 18 岁”）；原地展开（不弹浮层，下面的内容往下让）。只画样子，不保存。

```ts
type Props = {
    /** 做法；默认 "compact"。 */
    variant?: "compact" | "outcome" | "inline";
    /** 改哪一项：年龄、第 2 章改过的“现在在哪”、会多一条待处理的身高、有建议值的性别、长文字的性格、看“最初”时改年龄；默认 "age"。 */
    case?: "age" | "where" | "height" | "gender" | "personality" | "initial";
    /** 浮层的面：不透明或玻璃（只对浮层的两种做法有意义）；默认 "solid"。 */
    surface?: "solid" | "glass";
};
```

没有 emits、slots、expose；attrs 落在根元素上。
