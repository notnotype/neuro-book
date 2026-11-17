/**
 * 模型用不了时的提示卡（docs/specs/agent/conversation.md 输出 42）：按会话的解析失败与模型服务的快照，定出哪张卡、按钮打开设置
 * 到哪里。宿主组上下文与处理按钮时用同一份输入调它，所以按钮去的地方与卡上写的一致。
 */

import {PROVIDERS_SECTION, ROLES_SECTION} from "nbook/plugins/models/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";

import {agentText} from "../shared/text";

/** 解析失败的码对应的原因；没有更具体的卡时卡的标题写它。 */
export const MODEL_KEYS = {
    "no-model": "conversation.model.none",
    "no-credentials": "conversation.model.noCredentials",
    "unknown-model": "conversation.model.unknown",
    "role-unbound": "conversation.model.roleUnbound",
} as const;

/** 会话快照里 `model` 的失败分支（harness/runtime.md 输出 77）：走到的角色、卡住的服务商是端口给了才有。 */
export interface ModelFailure {
    readonly code: string;
    readonly role?: string;
    readonly provider?: string;
}

export interface ModelNoticeInput {
    /** 有没有会话：没有时只判“一家服务商都没有”，别的要建了会话才知道选中了什么。 */
    readonly session: boolean;
    /** 会话的模型解析失败的结果；解析成功或还不知道时为 null。 */
    readonly failure: ModelFailure | null;
    /** 模型服务快照里的服务商；还没读到、模型服务不在时为 null。 */
    readonly providers: readonly {readonly id: string; readonly name: string}[] | null;
    /** 角色 id 对应的显示名；查不到为 null。 */
    readonly roleName: (role: string) => string | null;
    readonly profileName: string;
    /** 会话直接选的模型的显示名；选的是角色、跟随默认时为 null。 */
    readonly modelName: string | null;
    readonly text: TextResolver;
}

export interface ModelNotice {
    readonly title: string;
    readonly message: string;
    readonly icon: string;
    readonly action: {readonly id: string; readonly label: string};
    /**
     * 按钮打开设置到哪里（settings/settings-window.md 输出 15 的 `section`、`focus` 与 `layer`）。模型的两页只在用户标签下可用：
     * 窗口上次停在“本作品”时不带 `layer` 会落在不可用的说明上，`focus` 也等不到页面，所以都带 `layer: "user"`。
     */
    readonly target: {readonly section: string; readonly focus?: string; readonly layer: "user"};
}

/** 按顺序取第一张符合的卡；不用出卡时为 null。 */
export function modelNotice(input: ModelNoticeInput): ModelNotice | null {
    const t = (key: Parameters<typeof agentText>[0], params?: Readonly<Record<string, string>>): string => input.text.t(agentText(key, params));
    const {failure} = input;
    // 一家服务商都没有时，选中了什么都一样走不通：先去添加。
    if (input.providers !== null && input.providers.length === 0 && (!input.session || failure !== null)) {
        return {
            title: t("conversation.notice.noProvider.title"),
            message: t("conversation.notice.noProvider.body"),
            icon: "i-lucide-plug-zap",
            action: {id: "add-provider", label: t("conversation.notice.noProvider.action")},
            target: {section: PROVIDERS_SECTION, focus: "add", layer: "user"},
        };
    }
    if (!input.session || failure === null) return null;
    if (failure.code === "role-unbound" && failure.role !== undefined) {
        const role = input.roleName(failure.role) ?? failure.role;
        return {
            title: t("conversation.notice.roleUnbound.title", {role}),
            message: t("conversation.notice.roleUnbound.body", {role, profile: input.profileName}),
            icon: "i-lucide-link-2-off",
            action: {id: "bind-role", label: t("conversation.notice.roleUnbound.action")},
            target: {section: ROLES_SECTION, focus: failure.role, layer: "user"},
        };
    }
    if (failure.code === "no-credentials" && failure.provider !== undefined) {
        const providerId = failure.provider;
        const provider = input.providers?.find((candidate) => candidate.id === providerId)?.name ?? providerId;
        const role = failure.role === undefined ? null : input.roleName(failure.role) ?? failure.role;
        const message = role !== null
            ? t("conversation.notice.noCredentials.bodyRole", {role, provider})
            : input.modelName === null ? "" : t("conversation.notice.noCredentials.bodyModel", {model: input.modelName, provider});
        return {
            title: t("conversation.notice.noCredentials.title", {provider}),
            message,
            icon: "i-lucide-key-round",
            action: {id: "set-key", label: t("conversation.notice.noCredentials.action")},
            target: {section: PROVIDERS_SECTION, focus: providerId, layer: "user"},
        };
    }
    return {
        title: t(MODEL_KEYS[failure.code as keyof typeof MODEL_KEYS] ?? MODEL_KEYS["no-model"]),
        message: "",
        icon: "i-lucide-circle-alert",
        action: {id: "open-settings", label: t("conversation.openSettings")},
        target: {section: PROVIDERS_SECTION, layer: "user"},
    };
}
