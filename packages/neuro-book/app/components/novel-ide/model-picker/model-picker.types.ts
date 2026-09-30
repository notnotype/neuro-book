import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ModelRoleDraft} from "nbook/app/components/novel-ide/settings/sections/roles/roles-settings-draft";

/**
 * 模型选择器中的角色展示项。
 */
export type ModelPickerRoleItem = {
    id: string;
    axis: "gradient" | "specialist";
    name: string;
    description: string;
    modelKey: string | null;
    modelLabel?: string;
    iconClass: string;
    enabled: boolean;
    builtIn?: boolean;
    suggestedModel?: string | null;
};

/**
 * 带有丰富元数据的物理模型项。
 */
export type ModelPickerModelItem = {
    /** 唯一 key，如 `anthropic/claude-3-7-sonnet` 或 `claude-3-7-sonnet` */
    key: string;
    label: string;
    providerId: string;
    providerName?: string;
    modelId: string;
    contextWindowTokens?: number | null;
    input: ("text" | "image")[];
    reasoning?: boolean;
    maxTokens?: number | null;
    pricing?: string | null;
    cost?: {
        input?: number;
        output?: number;
    } | null;
    latencyMs?: number | null;
    tokensPerSecond?: number | null;
    description?: string;
};

/**
 * 模型选择器的选中值：
 * - 角色类型：形如 `role:main`、`role:fast`、`role:writer`
 * - 物理模型类型：形如 `anthropic/claude-3-7-sonnet`
 */
export type ModelPickerSelectionValue = string | null;

/**
 * 按 Provider 聚合的模型分组。
 */
export type ModelPickerProviderGroup = {
    providerId: string;
    providerName: string;
    models: ModelPickerModelItem[];
};
