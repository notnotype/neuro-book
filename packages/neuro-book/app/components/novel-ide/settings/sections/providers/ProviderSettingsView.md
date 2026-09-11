---
标签: [state:local]
---

# ProviderSettingsView

「Provider」区段的渲染层：区段标题、草稿问题横幅，以及 global 作用域下的 Provider 双栏（左导轨 + 右详情：连接表单 + 已保存模型清单）。**新增 Provider 的入口在导轨顶部**（模板选择 + 添加），列表在它下面独立滚动；默认模型与 Agent 可见模型已各自独立成区段，不再在这里。project 作用域只显示继承说明——Provider 与 API Key 仍来自全局配置。

视图吃 props、emit 动作：四个会话（`useModelSettingsDraftSession` / `useModelCheckSession` / `useModelDiscoverySession` / `useProviderTemplateSession`）与全部 I/O 仍在旧面板 `NovelIdeModelSettingsPanel`，产品接线时由宿主把会话字段按同名 props 传进来、按同名 emit 接回去。字段改动统一走 `update:draft`（详情内部先合成整份 Provider 草稿，再由本视图按 `localKey` 换掉对应项）；打开对话框、修复、检查连通等动作各有同名事件，视图不自己解析结果、不弹通知。

视图内唯一自持状态是「已保存模型清单的分组折叠」（`expandedGroups`）：它不影响草稿，也不上报。列表与分组数据由 `model/model-settings-view.ts` 的视图类型描述（`SavedModelGroupView`），由宿主算好传入。

Component Lab 中由 `ProviderSettingsViewFixture` 提供确定性场景（default / project / no-provider / disabled-models / dialog-window / saving / save-error / loading），假数据由 `fixtures/model-settings-fixture-data.ts` 构造并与设置外壳 fixture 共用；`dialog-window` 场景把本视图摆进 nb-ui `DialogWindow`，也就是产品里承载它的方式。三个对话框在 Lab 里各有自己的组件条目（`NovelIdeModelEditDialog` / `ModelDiscoveryDialog` / `ModelLibraryDialog`），不挂在本视图的场景里。

## 契约

