import YAML from "yaml";

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

export type FrontmatterRef = {
    relation: string;
    target: string;
    note: string | null;
};

export type RetrievalDraft = {
    enabled: boolean;
    trigger: string | null;
};

export type GovernanceDraft = {
    source: string;
    review: string;
};

export type ParsedMarkdownDocument = {
    frontmatter: Record<string, unknown>;
    body: string;
    error: string | null;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * 解析 Markdown 文档的 YAML frontmatter，解析失败时保留正文切分结果。
 */
export function parseMarkdownDocument(content: string): ParsedMarkdownDocument {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) {
        return {frontmatter: {}, body: content, error: null};
    }

    try {
        const parsed = YAML.parse(match[1] ?? "", {logLevel: "silent"}) as unknown;
        return {
            frontmatter: isPlainObject(parsed) ? parsed : {},
            body: content.slice(match[0].length),
            error: isPlainObject(parsed) || parsed === null ? null : translate("ide.workspace.common.frontmatterObjectError", "frontmatter 必须是对象"),
        };
    } catch (error) {
        return {
            frontmatter: {},
            body: content.slice(match[0].length),
            error: error instanceof Error ? error.message : translate("ide.workspace.common.frontmatterParseFailed", "frontmatter 解析失败"),
        };
    }
}

/**
 * 将 frontmatter 对象与正文重新渲染为 Markdown 文档。
 */
export function renderMarkdownDocument(frontmatter: Record<string, unknown>, body: string): string {
    return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body}`;
}

/**
 * 读取字符串字段。
 */
export function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

/**
 * 读取可空字符串字段。
 */
export function readNullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

/**
 * 读取字符串数组字段。
 */
export function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * 读取普通对象字段。
 */
export function readPlainObject(value: unknown): Record<string, unknown> {
    return isPlainObject(value) ? value : {};
}

/**
 * 读取结构化引用数组。
 */
export function readRefs(value: unknown): FrontmatterRef[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(isPlainObject).map((item) => ({
        relation: readString(item.relation, ""),
        target: readString(item.target, ""),
        note: readNullableString(item.note),
    }));
}

/**
 * 读取检索提示配置。
 */
export function readRetrieval(value: unknown): RetrievalDraft {
    const retrieval = readPlainObject(value);
    return {
        enabled: typeof retrieval.enabled === "boolean" ? retrieval.enabled : true,
        trigger: readNullableString(retrieval.trigger),
    };
}

/**
 * 读取治理状态配置。
 */
export function readGovernance(value: unknown): GovernanceDraft {
    const governance = readPlainObject(value);
    return {
        source: readString(governance.source, "manual"),
        review: readString(governance.review, "proposed"),
    };
}

/**
 * 返回路径末尾名称。
 */
export function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

/**
 * 判断值是否为普通对象。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
