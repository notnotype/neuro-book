---
标签: [state:local, env:portal]
---

# LookViewDraft

w00039 t41 第 2 轮静态稿：形象这一组设定的分页：立绘、外貌、现在穿的、衣柜。立绘在锚在图上的浮层里从作品的图片里选或上传。样本内容写死在组件里，不接世界服务。

```ts
type Props = {
    /** 画哪个状态；默认 "filled"。 */
    scene?: "filled" | "empty" | "pick-image" | "wearing";
};
```

没有 emits、slots、expose；attrs 落在根元素上。
