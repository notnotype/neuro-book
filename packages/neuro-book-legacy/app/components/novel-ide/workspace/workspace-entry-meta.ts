export type WorkspaceLorebookType = "location" | "character" | "item" | "rule" | "note";
export type WorkspaceLorebookStatus = "draft" | "pending" | "active" | "archived";

type RuntimeI18n = {
    t: (key: string) => string;
};

function translate(key: string, fallback: string): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: RuntimeI18n};
        return nuxtApp.$i18n?.t(key) ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * 文件化 lorebook 类型视觉元数据。
 */
export interface WorkspaceLorebookTypeMeta {
    icon: string;
    iconClass: string;
    badgeClass: string;
    selectedClass: string;
    barClass: string;
    dotClass: string;
}

/**
 * 判断 frontmatter type 是否为文件化 lorebook 类型。
 */
export function isWorkspaceLorebookType(value: string | null | undefined): value is WorkspaceLorebookType {
    return value === "location"
        || value === "character"
        || value === "item"
        || value === "rule"
        || value === "note";
}

/**
 * 读取文件化 lorebook 类型，非法值退回 note。
 */
export function readWorkspaceLorebookType(value: string | null | undefined): WorkspaceLorebookType {
    return isWorkspaceLorebookType(value) ? value : "note";
}

/**
 * 读取文件化 lorebook 状态，非法值退回 draft。
 */
export function readWorkspaceLorebookStatus(value: string | null | undefined): WorkspaceLorebookStatus {
    if (value === "draft" || value === "pending" || value === "active" || value === "archived") {
        return value;
    }
    return "draft";
}

/**
 * 返回文件化 lorebook 类型视觉样式。
 */
export function getWorkspaceLorebookTypeMeta(type: WorkspaceLorebookType): WorkspaceLorebookTypeMeta {
    if (type === "location") {
        return {
            icon: "i-lucide-map-pinned",
            iconClass: "text-sky-600 bg-sky-500/12 border-sky-500/20",
            badgeClass: "text-sky-700 bg-sky-500/10 border-sky-500/20",
            selectedClass: "bg-sky-500/10 text-sky-900",
            barClass: "before:bg-sky-500",
            dotClass: "bg-sky-500/60",
        };
    }

    if (type === "character") {
        return {
            icon: "i-lucide-user-round",
            iconClass: "text-emerald-600 bg-emerald-500/12 border-emerald-500/20",
            badgeClass: "text-emerald-700 bg-emerald-500/10 border-emerald-500/20",
            selectedClass: "bg-emerald-500/10 text-emerald-900",
            barClass: "before:bg-emerald-500",
            dotClass: "bg-emerald-500/60",
        };
    }

    if (type === "item") {
        return {
            icon: "i-lucide-package",
            iconClass: "text-amber-700 bg-amber-500/12 border-amber-500/20",
            badgeClass: "text-amber-800 bg-amber-500/10 border-amber-500/20",
            selectedClass: "bg-amber-500/10 text-amber-950",
            barClass: "before:bg-amber-500",
            dotClass: "bg-amber-500/60",
        };
    }

    if (type === "rule") {
        return {
            icon: "i-lucide-book-key",
            iconClass: "text-rose-600 bg-rose-500/12 border-rose-500/20",
            badgeClass: "text-rose-700 bg-rose-500/10 border-rose-500/20",
            selectedClass: "bg-rose-500/10 text-rose-900",
            barClass: "before:bg-rose-500",
            dotClass: "bg-rose-500/60",
        };
    }

    return {
        icon: "i-lucide-scroll-text",
        iconClass: "text-violet-600 bg-violet-500/12 border-violet-500/20",
        badgeClass: "text-violet-700 bg-violet-500/10 border-violet-500/20",
        selectedClass: "bg-violet-500/10 text-violet-900",
        barClass: "before:bg-violet-500",
        dotClass: "bg-violet-500/60",
    };
}

/**
 * 返回文件化 lorebook 状态文案。
 */
export function getWorkspaceLorebookStatusLabel(status: WorkspaceLorebookStatus): string {
    if (status === "draft") {
        return translate("ide.workspace.common.statusDraft", "草稿中");
    }
    if (status === "pending") {
        return translate("ide.workspace.common.statusPending", "待定");
    }
    if (status === "active") {
        return translate("ide.workspace.common.statusActive", "已生效");
    }
    return translate("ide.workspace.common.statusArchived", "已归档");
}

/**
 * 返回文件化 lorebook 状态颜色。
 */
export function getWorkspaceLorebookStatusIndicatorClass(status: WorkspaceLorebookStatus): string {
    if (status === "draft") {
        return "bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]";
    }
    if (status === "pending") {
        return "bg-sky-500 shadow-[0_0_4px_rgba(14,165,233,0.5)]";
    }
    if (status === "active") {
        return "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]";
    }
    return "bg-slate-400";
}
