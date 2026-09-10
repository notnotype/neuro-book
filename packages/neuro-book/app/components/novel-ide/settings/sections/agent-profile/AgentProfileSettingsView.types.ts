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
    context: AgentProfileSettingsContext;
    /** 内嵌于已有窗口标题时隐藏导航视觉标题；无障碍标题仍保留 */
    showNavHeading?: boolean;
    /** false */
    loading?: boolean;
    /** false */
    saving?: boolean;
    /** 空串 */
    loadError?: string;
    /** 空串；就地保存失败时由宿主回填，草稿仍保留在 modelValue 中 */
    saveError?: string;
};

/**
 * 就地保存契约：视图没有独立的保存动作，任何修改都即时通过 `update:modelValue` 交给宿主，
 * 由宿主持久化并用 `saving` / `saveError` 回报状态。
 */
export type AgentProfileSettingsViewEmits = {
    (event: "update:modelValue", value: AgentProfileSettingsPageDraft): void;
    (event: "reload"): void;
};
