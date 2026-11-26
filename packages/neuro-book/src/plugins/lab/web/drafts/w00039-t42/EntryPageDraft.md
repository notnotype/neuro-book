---
标签: [state:local, env:portal]
---

# EntryPageDraft

w00039 t42 第 1 轮静态稿：条目页的页头、分页与保存后的提示。名字与简介本身就是按钮；时间点与“算上计划”合成一个按钮；分页带图标，末尾是“添加一组设定”；保存后的提示浮在页面下方、不推开内容。样本写死，人物分页的内容是真实的 `CharacterCard`。

```ts
type Props = {
    /** 分页横排在页头下面，或在内容左边竖排；默认 "tabs"。 */
    variant?: "tabs" | "rail";
    /** 画哪个状态；默认 "filled"。 */
    scene?: "filled" | "new" | "notice" | "position" | "plan" | "name-hover";
};
```

没有 emits、slots、expose；attrs 落在根元素上。
