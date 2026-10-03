import {parseReferenceLink} from "nbook/shared/reference-link";
import {parseMarkdownCommentInline} from "nbook/shared/markdown-workbench";
import {parseWorkspaceReferenceLink} from "nbook/shared/workspace-reference";

export interface InlineCommentToken {
    body: string;
    text: string;
    raw: string;
    start: number;
    end: number;
}

// 行内评论标签:与 shared/markdown-workbench 的兼容语义一致——canonical 是 <comment>,兼容读旧 <inline-comment>;开闭标签名必须一致(反向引用)。
const INLINE_COMMENT_PATTERN = /<(comment|inline-comment)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/g;
const INLINE_REFERENCE_PATTERN = /\[[^\]]+\]\([^)]+\)/g;

export function parseInlineComment(raw: string): InlineCommentToken | null {
    const parsed = parseMarkdownCommentInline(raw);
    if (!parsed) {
        return null;
    }
    return {
        body: parsed.body,
        text: parsed.text,
        raw,
        start: 0,
        end: raw.length,
    };
}

export function countInlineComments(text: string): number {
    return [...text.matchAll(INLINE_COMMENT_PATTERN)].length;
}

export function countInlineReferences(text: string): number {
    return [...text.matchAll(INLINE_REFERENCE_PATTERN)]
        .filter((matched) => parseReferenceLink(matched[0] ?? "") || parseWorkspaceReferenceLink(matched[0] ?? ""))
        .length;
}

export function renderInlineCommentHtml(raw: string): string {
    const comment = parseInlineComment(raw);
    if (!comment) {
        return raw;
    }

    return [
        "<span class=\"nb-inline-comment\">",
        "<span class=\"nb-inline-comment__badge\">评论</span>",
        `<span class="nb-inline-comment__body">${escapeHtml(comment.body || "无评论内容")}</span>`,
        "</span>",
    ].join("");
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
