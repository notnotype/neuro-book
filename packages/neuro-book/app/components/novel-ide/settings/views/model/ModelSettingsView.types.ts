import type {ProviderConfigIssue} from "@notnotype/neuro-book-contracts/provider-config";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ModelSettingsDraft, ModelSettingsModelDraft} from "./model-settings-draft";
import type {ModelApiOption, SavedModelGroupView} from "./model-settings-view";

/**
 * 模型区段渲染层的受控契约：每个渲染用到的会话字段都作为 props 传入（名字与会话字段一致），
 * 每个动作都作为同名 emit 交回宿主。四个会话（draft / check / discovery / template）与全部
 * I/O 仍留在 `NovelIdeModelSettingsPanel`，视图自己不读 store、不发请求。
 */
export type ModelSettingsViewProps = {
    /** 当前草稿；字段改动一律通过 update:draft 交回 */
    draft: ModelSettingsDraft;
    /** project 作用域只渲染默认模型与继承说明，global 才有 Provider 双栏 */
    isProjectScope: boolean;
    /** 项目作用域下的配置目标标签 */
    targetLabel: string;
    loading: boolean;
    saving?: boolean;
    /** 保存失败原文；草稿仍保留在 props 里 */
    saveError?: string;
    validationIssues: ProviderConfigIssue[];
    /** 完整问题列表（换行分隔），做问题横幅的 title */
    validationIssueDetails: string;
    repairingModels: boolean;
    defaultModelOptions: EnabledModelOptionDto[];
    savedModelGroups: SavedModelGroupView[];
    disabledModels: ModelSettingsModelDraft[];
    /** 当前选中的 Provider（按 localKey） */
    activeProviderKey: string;
    /** 当前选中 Provider 正在检查的模型数 */
    activeProviderCheckingModelCount: number;
    checkingAllModels: boolean;
    /** 正在发现模型的 Provider id；空串表示没有进行中的发现 */
    discoveringProviderId: string;
    providerTemplates: Array<{id: string; name: string; description?: string}>;
    selectedTemplate: string;
    modelApiOptions: ModelApiOption[];
    /** 最大重试次数留空时的默认值，只用于占位 */
    maxRetriesPlaceholder: number;
};

export type ModelSettingsViewEmits = {
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
};
