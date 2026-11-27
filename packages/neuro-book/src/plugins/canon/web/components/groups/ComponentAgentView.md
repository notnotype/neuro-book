---
标签: [state:inject]
别名: ["AI视图", "给 AI 看", "设定组的模型视图", "Component Agent View"]
---

# ComponentAgentView

设定组分页的“AI视图”（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 54）：Agent 工具 `canon_read` 读这个条目时这一组的那一节，原样摆出来。字由宿主用 `canon/shared/agent-fields.ts` 的 `fieldsText` 写好传进来，和后端给模型的是同一个函数写的，这里只负责显示。

## 布局

- 上面一行弱色小字“在看：<位置>”，下面是那段字：等宽字体、保留换行、长行折行，浅底细框圆角，能选中复制。
- 宽度跟内容列，高度随字数，不在里面滚动。
- 那段字要用的设定组类型列表还没读到时写“读取中”，读失败时一行警告色的原因与“重试”：不拿缺了类型的字凑一段与模型所见不同的。

## 交互

- 只读；读失败时点“重试”发 `retry`。

## 数据

```ts
type ComponentAgentViewProps = {
    /** `fieldsText` 写出来的这一组的那一节。 */
    text: string;
    /** “在看”的位置，写好的（如“第 3 章末尾”）。 */
    position: string;
    /** 宿主还在读写这段字要用的东西（设定组类型列表）；默认 false。 */
    loading?: boolean;
    /** 读失败的原因；null（默认）是没失败。 */
    failed?: string | null;
};
type ComponentAgentViewEmits = {
    (event: "retry"): void;
};
```

没有插槽与 expose。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口。
