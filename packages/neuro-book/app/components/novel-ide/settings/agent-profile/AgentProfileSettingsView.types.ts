import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentProfileDraft, AgentProfileModelDraft, ConfigSettingsScope} from "./agent-profile-draft";
import type {ProfileRuntimeSettingsDraft} from "./profile-runtime-settings";

/**
 * 完整设置页的页面草稿：一次编辑会话中全部可编辑配置。
 * 与 `agent-profile-draft.ts` 的 `AgentProfileSettingsDraft`（单 Profile 自定义表单草稿）不同层。
 */
export type AgentProfileSettingsPageDraft = {
    /** 空串表示跟随上层默认 Profile */
    defaultProfileKey: string;
    modelDefaults: AgentProfileModelDraft;
    runtimeDefaults: ProfileRuntimeSettingsDraft;
    profiles: AgentProfileDraft[];
};

/** 宿主准备好的只读上下文；视图不自行获取任何数据。 */
export type AgentProfileSettingsContext = {
    scope: ConfigSettingsScope;
    /** 作用域目标名（如项目名），空串表示无目标 */
    targetLabel: string;
    /** 上层继承的默认 Profile key；草稿为空串时的实际生效值 */
    inheritedDefaultProfileKey: string;
    /** Global 层默认模型参数，作为 Project 默认参数的继承基线 */
    globalModelDefaults: AgentProfileModelConfigDto;
    /** Global 层单 Profile 模型覆盖；仅 Project scope 叠加 */
    globalProfileModels: Record<string, Partial<AgentProfileModelConfigDto>>;
    /** 已解析的配置元数据与继承层（enabledModels、validationIssues、runtime 层 patch 等） */
    settings: ConfigAgentProfileSettingsDto;
    /** Profile 用途文案表；缺省 key 不渲染说明 */
    descriptions: Record<string, string>;
};

export type AgentProfileSettingsViewProps = {
    /** 受控页面草稿；组件不直接修改，仅 emit 更新 */
    modelValue: AgentProfileSettingsPageDraft;
    /** 上次被宿主接受的页面草稿；未保存标记的比较基线 */
    baseline: AgentProfileSettingsPageDraft;
    context: AgentProfileSettingsContext;
    /** false */
    loading?: boolean;
    /** false */
    saving?: boolean;
    /** 空串 */
    loadError?: string;
    /** 空串 */
    saveError?: string;
    /** 正在重置 Home 的 profileKey；空串表示无进行中的重置 */
    resettingHomeKey?: string;
};

export type AgentProfileSettingsViewEmits = {
    (event: "update:modelValue", value: AgentProfileSettingsPageDraft): void;
    (event: "save", value: AgentProfileSettingsPageDraft): void;
    (event: "reload"): void;
    (event: "reset-home", profileKey: string): void;
};
