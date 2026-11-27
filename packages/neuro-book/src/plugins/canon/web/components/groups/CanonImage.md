---
标签: [state:local, state:inject]
别名: ["设定里的图片", "Canon Image"]
---

# CanonImage

按作品内路径显示一张图（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 53，[`canon/components.md`](../../../../../../../../docs/specs/canon/components.md) 输出 15）：人物的立绘、形象的大图与衣柜、选图片时的缩略图都用它。取图地址经注入的函数算（`images.ts` 的 `provideCanonImageUrl`，纯计算、不读写）。

## 布局与交互

填满父容器给的方框（父容器定大小与比例），图按 `fit` 裁切或缩进去。懒加载、异步解码；读到以后淡入（`--motion-base`），读到之前是背景色的方框。文件不在、读不出来或没有取图地址时画“图片找不到”的占位（图标加一行字，居中）。路径换了就重新读。没有交互，点击由外面处理。

## 数据

```ts
type CanonImageProps = {
    /** 作品内路径。 */
    path: string;
    /** 读屏读的说明；缺省空（装饰）。 */
    alt?: string;
    /** 缺省 "cover"。 */
    fit?: "cover" | "contain";
};
```

没有事件、插槽与 expose；attrs 落在根上。

## 隐藏通道理由

- `state:local`：读到没有、读失败没有，路径换了重置。
- `state:inject`：取图地址的函数（条目页注入，Lab 注入样本图）；canon 的翻译端口（占位的字）。
