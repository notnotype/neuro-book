---
标签: [state:local]
---

# AgentVisibleModelsView

「可见模型」区段的受控视图：Leader 为子 Agent 或 Workflow 指定模型时的**有序候选清单**，顺序直接进入提示词，所以每一行是「模型 + 用途说明 + 上下移」。清单只有 global 有内容——它写在全局配置里，project 作用域只说这一句、不提供覆盖。

视图只消费 props 并通过 `update:modelValue` 交回宿主；列表本身沿用 `AgentVisibleModelsEditor`（行内取值、新增、上下移、删除都在那里），本层负责标题、说明与保存状态。旧面板 `NovelIdeModelSettingsPanel` 继续负责读写配置。

这一页从 `ProviderSettingsView` 拆出来：原来它与默认模型、Provider 与模型清单挤在一个 Tab 里。

Component Lab 中由 `AgentVisibleModelsViewFixture` 提供确定性场景（default / with-invalid / over-limit / empty / project / saving / save-error）。

## 契约

```ts
type Props = {
    modelValue: AgentVisibleModelDraft[];   // [{modelKey, note}]
    models: EnabledModelOptionDto[];
    defaultModelKey: string | null;         // 清单为空时用它解释运行时会用哪个模型
    isProjectScope: boolean;
    saving?: boolean;
    saveError?: string;
};

type Emits = {
    (event: "update:modelValue", value: AgentVisibleModelDraft[]): void;
};
```

## 布局规则

阅读型区段：内容列封顶 `max-w-3xl`。标题旁只放元信息 tooltip（这份清单是什么、与 Leader 的关系）；清单里的每一行用 1px `--divider` 分隔，不各给一张输入底——嵌套的面在窗口里会读成第二层材质。列表为空时给一行说明（会用默认模型 / 当前没有可用默认模型两种情况），不是一张虚线卡片。新增按钮在列表右上，与标题同一条水平线。视图自身不滚动。
