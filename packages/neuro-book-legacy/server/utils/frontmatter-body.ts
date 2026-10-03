type FrontmatterBoundary = {
    frontmatterText: string;
    body: string;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * 只识别 Markdown frontmatter 的文本边界，不解析 YAML，避免把重依赖带入轻量消费者。
 */
export function splitFrontmatterBoundary(content: string): FrontmatterBoundary | null {
    const match = content.match(FRONTMATTER_PATTERN);
    if (!match) return null;
    return {
        frontmatterText: match[1] ?? "",
        body: match[2] ?? "",
    };
}

/** 剥离 frontmatter，仅返回正文；没有完整 frontmatter 时原样返回。 */
export function stripFrontmatterBody(content: string): string {
    return splitFrontmatterBoundary(content)?.body ?? content;
}
