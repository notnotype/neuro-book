import {mergeAttributes, Node} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {
    findMarkdownBlockTagStart,
    parseMarkdownBilingualBlock,
    renderMarkdownBilingualBlock,
} from "nbook/shared/markdown-workbench";

interface BilingualToken extends MarkdownToken {
    text?: string;
    tokens?: MarkdownToken[];
}

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        markdownBilingual: {
            setMarkdownBilingual: (text: string) => ReturnType;
            updateMarkdownBilingual: (text: string) => ReturnType;
            unsetMarkdownBilingual: () => ReturnType;
        };
    }
}

/**
 * 段落级双语对照块，Markdown 序列化为：
 *
 * <bilingual text="对照译文">
 * 原文段落
 * </bilingual>
 *
 * 渲染时对照译文以弱色小字行显示在原文上方（行间对照），服务整段翻译对照阅读。
 */
export const MarkdownBilingual = Node.create({
    name: "markdownBilingual",
    group: "block",
    content: "block+",
    defining: true,
    priority: 880,

    addAttributes() {
        return {
            text: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "div[data-bilingual-text]",
            getAttrs: (dom) => ({
                text: (dom as HTMLElement).getAttribute("data-bilingual-text") ?? "",
            }),
        }];
    },

    renderHTML({node, HTMLAttributes}) {
        return ["div", mergeAttributes(HTMLAttributes, {
            class: "nb-bilingual-block",
            "data-bilingual-text": String(node.attrs.text ?? ""),
        }), 0];
    },

    markdownTokenizer: {
        name: "markdownBilingual",
        level: "block",
        start(src: string) {
            // 只在行首块级形态处中断段落，避免误切段内文本
            return findMarkdownBlockTagStart(src, "bilingual");
        },
        tokenize(src: string, _tokens: unknown, lexer: {blockTokens: (src: string) => MarkdownToken[]}) {
            const parsed = parseMarkdownBilingualBlock(src);
            if (!parsed) {
                return undefined;
            }
            return {
                type: "markdownBilingual",
                raw: parsed.raw,
                text: parsed.text,
                tokens: lexer.blockTokens(parsed.body),
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const bilingualToken = token as BilingualToken;
        return helpers.createNode("markdownBilingual", {
            text: bilingualToken.text ?? "",
        }, helpers.parseChildren(bilingualToken.tokens ?? []));
    },

    renderMarkdown: (node, helpers) => {
        return renderMarkdownBilingualBlock(String(node.attrs?.text ?? ""), helpers.renderChildren(node, "\n\n"));
    },

    addCommands() {
        return {
            setMarkdownBilingual: (text: string) => ({commands}) => commands.wrapIn(this.name, {text}),
            updateMarkdownBilingual: (text: string) => ({commands}) => commands.updateAttributes(this.name, {text}),
            unsetMarkdownBilingual: () => ({commands}) => commands.lift(this.name),
        };
    },
});
