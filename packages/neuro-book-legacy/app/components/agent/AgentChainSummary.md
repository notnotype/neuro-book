---
标签: []
别名: ["思维链摘要行", "Chain Summary"]
---

# Agent 思维链摘要行

消息流里代表一条思维链（或整轮过程）的一行：开头一个表示内容种类的图标，中间一句概括，例如“思考 · 读了 7 个文件，改了 2 个”，末尾可选一段危险色的提醒（如“1 次失败”）和一个折叠箭头。点击在折叠与展开之间切换，展开时箭头转向下方。

它是过程的入口，注意力低于正文：宽度随内容而不是拉满整行，文字用淡色，悬停时加深并出现浅底。概括由调用方按当前语言拼好传入；放不下时概括末尾截断，提醒与箭头保持可见，不换行、不横向溢出。运行中图标换成转圈，概括通常换成正在执行的那一步。

开头图标位于行首 4px 内边距之后，宽 14px；调用方把展开内容的竖线对齐到图标中心（距行左缘 11px）。

## 数据

```ts
type AgentChainSummaryProps = {
    /** 受控展开状态，必填。 */
    expanded: boolean;
    /** 概括，必填，单行。 */
    label: string;
    /** 开头图标的 class；默认 "i-lucide-list-tree"。 */
    icon?: string;
    /** 概括后的危险色提醒，例如失败次数；默认空串不显示。 */
    alert?: string;
    /** 运行中显示转圈代替图标；默认 false。 */
    running?: boolean;
};

type AgentChainSummaryEmits = {
    /** 点击时发出，携带期望的新状态。 */
    (e: "toggle", expanded: boolean): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根按钮。
