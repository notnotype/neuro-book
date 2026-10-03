---
标签: []
别名: ["步骤行", "Step"]
---

# Agent 步骤行

过程时间线里的一行：图标、动作名、操作对象，右侧可选增删行统计与状态。读取、搜索、改文件、说明文字之外的大多数步骤都用它，保证过程区每一步默认只占一行。可展开时整行是按钮，展开内容通过默认插槽缩进显示在下方。

外观取值来自对话视图的 `--acv-step-*` 变量，单独挂载时使用默认值。

## 数据

```ts
type AgentStepLineProps = {
    /** 图标 class，必填。 */
    icon: string;
    /** 动作名，必填。 */
    label: string;
    /** 操作对象，单行截断；默认空串。 */
    detail?: string;
    /** 增删行统计；null 的一侧不显示，另一侧有改动时为 0 的一侧也不显示。默认不显示。 */
    stat?: {added: number | null; removed: number | null} | null;
    /** 默认 "done"。running 显示转圈，error 整行用危险色。 */
    status?: "running" | "error" | "done";
    /** 受控展开状态；不传表示不可展开。 */
    expanded?: boolean;
};

type AgentStepLineEmits = {
    /** 点击可展开的行时发出，携带期望的新状态。 */
    (e: "toggle", expanded: boolean): void;
};

type AgentStepLineSlots = {
    /** 展开后的内容；未展开时不渲染。 */
    default?: () => unknown;
};
```

没有 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
