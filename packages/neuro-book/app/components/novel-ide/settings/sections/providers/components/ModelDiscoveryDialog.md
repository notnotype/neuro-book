---
标签: [state:local]
---

# ModelDiscoveryDialog

Provider 的自动模型发现窗口：搜索与刷新、部分成功诊断、按分组的结果列表（可逐条加入 / 移出 Provider Config），底部还有一条手工补全行（名称 / ID / 接口格式 / 上下文窗口 / Max Tokens）。窗口是非模态浮动窗口（nb-ui `DialogWindow`），打开时设置页仍可见；所有动作都 emit 回宿主，窗口自己不请求、不改草稿。

结果列表与分组由 `provider-view-types.ts` 的 `DiscoveryModelGroup` / `DiscoveryListModel` 描述，宿主算好传入：`state` 区分已启用、已停用、远端完整与远端不完整四种显示。手工补全行的字段草稿（`ManualModelDraft`）同样由宿主持有，窗口只把每次输入转成 `update-manual-field`。

Component Lab 中由 `ModelDiscoveryDialogFixture` 提供确定性场景（default / partial / empty / discovering）。

## 契约

```ts
type Props = {
    modelValue: boolean;
    providerName: string;
    groups: DiscoveryModelGroup[];
    searchQuery: string;
    discovering: boolean;
    expandedGroups: Record<string, boolean>;
    diagnostics: DiscoveryDiagnosticsView | null;   // partial 为真时显示诊断条
    manualDraft: ManualModelDraft;
    modelApiOptions: ModelApiOption[];
};

type Emits = {
    (event: "update:modelValue", value: boolean): void;
    (event: "update:searchQuery", value: string): void;
    (event: "update-manual-field", field: keyof ManualModelDraft, value: string): void;
    (event: "discover"): void;
    (event: "toggle-group", group: string): void;
    (event: "toggle-model", model: DiscoveryListModel): void;
    (event: "add-manual"): void;
};
```

## 布局规则

窗口宽 800px、高 85vh，内容区自己滚动（列表与手工补全行固定在窗口内，不把设置页顶开）。窗口可拖动、可 Escape 关闭；没有页脚——出口是右上角的关闭按钮与列表里的逐条动作。
