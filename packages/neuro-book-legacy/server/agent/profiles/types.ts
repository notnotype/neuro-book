/**
 * Profile 作者可见合同由 `nbook/profile-sdk` 拥有。
 *
 * 宿主继续从这个历史入口导入，以保证 runtime implementation 与 Authoring
 * Interface 使用同一组类型；本 Module 不再复制或扩张作者合同。
 */
export type {
    AgentCatalogItem,
    AgentCatalogSnapshot,
    AgentProfile,
    AgentProfileCreationMode,
    AgentProfileDefinition,
    AgentProfileIssue,
    AgentProfileIssueCode,
    AgentProfileLoadStatus,
    AgentProfileManifest,
    AgentProfileSourceKind,
    ProfilePrepareContext,
    ProfileTurnPlan,
} from "nbook/profile-sdk/contracts";

export type {ProfileRuntimeDefaults as AgentProfileRuntimeDefaults} from "nbook/profile-sdk/contracts";