```ts
type Props = {
    draft: ModelSettingsDraft;            // defaultModelKey / providers / agentVisibleModels
    isProjectScope: boolean;
    targetLabel: string;
    loading: boolean;
    saving?: boolean;
    saveError?: string;
    validationIssues: ProviderConfigIssue[];
    validationIssueDetails: string;       // 完整问题列表，做横幅的 title
    repairingModels: boolean;
    savedModelGroups: SavedModelGroupView[];
    disabledModels: ModelSettingsModelDraft[];
    activeProviderKey: string;            // 当前选中 Provider 的 localKey
    activeProviderCheckingModelCount: number;
    checkingAllModels: boolean;
    discoveringProviderId: string;        // 空串表示没有进行中的发现
    providerTemplates: Array<{id: string; name: string; description?: string}>;
    selectedTemplate: string;
    modelApiOptions: ModelApiOption[];
    maxRetriesPlaceholder: number;
    // 五个对话框的开关与内容都由宿主的会话持有
    validationDialogOpen: boolean;
    deleteProviderDialogOpen: boolean;
    modelEditDialogOpen: boolean;
    discoveryDialogOpen: boolean;
    modelLibraryDialogOpen: boolean;
    editingModel: ModelSettingsModelDraft | null;
    editingLibraryModel: ModelLibraryEntryDto | null;
    editingModelMissingFields: string[];
    editingTransientCandidate: boolean;
    discoveryGroups: DiscoveryModelGroup[];
    discoverySearchQuery: string;
    discoveryExpandedGroups: Record<string, boolean>;
    discoveryDiagnostics: DiscoveryDiagnosticsView | null;
    discoveryManualDraft: ManualModelDraft;
    modelLibraryGroups: ModelLibraryGroup[];
    modelLibrarySearchQuery: string;
    modelLibraryExpandedGroups: Record<string, boolean>;
    enabledModelIds: Set<string>;
};

type Emits = {
    (event: "update:draft", value: ModelSettingsDraft): void;
    (event: "update:selectedTemplate", value: string): void;
    (event: "add-provider"): void;
    (event: "select-provider", key: string): void;
    (event: "toggle-provider-enabled"): void;
    (event: "rename-provider-id", nextId: string): void;
    (event: "clone-provider-connection"): void;
    (event: "request-delete-provider"): void;
    (event: "clear-provider-api-key"): void;
    (event: "discover-models"): void;
    (event: "check-model", model: ModelSettingsModelDraft): void;
    (event: "cancel-model-check", model: ModelSettingsModelDraft): void;
    (event: "check-all-models"): void;
    (event: "cancel-model-checks"): void;
    (event: "edit-model", model: ModelSettingsModelDraft): void;
    (event: "disable-model", model: ModelSettingsModelDraft): void;
    (event: "delete-model", model: ModelSettingsModelDraft): void;
    (event: "open-discovery"): void;
    (event: "open-library"): void;
    (event: "repair"): void;
    (event: "open-validation-issues"): void;
    // 以下为对话框层：窗口开关、确认与内容回写
    (event: "update:validationDialogOpen", value: boolean): void;
    (event: "update:deleteProviderDialogOpen", value: boolean): void;
    (event: "update:modelEditDialogOpen", value: boolean): void;
    (event: "update:discoveryDialogOpen", value: boolean): void;
    (event: "update:modelLibraryDialogOpen", value: boolean): void;
    (event: "confirm-delete-provider"): void;
    (event: "confirm-model-edit"): void;
    (event: "model-id-change"): void;
    (event: "toggle-model-input", model: ModelSettingsModelDraft, inputKind: ModelInputKind): void;
    (event: "reset-model-input", model: ModelSettingsModelDraft): void;
    (event: "reset-model-cost", model: ModelSettingsModelDraft): void;
    (event: "enable-model-cost", model: ModelSettingsModelDraft): void;
    (event: "reapply-library", model: ModelSettingsModelDraft): void;
    (event: "update:discoverySearchQuery", value: string): void;
    (event: "update:modelLibrarySearchQuery", value: string): void;
    (event: "update:discoveryManualField", field: keyof ManualModelDraft, value: string): void;
    (event: "toggle-discovery-group", group: string): void;
    (event: "toggle-model-library-group", group: string): void;
    (event: "toggle-discovered-model", model: DiscoveryListModel): void;
    (event: "toggle-library-model", model: ModelLibraryEntryDto): void;
    (event: "discover"): void;
    (event: "add-manual-model"): void;
};
```

上面这份清单与 `ProviderSettingsView.types.ts` 的 `ProviderSettingsViewEmits` 一一对应（接线时以后者为真值，改协议先改类型）。

`NovelIdeModelSelect`（默认模型下拉）、`AgentVisibleModelsEditor`（可见模型清单）、`SavedModelsList`（已保存模型清单）与三个对话框都是被搬进 `model/` 的既有子组件，本层只负责组合与传参：`SavedModelsList` 的五个模型行动作与两个底部入口逐一转成同名 emit，只有分组折叠留在视图内。

五个对话框（编辑设置、模型发现、Model Library、校验问题全列表、删除 Provider 确认）都挂在这一层，开关由宿主的会话状态通过 `*DialogOpen` props 控制，打开与关闭各自 emit 交回。前四个用 nb-ui `DialogWindow`（非模态浮动窗口，从设置窗口里开出来时靠窗口层级压住外层）；删除 Provider 是不可逆确认，留在带遮罩的模态 `Dialog` 里——`DialogWindow` 没有遮罩层，它自己的注释也写着模态确认请继续用 `Dialog`。窗口内部要用的派生文案与判定（分组默认值、上下文窗口 / Max Tokens 占位、输入能力与推理能力展示名）已经在 `NovelIdeModelEditDialog` 里算好，本层不再传函数进去。

## 布局规则

与设置外壳同源：不画卡片面，标题、问题横幅、Provider 双栏之间用 1px `--divider` 横线分段；两列之间有一条同款竖线（两端留 16px，落在两列各自留白的中间），窄容器退化为单列时去掉；导轨顶部的添加行不随列表滚动。导轨只有控件自身的选中底色（`--accent-bg`），不加面板底与描边。Provider 连接表单的短字段并排按视图自身容器宽度（`@container min-width: 620px`）决定，双栏（`260px` 导轨 + 详情）在 `@container min-width: 700px` 时成立（与外壳的单列阈值同一档），窄容器退化为导轨在上、详情在下。视图自身不滚动（宿主负责滚动）。
