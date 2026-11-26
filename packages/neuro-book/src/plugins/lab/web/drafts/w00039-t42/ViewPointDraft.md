---
标签: [state:local]
---

# ViewPointDraft

w00039 t42 第 2 轮静态稿：条目页页头的“看哪一刻”（读哪条剧情线、哪个时间点）的三种做法。合成一个“在看”控件（按钮写结论，菜单分“故事线”“剧情进度”两段）；两个控件同一种样子、各带名字；页头下面一条时间条（章是刻度，左右一步一步走）。菜单是静态画出来的样子。样本写死，下面是真实的 `Tabs` 与 `CharacterCard`。

```ts
type Props = {
    /** 做法；默认 "merged"。 */
    variant?: "merged" | "labeled" | "timeline";
    /** 状态：缺省、菜单打开、线的菜单打开（只 labeled）、固定看分支线、算上计划、只有主线；默认 "default"。 */
    state?: "default" | "menu" | "line-menu" | "pinned" | "plan" | "main-only";
};
```

没有 emits、slots、expose；attrs 落在根元素上。
