import type {ProviderConfigIssue} from "@notnotype/neuro-book-contracts/provider-config";
import type {EnabledModelOptionDto, ModelInputKind, ModelLibraryEntryDto} from "nbook/shared/dto/app-settings.dto";
import type {ModelSettingsDraft, ModelSettingsModelDraft} from "./provider-settings-draft";
import type {
    DiscoveryDiagnosticsView,
    DiscoveryListModel,
    DiscoveryModelGroup,
    ManualModelDraft,
    ModelApiOption,
    ModelLibraryGroup,
    SavedModelGroupView,
} from "./provider-view-types";

/**
 * 模型区段渲染层的受控契约：每个渲染用到的会话字段都作为 props 传入（名字与会话字段一致），
 * 每个动作都作为同名 emit 交回宿主。四个会话（draft / check / discovery / template）与全部
 * I/O 在宿主侧绑定 `useProviderSettingsBinding`，视图自己不读 store、不发请求。
 */
export type ProviderSettingsViewProps = {
    /** 当前草稿；字段改动一律通过 update:draft 交回 */
    draft: ModelSettingsDraft;
    /** project 作用域只渲染默认模型与继承说明，global 才有 Provider 双栏 */
    isProjectScope: boolean;
    /** 项目作用域下的配置目标标签 */
    targetLabel: string;
    saving?: boolean;
    validationIssues: ProviderConfigIssue[];
    /** 完整问题列表（换行分隔），做问题横幅的 title */
    validationIssueDetails: string;
    repairingModels: boolean;
    savedModelGroups: SavedModelGroupView[];
    disabledModels: ModelSettingsModelDraft[];
    /** 当前选中的 Provider（按 localKey） */
    activeProviderKey: string;
    /** 当前选中 Provider 正在检查的模型数 */
    activeProviderCheckingModelCount: number;
    checkingAllModels: boolean;
    /** 正在发现模型的 Provider id；空串表示没有进行中的发现 */
    discoveringProviderId: string;
    modelApiOptions: ModelApiOption[];
    providerTemplates: Array<{id: string; name: string; description?: string}>;
    selectedTemplate: string;
    /** 最大重试次数留空时的默认值，只用于占位 */
    maxRetriesPlaceholder: number;
    /** 五个对话框的开关都由宿主（会话）持有 */
    validationDialogOpen: boolean;
    deleteProviderDialogOpen: boolean;
    modelEditDialogOpen: boolean;
    discoveryDialogOpen: boolean;
    modelLibraryDialogOpen: boolean;
    /** 正在编辑的模型与它的 Model Library 资料（未命中时为空） */
    editingModel: ModelSettingsModelDraft | null;
    editingLibraryModel: ModelLibraryEntryDto | null;
    editingModelMissingFields: string[];
    /** true 表示正在编辑尚未进入配置的临时候选（发现结果里手工补全的那条） */
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
    /**
     * 浮层宿主。默认落在 IDE 主题宿主上，窗口才会跟着主题换面色；
     * Lab 场景没有主题宿主，fixture 传 false 就地渲染。
     */
    teleportTarget?: string | boolean;
};

export type ProviderSettingsViewEmits = {
    (event: "update:draft", value: ModelSettingsDraft): void;
    (event: "select-provider", key: string): void;
    (event: "toggle-provider-enabled"): void;
    (event: "rename-provider-id", nextId: string): void;
    (event: "clone-provider-connection"): void;
    (event: "request-delete-provider"): void;
    (event: "clear-provider-api-key"): void;
    (event: "update:selectedTemplate", value: string): void;
    (event: "add-provider"): void;
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
