export interface WorkspaceReferenceLink {
    label: string;
    target: string;
}

const MARKDOWN_LINK_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)$/;
const EXTERNAL_REFERENCE_PATTERN = /^(?:https?:|mailto:|tel:|#)/i;
const SCHEME_REFERENCE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 判断 Markdown link target 是否是工作区引用。
 */
export function isWorkspaceReferenceTarget(target: string): boolean {
    const normalizedTarget = stripReferenceFragment(target.trim());
    if (!normalizedTarget) {
        return false;
    }
    if (normalizedTarget.startsWith("/")) {
        return false;
    }
    if (EXTERNAL_REFERENCE_PATTERN.test(normalizedTarget)) {
        return false;
    }
    if (SCHEME_REFERENCE_PATTERN.test(normalizedTarget)) {
        return false;
    }
    return true;
}

/**
 * 解析工作区 Markdown inline 引用。
 */
export function parseWorkspaceReferenceLink(raw: string): WorkspaceReferenceLink | null {
    const matched = MARKDOWN_LINK_PATTERN.exec(raw.trim());
    if (!matched) {
        return null;
    }

    const label = matched[1]?.trim() ?? "";
    const target = matched[2]?.trim() ?? "";
    if (!label || !isWorkspaceReferenceTarget(target)) {
        return null;
    }

    return {
        label,
        target,
    };
}

/**
 * 构造工作区 Markdown inline 引用。
 */
export function buildWorkspaceReferenceMarkdown(reference: WorkspaceReferenceLink): string {
    return `[${reference.label}](${reference.target})`;
}

/**
 * 去掉 Markdown link target 的查询参数和锚点。
 */
export function stripReferenceFragment(target: string): string {
    const queryIndex = target.indexOf("?");
    const hashIndex = target.indexOf("#");
    const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
    if (indexes.length === 0) {
        return target;
    }
    return target.slice(0, Math.min(...indexes));
}
