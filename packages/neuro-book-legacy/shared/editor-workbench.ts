export type FrontmatterProfileKind = "character" | "location" | "rule";

/**
 * Markdown 富文本编辑器的本地显示偏好；只影响 UI，不写入 Markdown 文件。
 */
export interface MarkdownEditorPreferences {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    contentWidth: number;
    paragraphIndentEnabled: boolean;
    paragraphIndentEm: number;
}

/**
 * Monaco 源码编辑器的本地显示偏好；只影响 UI，不写入文件内容。
 */
export interface MonacoEditorPreferences {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    tabSize: number;
    wordWrap: boolean;
    minimapEnabled: boolean;
    lineNumbers: boolean;
    renderWhitespace: boolean;
}

export interface FrontmatterSplitResult {
    frontmatterText: string;
    prefix: string;
    body: string;
    hasFrontmatter: boolean;
}

/**
 * Markdown 富文本编辑器默认显示偏好。
 */
export const DEFAULT_MARKDOWN_EDITOR_PREFERENCES: MarkdownEditorPreferences = {
    fontFamily: "\"Source Han Serif SC\", \"Noto Serif SC\", \"Songti SC\", serif",
    fontSize: 16,
    lineHeight: 1.85,
    contentWidth: 860,
    paragraphIndentEnabled: false,
    paragraphIndentEm: 2,
};

/**
 * Monaco 源码编辑器默认显示偏好。
 */
export const DEFAULT_MONACO_EDITOR_PREFERENCES: MonacoEditorPreferences = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    fontSize: 15,
    lineHeight: 30,
    tabSize: 4,
    wordWrap: true,
    minimapEnabled: false,
    lineNumbers: true,
    renderWhitespace: false,
};

export interface MonacoLanguageRule {
    extensions: string[];
    language: string;
}

export const MONACO_LANGUAGE_RULES: MonacoLanguageRule[] = [
    {extensions: [".md", ".markdown"], language: "markdown"},
    {extensions: [".json"], language: "json"},
    {extensions: [".js", ".mjs", ".cjs"], language: "javascript"},
    {extensions: [".ts", ".tsx"], language: "typescript"},
    {extensions: [".vue"], language: "html"},
    {extensions: [".css"], language: "css"},
    {extensions: [".html", ".htm"], language: "html"},
    {extensions: [".yaml", ".yml"], language: "yaml"},
    {extensions: [".txt", ".text", ""], language: "plaintext"},
];

/**
 * 返回工作区路径的小写扩展名；无扩展名返回空字符串。
 */
export function resolveWorkspaceFileExtension(filePath: string): string {
    const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) {
        return "";
    }
    return fileName.slice(dotIndex).toLowerCase();
}


/**
 * 根据文件扩展名映射 Monaco language，未知文本回退 plaintext。
 */
export function resolveMonacoLanguage(filePath: string): string {
    const extension = resolveWorkspaceFileExtension(filePath);
    return MONACO_LANGUAGE_RULES.find((rule) => rule.extensions.includes(extension))?.language ?? "plaintext";
}


/**
 * 只有 manuscript/ 与 lorebook/ 内容节点的 Markdown 文件开放 frontmatter dialog。
 */
export function canEditContentFrontmatter(filePath: string, editable: boolean, contentNode: boolean): boolean {
    if (!editable || !contentNode || resolveWorkspaceFileExtension(filePath) !== ".md") {
        return false;
    }
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();
    return normalized.startsWith("manuscript/")
        || normalized.startsWith("lorebook/")
        || normalized.startsWith("workspace/manuscript/")
        || normalized.startsWith("workspace/lorebook/");
}

/**
 * 分离 Markdown 开头的 YAML frontmatter；无法形成完整 frontmatter 时保持正文不变。
 */
export function splitMarkdownFrontmatter(content: string): FrontmatterSplitResult {
    const normalized = content.replace(/\r\n/g, "\n");
    if (!normalized.startsWith("---\n")) {
        return {frontmatterText: "", prefix: "", body: content, hasFrontmatter: false};
    }

    const closingDelimiterStart = normalized.indexOf("\n---", 4);
    if (closingDelimiterStart < 0) {
        return {frontmatterText: "", prefix: "", body: content, hasFrontmatter: false};
    }

    const closingDelimiterEnd = closingDelimiterStart + "\n---".length;
    const nextCharacter = normalized[closingDelimiterEnd];
    if (nextCharacter && nextCharacter !== "\n" && nextCharacter !== "\r") {
        return {frontmatterText: "", prefix: "", body: content, hasFrontmatter: false};
    }

    const bodyStart = nextCharacter === "\n" ? closingDelimiterEnd + 1 : closingDelimiterEnd;
    const prefix = `${normalized.slice(0, bodyStart)}${nextCharacter ? "" : "\n"}`;
    return {
        frontmatterText: normalized.slice(4, closingDelimiterStart).trimEnd(),
        prefix,
        body: normalized.slice(bodyStart),
        hasFrontmatter: true,
    };
}

/**
 * 合并 frontmatter 前缀与正文；prefix 由 splitMarkdownFrontmatter 产生。
 */
export function composeMarkdownFrontmatter(prefix: string, body: string): string {
    return prefix ? `${prefix}${body}` : body;
}
