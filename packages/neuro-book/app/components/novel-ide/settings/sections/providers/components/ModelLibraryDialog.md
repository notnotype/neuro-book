---
标签: [state:local]
---

# ModelLibraryDialog

NeuroBook Model Library 的浏览窗口：搜索、按分组列出标准模型资料，每行右侧一个加号 / 减号把该模型移入或移出当前 Provider 的模型清单。窗口是非模态浮动窗口（nb-ui `DialogWindow`）。

它与「自动发现」是两件事：这里列的是 NeuroBook 维护的标准资料，不代表当前 Provider 实际提供这些模型（窗口顶部就写着这句），所以加入之后仍要走一次发现或连通检查。是否已在清单里由宿主传入的 `enabledModelIds` 决定，窗口只做显示。

Component Lab 中由 `ModelLibraryDialogFixture` 提供确定性场景（default / empty / searching）。

## 契约

```ts
type Props = {
    modelValue: boolean;
    groups: ModelLibraryGroup[];
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    enabledModelIds: Set<string>;
};

type Emits = {
    (event: "update:modelValue", value: boolean): void;
    (event: "update:searchQuery", value: string): void;
    (event: "toggle-group", group: string): void;
    (event: "toggle-model", model: ModelLibraryEntryDto): void;
};
```

## 布局规则

窗口宽 800px、高 85vh，内容区自己滚动；分组折叠状态由宿主持有，窗口不自留状态。窗口可拖动、可 Escape 关闭；没有页脚。
