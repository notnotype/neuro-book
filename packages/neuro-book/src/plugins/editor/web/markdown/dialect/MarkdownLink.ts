import {Link} from "@tiptap/extension-link";
import type {MarkdownToken} from "@tiptap/core";

interface MarkdownLinkToken extends MarkdownToken {
    href?: string;
    title?: string | null;
}

/**
 * Markdown link 解析器。
 * 外部链接成为普通 link mark；工作区引用由 WorkspaceReference tokenizer 抢先转成节点。
 */
export const MarkdownLink = Link.extend({
    parseMarkdown: (token, helpers) => {
        const linkToken = token as MarkdownLinkToken;
        const href = linkToken.href ?? "";
        return helpers.applyMark("link", helpers.parseInline(token.tokens || []), {
            href,
            title: linkToken.title || null,
        });
    },
});
