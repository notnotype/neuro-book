import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {
    normalizeAlign,
    parseMarkdownAlign,
    renderMarkdownAlign,
    type AlignValue,
} from "nbook/shared/markdown-workbench";

interface AlignToken extends MarkdownToken {
    align?: AlignValue;
    text?: string;
    tokens?: MarkdownToken[];
}

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        markdownAlign: {
            setMarkdownAlign: (align: AlignValue) => ReturnType;
        };
    }
}

/**
 * Markdown 对齐块，序列化为 <align value="center">...</align>。
 */
export const MarkdownAlign = Node.create({
    name: "markdownAlign",
    group: "block",
    content: "block+",
    defining: true,
    priority: 900,

    addAttributes() {
        return {
            align: {
                default: "left",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "align[value]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    align: normalizeAlign(element.getAttribute("value")),
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["align", mergeAttributes({
            value: normalizeAlign(HTMLAttributes.align),
            style: `text-align: ${normalizeAlign(HTMLAttributes.align)}`,
        }), 0];
    },

    markdownTokenizer: {
        name: "markdownAlign",
        level: "block",
        start(src: string) {
            return src.indexOf("<align");
        },
        tokenize(src: string, _tokens: unknown, lexer: {blockTokens: (src: string) => MarkdownToken[]}) {
            const parsed = parseMarkdownAlign(src);
            if (!parsed) {
                return undefined;
            }
            return {
                type: "markdownAlign",
                raw: parsed.raw,
                align: parsed.align,
                text: parsed.text,
                tokens: lexer.blockTokens(parsed.text),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const alignToken = token as AlignToken;
        return helpers.createNode("markdownAlign", {
            align: normalizeAlign(alignToken.align),
        }, helpers.parseChildren(alignToken.tokens ?? []));
    },

    renderMarkdown: (node, helpers) => {
        const align = normalizeAlign(node.attrs?.align);
        if (align === "left") {
            return helpers.renderChildren(node, "\n\n");
        }
        return renderMarkdownAlign(align, helpers.renderChildren(node, "\n\n"));
    },

    addCommands() {
        return {
            setMarkdownAlign: (align: AlignValue) => ({commands, editor}) => {
                const normalized = normalizeAlign(align);
                if (normalized === "left") {
                    return editor.isActive(this.name) ? commands.lift(this.name) : true;
                }
                if (editor.isActive(this.name)) {
                    return commands.updateAttributes(this.name, {align: normalized});
                }
                return commands.wrapIn(this.name, {align: normalized});
            },
        };
    },
});
