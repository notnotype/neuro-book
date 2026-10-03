import type {AgentMode} from "nbook/shared/dto/agent-session.dto";
import type {
    AgentComposerAvailability,
    AgentComposerAvailabilityAction,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";

export type ComposerAvailabilityTone = "info" | "warning" | "danger";

export interface ComposerAvailabilityView {
    icon: string;
    message: string;
    tone: ComposerAvailabilityTone;
    action: AgentComposerAvailabilityAction | null;
    actionIcon: string;
    actionLabel: string;
    borderClass: string;
    textClass: string;
}

/** 各模式在 Composer 上的图标、样式与文案配置。 */
export const AGENT_MODE_META: Record<AgentMode, {icon: string; buttonClass: string; badgeVisible: boolean}> = {
    normal: {icon: "i-lucide-pencil-line", buttonClass: "text-[var(--text-muted)] hover:text-[var(--text-main)]", badgeVisible: false},
    discuss: {icon: "i-lucide-messages-square", buttonClass: "text-[var(--status-info,var(--accent-text))] bg-[var(--accent-bg)]", badgeVisible: true},
    plan: {icon: "i-lucide-clipboard-list", buttonClass: "text-[var(--accent-text)] bg-[var(--accent-bg)]", badgeVisible: true},
};

/**
 * 将 AgentComposerAvailability 投影为统一展示视图。
 * ready 和 restoring 状态返回 null（输入区原位保留）。
 */
export function projectComposerAvailabilityView(
    availability: AgentComposerAvailability,
    t: (key: string, values?: Record<string, unknown>) => string,
): ComposerAvailabilityView | null {
    switch (availability.status) {
        case "ready":
        case "restoring":
            return null;
        case "unselected":
            return {
                icon: "i-lucide-messages-square",
                message: "请选择一个对话后继续。",
                tone: "warning",
                action: "choose-session",
                actionIcon: "i-lucide-list",
                actionLabel: "选择对话",
                borderClass: "border-[var(--status-warning-border,var(--border-color))]",
                textClass: "text-[var(--status-warning)]",
            };
        case "empty":
            return {
                icon: "i-lucide-message-square-plus",
                message: t("agent.composer.empty"),
                tone: "warning",
                action: "create-session",
                actionIcon: "i-lucide-plus",
                actionLabel: t("agent.composer.createSession"),
                borderClass: "border-[var(--status-warning-border,var(--border-color))]",
                textClass: "text-[var(--status-warning)]",
            };
        case "archived":
            return {
                icon: "i-lucide-archive",
                message: t("agent.composer.archived"),
                tone: "warning",
                action: availability.canRestore ? "restore-session" : null,
                actionIcon: "i-lucide-archive-restore",
                actionLabel: t("agent.composer.restore"),
                borderClass: "border-[var(--status-warning-border,var(--border-color))]",
                textClass: "text-[var(--status-warning)]",
            };
        case "profile-unavailable":
            return {
                icon: "i-lucide-circle-alert",
                message: availability.message || t("agent.composer.profileUnavailable"),
                tone: "danger",
                action: null,
                actionIcon: "",
                actionLabel: "",
                borderClass: "border-[var(--status-danger-border,var(--border-color))]",
                textClass: "text-[var(--status-danger)]",
            };
        case "waiting-blocked":
            return {
                icon: "i-lucide-octagon-alert",
                message: t("agent.composer.waitingBlocked"),
                tone: "danger",
                action: null,
                actionIcon: "",
                actionLabel: "",
                borderClass: "border-[var(--status-danger-border,var(--border-color))]",
                textClass: "text-[var(--status-danger)]",
            };
        case "load-error":
            return {
                icon: "i-lucide-cloud-alert",
                message: availability.message || t("agent.composer.loadError"),
                tone: "danger",
                action: "retry-session",
                actionIcon: "i-lucide-refresh-cw",
                actionLabel: t("agent.composer.retry"),
                borderClass: "border-[var(--status-danger-border,var(--border-color))]",
                textClass: "text-[var(--status-danger)]",
            };
        case "blocked":
            return {
                icon: "i-lucide-lock-keyhole",
                message: t("agent.composer.blocked"),
                tone: "warning",
                action: null,
                actionIcon: "",
                actionLabel: "",
                borderClass: "border-[var(--status-warning-border,var(--border-color))]",
                textClass: "text-[var(--status-warning)]",
            };
    }
}
