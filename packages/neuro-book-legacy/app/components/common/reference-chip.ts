import type {ReferenceKind, ReferenceLink} from "nbook/shared/reference-link";

export interface WorkspaceReferenceChipInput {
    label: string;
    target: string;
    entryType?: string | null;
    status?: string | null;
    icon?: string | null;
    broken?: boolean;
}

/**
 * 引用 chip 的视觉元数据。
 */
export interface ReferenceChipMeta {
    iconClass: string;
    toneClass: string;
    badgeLabel: string;
}

/**
 * 返回不同工作区引用类型的视觉配置。
 */
export function getReferenceChipMeta(input: ReferenceKind | Pick<WorkspaceReferenceChipInput, "entryType" | "target" | "broken" | "icon">): ReferenceChipMeta {
    const entryType = typeof input === "string" ? input : inferReferenceEntryType(input);
    if (typeof input !== "string" && input.broken) {
        return {
            iconClass: "i-lucide-unlink",
            toneClass: "is-broken",
            badgeLabel: "断链",
        };
    }
    if (entryType === "chapter") {
        return {
            iconClass: "i-lucide-file-text",
            toneClass: "is-chapter",
            badgeLabel: "章节",
        };
    }

    if (entryType === "volume") {
        return {
            iconClass: "i-lucide-book-copy",
            toneClass: "is-volume",
            badgeLabel: "分卷",
        };
    }

    if (entryType === "thread") {
        return {
            iconClass: "i-lucide-git-branch",
            toneClass: "is-thread",
            badgeLabel: "线程",
        };
    }

    if (entryType === "scene") {
        return {
            iconClass: "i-lucide-clapperboard",
            toneClass: "is-scene",
            badgeLabel: "场景",
        };
    }

    if (entryType === "plot") {
        return {
            iconClass: "i-lucide-spline-pointer",
            toneClass: "is-plot",
            badgeLabel: "情节",
        };
    }

    if (entryType === "pending") {
        return {
            iconClass: "i-lucide-hourglass",
            toneClass: "is-pending",
            badgeLabel: "待定",
        };
    }
    if (entryType === "selection") {
        return {
            iconClass: "i-lucide-text-select",
            toneClass: "is-selection",
            badgeLabel: "选区",
        };
    }
    if (entryType === "character") {
        return {
            iconClass: "i-lucide-user-round",
            toneClass: "is-character",
            badgeLabel: "角色",
        };
    }
    if (entryType === "location") {
        return {
            iconClass: "i-lucide-map-pin",
            toneClass: "is-location",
            badgeLabel: "地点",
        };
    }
    if (entryType === "item") {
        return {
            iconClass: "i-lucide-package",
            toneClass: "is-item",
            badgeLabel: "物品",
        };
    }
    if (entryType === "rule") {
        return {
            iconClass: "i-lucide-scroll-text",
            toneClass: "is-rule",
            badgeLabel: "规则",
        };
    }
    if (entryType === "note") {
        return {
            iconClass: "i-lucide-sticky-note",
            toneClass: "is-note",
            badgeLabel: "笔记",
        };
    }
    if (entryType === "plan") {
        return {
            iconClass: "i-lucide-clipboard-list",
            toneClass: "is-plan",
            badgeLabel: "计划",
        };
    }
    if (entryType === "folder") {
        return {
            iconClass: typeof input === "string" ? "i-lucide-folder" : input.icon ?? "i-lucide-folder",
            toneClass: "is-folder",
            badgeLabel: "目录",
        };
    }
    if (entryType === "file") {
        return {
            iconClass: typeof input === "string" ? "i-lucide-file" : input.icon ?? inferReferenceIcon(input.target ?? ""),
            toneClass: "is-file",
            badgeLabel: "文件",
        };
    }

    return {
        iconClass: typeof input === "string" ? "i-lucide-library-big" : input.icon ?? inferReferenceIcon(input.target ?? ""),
        toneClass: "is-file",
        badgeLabel: "文件",
    };
}

/**
 * 构造只读 HTML 渲染使用的引用 chip 字符串。
 */
export function renderReferenceChipHtml(reference: ReferenceLink | WorkspaceReferenceChipInput): string {
    const normalized = normalizeReferenceChipInput(reference);
    const meta = getReferenceChipMeta(normalized);
    return [
        `<span class="nb-reference-chip ${meta.toneClass}"`,
        ` data-reference-target="${escapeHtml(normalized.target)}"`,
        ` data-reference-entry-type="${escapeHtml(normalized.entryType ?? "")}"`,
        ` contenteditable="false">`,
        `<span class="nb-reference-chip__icon ${meta.iconClass}" aria-hidden="true"></span>`,
        `<span class="nb-reference-chip__label">${escapeHtml(normalized.label)}</span>`,
        `<span class="nb-reference-chip__badge">${meta.badgeLabel}</span>`,
        `</span>`,
    ].join("");
}

/**
 * 兼容旧 ReferenceLink，并统一成 workspace chip 输入。
 */
function normalizeReferenceChipInput(reference: ReferenceLink | WorkspaceReferenceChipInput): WorkspaceReferenceChipInput {
    if ("target" in reference) {
        return reference;
    }
    return {
        label: reference.title,
        target: `${reference.kind}://${reference.targetId}`,
        entryType: reference.kind,
    };
}

/**
 * 根据 target 粗略推断展示类型。
 */
function inferReferenceEntryType(input: Pick<WorkspaceReferenceChipInput, "entryType" | "target" | "icon">): string | null {
    if (input.entryType) {
        return input.entryType;
    }
    const normalizedTarget = input.target?.replace(/\\/g, "/").toLowerCase() ?? "";
    const schemeMatch = /^(chapter|volume|lorebook|thread|scene|plot|pending):\/\//i.exec(normalizedTarget);
    if (schemeMatch?.[1]) {
        return schemeMatch[1];
    }
    if (normalizedTarget.includes("/character/")) {
        return "character";
    }
    if (normalizedTarget.includes("/location/")) {
        return "location";
    }
    if (normalizedTarget.includes("/item/")) {
        return "item";
    }
    if (normalizedTarget.includes("/rule/")) {
        return "rule";
    }
    if (normalizedTarget.includes("/note/")) {
        return "note";
    }
    if (normalizedTarget.includes("/manuscript/")) {
        return "chapter";
    }
    if (/\/\.agent\/[^/]+\/.+\.md$/i.test(normalizedTarget) || /^\.agent\/[^/]+\/.+\.md$/i.test(normalizedTarget)) {
        return "plan";
    }
    return null;
}

/**
 * 根据 target 粗略推断文件图标。
 */
function inferReferenceIcon(target: string): string {
    if (target.endsWith("/")) {
        return "i-lucide-folder";
    }
    if (target.toLowerCase().endsWith(".md")) {
        return "i-lucide-file-text";
    }
    return "i-lucide-file";
}

/**
 * 转义 HTML。
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
