---
标签: [state:local, env:portal]
---

# CharacterViewDraft

w00039 t41 第 2 轮静态稿：人物这一组设定的分页，画成角色卡。立绘读自同一条目上的形象组；短项在锚在这一项上的浮层里改，成段的文字由浮在原处的编辑层改，都不推动别的内容。样本内容写死在组件里，不接世界服务。

```ts
type Props = {
    /** 画哪个状态；默认 "filled"。 */
    scene?: "filled" | "no-look" | "empty" | "edit-suggest" | "edit-ref" | "edit-text" | "add-field";
};
```

没有 emits、slots、expose；attrs 落在根元素上。
