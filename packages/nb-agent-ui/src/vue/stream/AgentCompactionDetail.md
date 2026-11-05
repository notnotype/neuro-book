---
标签: [display:inject]
别名: ["压缩详情", "Compaction Detail"]
---

# AgentCompactionDetail

压缩分隔线点开后的详情：用一张两列的键值表写这次压缩的方法与模型、上下文前后的估算、花费、用到的要求、保留了什么、放回了什么。只显示有的字段：没有调模型的方法（整理工具结果）写“没有调用模型”，没有花费、没有放回的行不出现。摘要全文不在这里，由分隔线的 Markdown 区域显示在它下面。

## 数据

```ts
type AgentCompactionDetailProps = {
    detail: CompactionView;
    /** 花费的币种；来自 `ctx.usage.currency`。 */
    currency: "USD" | "CNY";
};
```

没有事件、插槽和 expose。上下文的前后数字都是估算（不含系统提示与工具），不写成节省的百分比：只有一轮、摘要比原文长时压缩后可能更大。

## 无障碍

根节点是 `<dl>`，键与值成对。展开与收起的按钮、焦点在分隔线上，这里没有可聚焦的内容。
