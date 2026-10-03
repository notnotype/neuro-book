---
标签: []
别名: ["投递状态未知", "Delivery Notice"]
---

# Agent 投递未知提示

用户消息发出后没有收到确认、不知道服务端是否已经收下时，紧跟在这条消息下面的一行提示：警示色图标和“可能已发送，重新发送可能产生重复”，后面是“重新发送”和“移除”两个小按钮。放不下时按钮折到下一行。它只负责说明和收集选择，重发与移除由宿主执行。

## 数据

```ts
type AgentDeliveryNoticeProps = {};

type AgentDeliveryNoticeEmits = {
    /** 点击“重新发送”。 */
    (e: "resend"): void;
    /** 点击“移除”。 */
    (e: "dismiss"): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
