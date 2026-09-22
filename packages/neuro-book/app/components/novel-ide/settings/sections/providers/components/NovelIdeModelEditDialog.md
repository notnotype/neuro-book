---
标签: [state:local]
---

# NovelIdeModelEditDialog

单个模型的编辑窗口：身份（名称 / ID / 分组）、能力与限制（上下文窗口 / Max Tokens / 输入能力 / 推理）、请求参数（三块 JSON）、价格（结构化字段与分档）。窗口是非模态浮动窗口（nb-ui `DialogWindow`），打开时后面的模型清单仍可见可点；`confirmMode` 为真时（临时候选补全流程）才给取消 / 确认页脚，其余情况改动即改草稿、由宿主决定何时保存。

派生文案（分组默认值、上下文窗口与 Max Tokens 的空值占位、输入能力与推理能力的展示名）在窗口内部算，不通过 props 传函数进来；调用方只提供数据。三块 JSON 的解析、校验与写回由 `provider-settings-draft.ts` 的共享函数负责（`parseModelCompat` / `parseStringMap`），窗口只负责显示状态。

Component Lab 中由 `NovelIdeModelEditDialogFixture` 提供确定性场景（default / missing-fields / confirm-mode）。

## 契约

```ts
type Props = {
    modelValue: boolean;
    editingModel: ModelDraft | null;          // localKey, name, id, group, enabled, api, reasoning, input, maxTokens,
                                             // cost, compat, headers, thinkingLevelMap, contextWindowTokens
    activeProvider: {id: string; name: string} | null;
    libraryModel: ModelLibraryEntryDto | null;
    confirmMode?: boolean;                    // 临时候选：走页脚确认而不是就地保存
    missingFields: string[];                  // 必填项缺失时的提示文本
    modelApiOptions: SelectOption[];
};

type Emits = {
    (event: "update:modelValue", value: boolean): void;
    (event: "model-id-change"): void;
    (event: "toggle-model-input", model: ModelDraft, inputKind: ModelInputKind): void;
    (event: "reset-model-input", model: ModelDraft): void;
    (event: "reset-model-cost", model: ModelDraft): void;
    (event: "enable-model-cost", model: ModelDraft): void;
    (event: "reapply-library", model: ModelDraft): void;
    (event: "confirm"): void;
};
```

## 布局规则

窗口宽度 980px（视口不够时由 `DialogWindow` 收到 `min(视口 - 24px)`），高度 `min(760px, 100vh - 24px)`；标题栏固定显示当前模型名与 ID，页签切换窗口内部的内容区，内容区自己滚动。`confirmMode` 的页脚用 nb-ui `Button`：次要「取消」、主「确认」。窗口可拖动、可 Escape 关闭（Escape 只作用于最上面那个窗口）。
