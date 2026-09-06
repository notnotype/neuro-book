import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";

export type ProfileLoadStatus = ConfigAgentProfileSettingsDto["agentProfiles"][number]["loadStatus"];

export interface AgentProfileNavItem {
    profileKey: string;
    name: string;
    status: ProfileLoadStatus;
    /** 显式覆盖的字段总数（模型 + 运行策略 + Profile 设置），0 表示完全跟随默认。 */
    overrideCount: number;
    /** 当前草稿与已保存配置不同。 */
    dirty: boolean;
    /** 是否是当前生效的默认 Profile。 */
    isDefault: boolean;
    /** 名称前的自定义图标类（如 i-lucide-*）；缺省不渲染图标。 */
    iconClass?: string;
}
