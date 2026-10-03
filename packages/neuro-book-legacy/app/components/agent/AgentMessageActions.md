---
标签: []
别名: ["消息操作条", "Message Actions"]
---

# Agent 消息操作条

一条消息的操作按钮组：分支切换（有多个分支时显示描边小框“‹ ⑂ 1/3 ›”）和由注册表登记的操作（复制、编辑、重试、从此处分支，以及插件登记的操作）。它只负责排布与发出选择，显示时机（悬停、键盘聚焦、触屏常显）由所在的卡片或气泡决定。

## 数据

```ts
type AgentMessageActionsProps = {
    /** 已按显示条件筛选、翻译好的操作，按顺序显示；默认空数组。 */
    actions?: Array<{id: string; icon: string; label: string}>;
    /** 分支位置；null 或 total 小于 2 时不显示分支切换。默认 null。 */
    branch?: {index: number; total: number} | null;
    /** 为 true 时全部按钮不可点，例如运行中。默认 false。 */
    disabled?: boolean;
};

type AgentMessageActionsEmits = {
    /** 点击某个操作时发出，携带操作 id。 */
    (e: "select", id: string): void;
    /** 点击分支切换的前后箭头时发出。 */
    (e: "branch", direction: "previous" | "next"): void;
};
```

没有插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
